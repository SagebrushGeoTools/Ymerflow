from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Dict
from datetime import datetime
import uuid

from backend.database import get_db
from backend.models import Environment

router = APIRouter(prefix="/environments", tags=["Environments"])


@router.get("")
async def list_environments(db: AsyncSession = Depends(get_db)):
    """List all environments"""
    stmt = select(Environment)
    result = await db.execute(stmt)
    environments = result.scalars().all()

    return [e.to_dict() for e in environments]


@router.post("")
async def create_environment(env: Dict, db: AsyncSession = Depends(get_db)):
    """Create a new environment"""
    environment = Environment(
        id=str(uuid.uuid4()),
        name=env.get("name", "Unnamed Environment"),
        docker_image=env.get("docker_image", "python:3.11"),
        packages=env.get("packages", []),
        process_types=env.get("process_types", {}),
        created_at=datetime.utcnow()
    )

    db.add(environment)
    await db.commit()
    await db.refresh(environment)

    return environment.to_dict()


@router.get("/{env_id}/process-types")
async def get_environment_process_types(env_id: str, db: AsyncSession = Depends(get_db)):
    """Get process types for a specific environment"""
    stmt = select(Environment).where(Environment.id == env_id)
    result = await db.execute(stmt)
    environment = result.scalar_one_or_none()

    if not environment:
        raise HTTPException(status_code=404, detail="Environment not found")

    return environment.process_types
