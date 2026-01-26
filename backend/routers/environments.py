from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from backend.database import get_db
from backend.models import Environment, Process, ProcessVersion

router = APIRouter(prefix="/environments", tags=["Environments"])


@router.get("")
async def list_environments(db: AsyncSession = Depends(get_db)):
    """List all environments"""
    stmt = select(Environment)
    result = await db.execute(stmt)
    environments = result.scalars().all()

    return [e.to_dict() for e in environments]


@router.get("/{env_id}/process-types")
async def get_environment_process_types(env_id: str, db: AsyncSession = Depends(get_db)):
    """Get process types for a specific environment.

    For bootstrap environment (process_id=NULL), returns default PROCESS_TYPES.
    For process-created environments, extracts process_types from creating process parameters.
    """
    stmt = select(Environment).where(Environment.id == env_id)
    result = await db.execute(stmt)
    environment = result.scalar_one_or_none()

    if not environment:
        raise HTTPException(status_code=404, detail="Environment not found")

    # Bootstrap environment: return default process types from main.py
    if environment.process_id is None:
        from backend.main import PROCESS_TYPES
        return PROCESS_TYPES

    # Process-created environment: get process types from creating process
    stmt = (
        select(Process)
        .where(Process.id == environment.process_id)
        .options(selectinload(Process.versions))
    )
    result = await db.execute(stmt)
    process = result.scalar_one_or_none()

    if not process:
        raise HTTPException(status_code=404, detail="Creating process not found")

    # Get latest version
    if not process.versions:
        raise HTTPException(status_code=404, detail="No process versions found")

    latest_version = max(process.versions, key=lambda v: v.version)
    process_types = latest_version.parameters.get("process_types", {})

    return process_types
