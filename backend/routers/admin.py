import base64
import hashlib
import secrets as secrets_module
import ssl
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Dict, Optional

from backend.config import settings
from backend.database import get_db
from backend.auth_deps import require_admin
from backend.models.cluster import Cluster
from backend.models.storage_backend import StorageBackend
from backend.services.cluster_providers import get_cluster_provider
from backend.services.storage_protocols import get_protocol_handler
from backend.services.secret_masking import mask_config, resolve_config

router = APIRouter(tags=["Admin"])

# ── Self-service cluster registration (any provider with self_service_registration=True) ──────
# See docs/plans/done/remote-cluster-provisioning-and-registry.md Phase 4 ("minikube" is the
# first and, so far, only such provider). Token is single-use and short-lived; only its SHA-256
# hash is ever stored (same pattern as ApiKey.key_hash).
REGISTRATION_TOKEN_TTL_MINUTES = 45


def _hash_registration_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _cluster_admin_dict(cluster: Cluster) -> Dict:
    d = cluster.to_dict()
    d["cluster_type"] = cluster.cluster_type
    d["provider_config"] = mask_config(cluster.provider_config)
    return d


async def _test_and_apply_connection(cluster: Cluster, body: Dict) -> None:
    """Only touches cluster_type/provider_config if the caller actually sent them, and only
    re-tests the connection in that case — editing unrelated fields must not fail because the
    cluster is momentarily unreachable (see docs/plans/cluster-admin-ui.md Design decisions)."""
    if "cluster_type" in body or "provider_config" in body:
        cluster_type = body.get("cluster_type", cluster.cluster_type)
        submitted = body.get("provider_config") or {}
        stored = cluster.provider_config if cluster_type == cluster.cluster_type else {}
        try:
            provider_config = resolve_config(submitted, stored)
            provider = get_cluster_provider(cluster_type)
            await provider.test_connection(provider_config)
        except HTTPException:
            raise
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Connection test failed: {e}")
        cluster.cluster_type = cluster_type
        cluster.provider_config = provider_config


def _apply_generic_fields(cluster: Cluster, body: Dict) -> None:
    """Only touches a column if its key is present in body — write-only-if-provided, same rule
    the rest of this route module follows for provider_config."""
    if "name" in body:
        name = (body.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="name is required")
        cluster.name = name
    if "namespace" in body:
        cluster.namespace = body.get("namespace") or "nagelfluh-jobs"
    if "sort_order" in body:
        try:
            cluster.sort_order = int(body["sort_order"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="sort_order must be an integer")
    if "active" in body:
        if not isinstance(body["active"], bool):
            raise HTTPException(status_code=400, detail="active must be a boolean")
        cluster.active = body["active"]
    if "max_runtime_seconds" in body:
        value = body["max_runtime_seconds"]
        if value is not None:
            if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
                raise HTTPException(status_code=400, detail="max_runtime_seconds must be a positive integer or null")
        cluster.max_runtime_seconds = value


@router.get("/admin/clusters")
async def admin_list_clusters(auth=Depends(require_admin), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Cluster).order_by(Cluster.sort_order))
    return [_cluster_admin_dict(c) for c in result.scalars().all()]


