from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Dict

from backend.database import get_db
from backend.auth_deps import require_admin
from backend.models.cluster import Cluster
from backend.services.cluster_providers import get_cluster_provider

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
