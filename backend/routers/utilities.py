from fastapi import APIRouter
from typing import List, Dict, Optional
import logging
import projnames

from backend.services.k8s_client import k8s_client

router = APIRouter(prefix="/utilities", tags=["Utilities"])

logger = logging.getLogger(__name__)


@router.get("/resource-limits")
async def get_resource_limits():
    """Return maximum CPU cores and memory GB available for job resource requests.

    Reads nominalQuota from the Kueue ClusterQueue. Returns sensible defaults
    if the ClusterQueue cannot be reached.
    """
    limits = await k8s_client.get_cluster_queue_limits()
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
