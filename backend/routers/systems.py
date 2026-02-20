from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import msgpack
import msgpack_numpy as m

from backend.database import get_db
from backend.models import System

# Configure msgpack to handle numpy arrays
m.patch()

router = APIRouter(prefix="/systems", tags=["Systems"])


@router.get("")
async def list_systems(db: AsyncSession = Depends(get_db)):
    """List all systems, returns msgpack to preserve numpy arrays"""
    stmt = select(System)
    result = await db.execute(stmt)
    systems = result.scalars().all()

    # Build response with gex as nested msgpack data
    systems_data = []
    for s in systems:
        # Unpack the gex msgpack to get the dict with numpy arrays
        gex_data = msgpack.unpackb(s.gex, raw=False)
        systems_data.append({
            "id": s.id,
            "name": s.name,
            "gex": gex_data,
            "created_at": s.created_at.isoformat()
        })

    # Pack the entire response as msgpack
    response_bytes = msgpack.packb(systems_data, use_bin_type=True)

    return Response(content=response_bytes, media_type="application/x-msgpack")
