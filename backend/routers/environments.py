from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional

from backend.database import get_db
from backend.models import Environment, Process

router = APIRouter(prefix="/environments", tags=["Environments"])


class CreateEnvironmentRequest(BaseModel):
    name: str
    docker_image: str
    process_id: Optional[str] = None


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

    Returns the process_types stored in the environment record, which are
    discovered and written by the create_environment process.
    """
    stmt = select(Environment).where(Environment.id == env_id)
    result = await db.execute(stmt)
    environment = result.scalar_one_or_none()

    if not environment:
        raise HTTPException(status_code=404, detail="Environment not found")

    # Return process types from environment record (may be None/empty for new environments)
    return environment.process_types or {}


@router.post("")
async def create_environment(
    request: CreateEnvironmentRequest,
    db: AsyncSession = Depends(get_db)
):
    """Create a new environment.

    This endpoint is typically called by the create_environment process
    after it has built and pushed a Docker image.
    """
    # Validate that process exists if process_id is provided
    if request.process_id:
        stmt = select(Process).where(Process.id == request.process_id)
        result = await db.execute(stmt)
        process = result.scalar_one_or_none()

        if not process:
            raise HTTPException(status_code=404, detail="Process not found")

    # Create environment
    environment = Environment(
        name=request.name,
        docker_image=request.docker_image,
        process_id=request.process_id
    )

    db.add(environment)
    await db.commit()
    await db.refresh(environment)

    return environment.to_dict()
