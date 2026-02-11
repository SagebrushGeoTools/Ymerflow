from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.database import get_db
from backend.models import System

router = APIRouter(prefix="/systems", tags=["Systems"])


@router.get("")
async def list_systems(db: AsyncSession = Depends(get_db)):
    """List all systems"""
    stmt = select(System)
    result = await db.execute(stmt)
    systems = result.scalars().all()

    return [s.to_dict() for s in systems]
