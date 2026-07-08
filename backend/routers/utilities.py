from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Dict, Optional
import logging
import projnames

from backend.database import get_db
from backend.services.k8s_client import k8s_clients
from backend.models.cluster import Cluster, DEFAULT_CLUSTER_ID

router = APIRouter(prefix="/utilities", tags=["Utilities"])

logger = logging.getLogger(__name__)


@router.get("/resource-limits")
async def get_resource_limits(db: AsyncSession = Depends(get_db)):
    """Return maximum CPU cores and memory GB available for job resource requests.

    Reads nominalQuota from the Kueue ClusterQueue on the default cluster. Returns sensible
    defaults if the ClusterQueue cannot be reached.
    """
    limits = None
    stmt = select(Cluster).where(Cluster.id == DEFAULT_CLUSTER_ID)
    result = await db.execute(stmt)
    cluster = result.scalar_one_or_none()
    if cluster is not None:
        limits = await k8s_clients.get(cluster).get_cluster_queue_limits()
    if limits is None:
        limits = {"max_cpu_cores": 8.0, "max_memory_gb": 32.0}
    return limits


@router.get("/epsg-codes")
async def get_epsg_codes() -> Dict[int, str]:
    """Get all EPSG codes with names for coordinate system selection.

    Returns a dictionary mapping EPSG code (integer) to projection name (string).
    """
    logger.info(f"Returning {len(projnames.by_epsg)} EPSG codes")
    return projnames.by_epsg