@router.post("/admin/clusters")
async def admin_create_cluster(body: Dict, auth=Depends(require_admin), db: AsyncSession = Depends(get_db)):
    if not (body.get("name") or "").strip():
        raise HTTPException(status_code=400, detail="name is required")

    cluster_type = body.get("cluster_type", "kubeconfig")
    try:
        provider = get_cluster_provider(cluster_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if provider.self_service_registration:
        # No provider_config yet — there's nothing to test-connect to until whatever runs
        # out-of-band on the target host completes and its callback lands. The cluster starts
        # inactive/pending so it's never selected for job dispatch in the meantime. Generic across
        # any provider with self_service_registration=True (see
        # backend/services/cluster_providers/__init__.py) — not specific to "minikube".
        cluster = Cluster(
            name=body["name"].strip(),
            namespace=body.get("namespace") or "nagelfluh-jobs",
            cluster_type=cluster_type,
            provider_config={},
            active=False,
            provisioning_status="pending",
        )
        _apply_generic_fields(cluster, body)
        token = secrets_module.token_urlsafe(32)
        cluster.registration_token_hash = _hash_registration_token(token)
        cluster.registration_token_expires_at = datetime.utcnow() + timedelta(minutes=REGISTRATION_TOKEN_TTL_MINUTES)
        db.add(cluster)
        await db.commit()
        result = _cluster_admin_dict(cluster)
        # Only ever returned here, once, at creation — never on subsequent GET/list.
        result["registration_token"] = token
        result["registration_command"] = provider.registration_command(token)
        return result

    cluster = Cluster(name=body["name"].strip(), namespace=body.get("namespace") or "nagelfluh-jobs")
    await _test_and_apply_connection(cluster, body)
    _apply_generic_fields(cluster, body)
    db.add(cluster)
    await db.commit()
    return _cluster_admin_dict(cluster)


@router.patch("/admin/clusters/{cluster_id}")
async def admin_update_cluster(cluster_id: str, body: Dict, auth=Depends(require_admin), db: AsyncSession = Depends(get_db)):
    cluster = await db.get(Cluster, cluster_id)
    if cluster is None:
        raise HTTPException(status_code=404, detail="Cluster not found")
    await _test_and_apply_connection(cluster, body)
    _apply_generic_fields(cluster, body)
    await db.commit()
    return _cluster_admin_dict(cluster)


@router.post("/admin/clusters/test-connection")
async def admin_test_cluster_connection(body: Dict, auth=Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Stateless test for the 'Test Connection' button — no cluster row required, so it works
    while filling out the create form before anything is saved. If cluster_id is provided and
    matches an existing cluster of the same cluster_type, masked fields resolve against its
    stored provider_config."""
    cluster_type = body.get("cluster_type")
    if not cluster_type:
        raise HTTPException(status_code=400, detail="cluster_type is required")
    stored = {}
    cluster_id = body.get("cluster_id")
    if cluster_id:
        existing = await db.get(Cluster, cluster_id)
        if existing is not None and existing.cluster_type == cluster_type:
            stored = existing.provider_config or {}
    try:
        provider_config = resolve_config(body.get("provider_config") or {}, stored)
        provider = get_cluster_provider(cluster_type)
        await provider.test_connection(provider_config)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Connection test failed: {e}")
    return {"ok": True}


@router.post("/admin/clusters/register-callback")
async def cluster_register_callback(body: Dict, request: Request, db: AsyncSession = Depends(get_db)):
    """Generic callback for any cluster_type whose provider has self_service_registration=True
    (today that's just "minikube", via dev/setup-minikube-remote.sh.in — see
    docs/plans/done/remote-cluster-provisioning-and-registry.md). Called by whatever ran
    out-of-band on the target host, not by an admin session — the only credential is the
    single-use bearer token minted at cluster creation, so this deliberately has no require_admin
    dependency. The token alone identifies which pending Cluster row this belongs to; there is no
    cluster id in the URL (see Design decision 3 in that plan)."""
    auth_header = request.headers.get("authorization", "")
    if not auth_header.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = auth_header[len("bearer "):].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token_hash = _hash_registration_token(token)

    # Token hash alone identifies the pending cluster — it's unique and single-use, so no need to
    # additionally scope by cluster_type. Works for any self_service_registration provider, not
    # just "minikube".
    result = await db.execute(
        select(Cluster).where(Cluster.registration_token_hash == token_hash)
    )
    cluster = result.scalar_one_or_none()
    if cluster is None:
        raise HTTPException(status_code=401, detail="Invalid or already-used registration token")
    if cluster.registration_token_expires_at is None or cluster.registration_token_expires_at < datetime.utcnow():
        # Invalidate so a stale expired token can't be retried even if someone captured it.
        cluster.registration_token_hash = None
        cluster.registration_token_expires_at = None
        cluster.provisioning_status = "failed"
        await db.commit()
        raise HTTPException(status_code=401, detail="Registration token expired")

    # The POSTed body IS the provider_config, in whatever shape cluster.cluster_type's provider
    # expects (for "minikube"/"kubeconfig"-derived providers that's {"kubeconfig": "..."}) — the
    # callback itself doesn't need to know that shape, only the provider does.
    if not body:
        raise HTTPException(status_code=400, detail="request body (provider_config) is required")

    provider_config = body
    try:
        provider = get_cluster_provider(cluster.cluster_type)
        await provider.test_connection(provider_config)
    except Exception as e:
        cluster.provisioning_status = "failed"
        cluster.registration_token_hash = None
        cluster.registration_token_expires_at = None
        await db.commit()
        raise HTTPException(status_code=400, detail=f"Connection test failed: {e}")

    cluster.provider_config = provider_config
    cluster.active = True
    cluster.provisioning_status = "active"
    # Single-use: invalidate immediately on successful redemption too.
    cluster.registration_token_hash = None
    cluster.registration_token_expires_at = None
    await db.commit()
    return {"ok": True, "cluster_id": cluster.id, "name": cluster.name}


_REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def _fetch_registry_ca_pem(host: str, port: int) -> str:
    """The registry's self-signed cert IS its own CA (Level A TLS — encrypt, skip
    server-identity verification, see docs/plans/done/self-signed-tls-minio-registry.md), so we
    can just fetch whatever cert it presents live over TLS rather than needing filesystem/Secret
    access to wherever dev/setup-registry.sh happened to persist it."""
    return ssl.get_server_certificate((host, port))


@router.get("/static/assets/setup-minikube-remote.sh", response_class=PlainTextResponse)
async def get_setup_minikube_remote_script():
    """Publicly reachable, unauthenticated by design — it's fetched by a bare `curl` from
    whatever host the admin is registering, which has no Nagelfluh session/cookie at all. The
    single-use registration token (not this script) is what's actually secret; see
    docs/plans/done/remote-cluster-provisioning-and-registry.md Design decision 5."""
    registry_host = settings.registry_public_host
    if not registry_host:
        raise HTTPException(status_code=500, detail="REGISTRY_PUBLIC_HOST is not configured")
    registry_user, registry_password = "nagelfluh", "nagelfluh"
    if settings.registry_auth:
        decoded = base64.b64decode(settings.registry_auth).decode()
        registry_user, _, registry_password = decoded.partition(":")

    try:
        ca_pem = _fetch_registry_ca_pem(registry_host, 30500)
    except OSError as e:
        raise HTTPException(status_code=502, detail=f"Could not reach registry at {registry_host}:30500 to fetch its CA cert: {e}")

    template = (_REPO_ROOT / "dev" / "setup-minikube-remote.sh.in").read_text()
    provision_lib = (_REPO_ROOT / "dev" / "lib" / "provision-nagelfluh-jobs.sh").read_text()

    script = (
        template
        .replace("__CALLBACK_URL__", f"{settings.backend_base_url}/admin/clusters/register-callback")
        .replace("__REGISTRY_PUBLIC_HOST__", registry_host)
        .replace("__REGISTRY_USER__", registry_user)
        .replace("__REGISTRY_PASSWORD__", registry_password)
        .replace("__REGISTRY_CA_PEM__", ca_pem.strip())
        .replace("__PROVISION_LIB__", provision_lib)
    )
    return PlainTextResponse(content=script, media_type="text/x-shellscript")


@dataclass
class _TestBackend:
    """Consistent .endpoint/.config shape for test_connection(backend), whether called against
    a real ORM row (update path) or a not-yet-created one (create/standalone-test-button path)."""
    endpoint: Optional[str]
    config: Dict


def _storage_backend_admin_dict(backend: StorageBackend) -> Dict:
    d = backend.to_dict()
    d["config"] = mask_config(backend.config)
    return d


async def _test_and_apply_storage_connection(backend: StorageBackend, body: Dict) -> None:
    """Only touches protocol/config if the caller actually sent them, and only re-tests the
    connection in that case — editing unrelated fields (e.g. sort_order) must not fail because
    storage is momentarily unreachable (see docs/plans/storage-admin-ui.md Design decisions)."""
    if "protocol" in body or "config" in body:
        protocol = body.get("protocol", backend.protocol)
        submitted = body.get("config") or {}
        stored = backend.config if protocol == backend.protocol else {}
        try:
            config = resolve_config(submitted, stored)
            handler = get_protocol_handler(protocol)
            await handler.test_connection(_TestBackend(backend.endpoint, config))
        except HTTPException:
            raise
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Connection test failed: {e}")
        backend.protocol = protocol
        backend.config = config


def _apply_storage_generic_fields(backend: StorageBackend, body: Dict) -> None:
    """Only touches a column if its key is present in body — write-only-if-provided, same rule
    _apply_generic_fields follows for clusters. Must run before
    _test_and_apply_storage_connection, since test_connection needs the (possibly just-updated)
    endpoint."""
    if "name" in body:
        name = (body.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="name is required")
        backend.name = name
    if "endpoint" in body:
        backend.endpoint = body.get("endpoint") or None
    if "bucket_prefix" in body:
        prefix = (body.get("bucket_prefix") or "").strip()
        if not prefix:
            raise HTTPException(status_code=400, detail="bucket_prefix is required")
        backend.bucket_prefix = prefix
    if "credential_strategy" in body:
        if body["credential_strategy"] not in ("static-key", "short-lived"):
            raise HTTPException(status_code=400, detail="invalid credential_strategy")
        backend.credential_strategy = body["credential_strategy"]
    if "sort_order" in body:
        try:
            backend.sort_order = int(body["sort_order"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="sort_order must be an integer")
    if "active" in body:
        if not isinstance(body["active"], bool):
            raise HTTPException(status_code=400, detail="active must be a boolean")
        backend.active = body["active"]


@router.get("/admin/storage-backends")
async def admin_list_storage_backends(auth=Depends(require_admin), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(StorageBackend).order_by(StorageBackend.sort_order))
    return [_storage_backend_admin_dict(b) for b in result.scalars().all()]


@router.post("/admin/storage-backends")
async def admin_create_storage_backend(body: Dict, auth=Depends(require_admin), db: AsyncSession = Depends(get_db)):
    if not (body.get("name") or "").strip():
        raise HTTPException(status_code=400, detail="name is required")
    if not (body.get("bucket_prefix") or "").strip():
        raise HTTPException(status_code=400, detail="bucket_prefix is required")
    backend = StorageBackend(
        name=body["name"].strip(), bucket_prefix=body["bucket_prefix"].strip(),
        protocol=body.get("protocol", "minio"),
        credential_strategy=body.get("credential_strategy", "static-key"),
    )
    _apply_storage_generic_fields(backend, body)
    await _test_and_apply_storage_connection(backend, body)
    db.add(backend)
    await db.commit()
    return _storage_backend_admin_dict(backend)


@router.patch("/admin/storage-backends/{backend_id}")
async def admin_update_storage_backend(backend_id: str, body: Dict, auth=Depends(require_admin), db: AsyncSession = Depends(get_db)):
    backend = await db.get(StorageBackend, backend_id)
    if backend is None:
        raise HTTPException(status_code=404, detail="Storage backend not found")
    _apply_storage_generic_fields(backend, body)
    await _test_and_apply_storage_connection(backend, body)
    await db.commit()
    return _storage_backend_admin_dict(backend)


@router.post("/admin/storage-backends/test-connection")
async def admin_test_storage_backend_connection(body: Dict, auth=Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Stateless test for the 'Test Connection' button — no storage backend row required, so it
    works while filling out the create form before anything is saved. If backend_id is provided
    and matches an existing backend of the same protocol, masked fields resolve against its
    stored config."""
    protocol = body.get("protocol")
    if not protocol:
        raise HTTPException(status_code=400, detail="protocol is required")
    stored = {}
    backend_id = body.get("backend_id")
    if backend_id:
        existing = await db.get(StorageBackend, backend_id)
        if existing is not None and existing.protocol == protocol:
            stored = existing.config or {}
    try:
        config = resolve_config(body.get("config") or {}, stored)
        handler = get_protocol_handler(protocol)
        await handler.test_connection(_TestBackend(body.get("endpoint"), config))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Connection test failed: {e}")
    return {"ok": True}
