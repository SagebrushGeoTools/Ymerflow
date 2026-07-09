from dataclasses import dataclass
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Dict, Optional

from backend.database import get_db
from backend.auth_deps import require_admin
from backend.models.cluster import Cluster
from backend.models.storage_backend import StorageBackend
from backend.services.cluster_providers import get_cluster_provider
from backend.services.storage_protocols import get_protocol_handler

router = APIRouter(tags=["Admin"])


def _cluster_admin_dict(cluster: Cluster) -> Dict:
    d = cluster.to_dict()
    d["cluster_type"] = cluster.cluster_type
    d["has_provider_config"] = bool(cluster.provider_config)
    d["has_registry_auth"] = bool(cluster.registry_auth)
    return d


async def _test_and_apply_connection(cluster: Cluster, body: Dict) -> None:
    """Only touches cluster_type/provider_config if the caller actually sent them, and only
    re-tests the connection in that case — editing unrelated fields must not fail because the
    cluster is momentarily unreachable (see docs/plans/cluster-admin-ui.md Design decisions)."""
    if "cluster_type" in body or "provider_config" in body:
        cluster_type = body.get("cluster_type", cluster.cluster_type)
        provider_config = body.get("provider_config") or {}
        try:
            provider = get_cluster_provider(cluster_type)
            await provider.test_connection(provider_config)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Connection test failed: {e}")
        cluster.cluster_type = cluster_type
        cluster.provider_config = provider_config


def _apply_generic_fields(cluster: Cluster, body: Dict) -> None:
    """Only touches a column if its key is present in body — write-only-if-provided, same rule
    the rest of this route module follows for provider_config/registry_auth."""
    if "name" in body:
        name = (body.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="name is required")
        cluster.name = name
    if "namespace" in body:
        cluster.namespace = body.get("namespace") or "nagelfluh-jobs"
    if "registry_url" in body:
        cluster.registry_url = body.get("registry_url") or None
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
    if body.get("registry_auth"):
        cluster.registry_auth = body["registry_auth"]


@router.get("/admin/clusters")
async def admin_list_clusters(auth=Depends(require_admin), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Cluster).order_by(Cluster.sort_order))
    return [_cluster_admin_dict(c) for c in result.scalars().all()]


@router.post("/admin/clusters")
async def admin_create_cluster(body: Dict, auth=Depends(require_admin), db: AsyncSession = Depends(get_db)):
    if not (body.get("name") or "").strip():
        raise HTTPException(status_code=400, detail="name is required")
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
async def admin_test_cluster_connection(body: Dict, auth=Depends(require_admin)):
    """Stateless test for the 'Test Connection' button — no cluster row required, so it works
    while filling out the create form before anything is saved."""
    cluster_type = body.get("cluster_type")
    if not cluster_type:
        raise HTTPException(status_code=400, detail="cluster_type is required")
    try:
        provider = get_cluster_provider(cluster_type)
        await provider.test_connection(body.get("provider_config") or {})
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Connection test failed: {e}")
    return {"ok": True}


@dataclass
class _TestBackend:
    """Consistent .endpoint/.config shape for test_connection(backend), whether called against
    a real ORM row (update path) or a not-yet-created one (create/standalone-test-button path)."""
    endpoint: Optional[str]
    config: Dict


def _storage_backend_admin_dict(backend: StorageBackend) -> Dict:
    d = backend.to_dict()
    d["has_config"] = bool(backend.config)
    return d


async def _test_and_apply_storage_connection(backend: StorageBackend, body: Dict) -> None:
    """Only touches protocol/config if the caller actually sent them, and only re-tests the
    connection in that case — editing unrelated fields (e.g. sort_order) must not fail because
    storage is momentarily unreachable (see docs/plans/storage-admin-ui.md Design decisions)."""
    if "protocol" in body or "config" in body:
        protocol = body.get("protocol", backend.protocol)
        config = body.get("config") or {}
        try:
            handler = get_protocol_handler(protocol)
            await handler.test_connection(_TestBackend(backend.endpoint, config))
        except HTTPException:
            raise
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
async def admin_test_storage_backend_connection(body: Dict, auth=Depends(require_admin)):
    """Stateless test for the 'Test Connection' button — no storage backend row required, so it
    works while filling out the create form before anything is saved."""
    protocol = body.get("protocol")
    if not protocol:
        raise HTTPException(status_code=400, detail="protocol is required")
    try:
        handler = get_protocol_handler(protocol)
        await handler.test_connection(_TestBackend(body.get("endpoint"), body.get("config") or {}))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Connection test failed: {e}")
    return {"ok": True}
