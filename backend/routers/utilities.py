from fastapi import APIRouter
from typing import List, Dict
import logging
import projnames

router = APIRouter(prefix="/utilities", tags=["Utilities"])

logger = logging.getLogger(__name__)


@router.get("/epsg-codes")
async def get_epsg_codes() -> Dict[int, str]:
    """Get all EPSG codes with names for coordinate system selection.

    Returns a dictionary mapping EPSG code (integer) to projection name (string).
    """
    logger.info(f"Returning {len(projnames.by_epsg)} EPSG codes")
    return projnames.by_epsg
