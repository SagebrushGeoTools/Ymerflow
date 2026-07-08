from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Dict, Optional
import logging
import projnames

from backend.database import get_db
from backend.services.k8s_client import k8s_clients
from backend.services.auth_service import get_current_user, AuthContext
from backend.models.cluster import get_allowed_clusters

router = APIRouter(prefix="/utilities", tags=["Utilities"])

logger = logging.getLogger(__name__)

DEFAULT_QUEUE_LIMITS = {"max_cpu_cores": 8.0, "max_memory_gb": 32.0}


@router.get("/available-clusters", tags=["Processes"])
async def available_clusters(
    project_id: Optional[str] = None,
    cpu: Optional[str] = None,
    memory: Optional[str] = None,
    deadline_seconds: Optional[int] = None,
    auth: AuthContext = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Return the clusters the current user may run on, each with live resource limits.

    Combines the select_clusters hook's allowed-cluster set with a live Kueue ClusterQueue
    lookup per cluster (CPU/memory limits are not stored — Kueue is a hard requirement for
    job admission, so it's always live-queryable) and the stored max_runtime_seconds ceiling.
    Sorted by sort_order, same order the process-creation dropdown should present.
    """
    resource_requests = {"cpu": cpu, "memory": memory} if cpu or memory else None
    clusters = await get_allowed_clusters(db, auth.user, project_id, resource_requests)
    out = []
    for cluster in clusters:
        limits = await k8s_clients.get(cluster).get_cluster_queue_limits()
        if limits is None:
            limits = DEFAULT_QUEUE_LIMITS
        out.append({
            **cluster.to_dict(),
            "max_cpu_cores": limits["max_cpu_cores"],
            "max_memory_gb": limits["max_memory_gb"],
        })
    return out


@router.get("/epsg-codes")
async def get_epsg_codes() -> Dict[int, str]:
    """Get all EPSG codes with names for coordinate system selection.

    Returns a dictionary mapping EPSG code (integer) to projection name (string).
    """
    logger.info(f"Returning {len(projnames.by_epsg)} EPSG codes")
    return projnames.by_epsg
