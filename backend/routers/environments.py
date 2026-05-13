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


@router.get("", summary="List compute environments")
async def list_environments(db: AsyncSession = Depends(get_db)):
    """List all available compute environments.

    An environment is a Docker image registered in the platform that provides
    one or more process types. Each environment has an 'id' (pass as
    environment_id to create_process) and a 'name'. To see which process types
    an environment exposes and their parameter schemas, call
    get_environment_process_types with the environment id.
    """
    stmt = select(Environment)
    result = await db.execute(stmt)
    environments = result.scalars().all()

    return [e.to_dict() for e in environments]


@router.get("/{env_id}/process-types", summary="Get available process types and their schemas")
async def get_environment_process_types(env_id: str, db: AsyncSession = Depends(get_db)):
    """Return the process types available in an environment, keyed by type name.

    Each entry contains a JSON Schema describing the required and optional
    'params' for that process type. Use the schema to build the params dict
    when calling create_process. Dataset URL inputs will have
    'x-format': 'dataset' in their schema — pass a URL from search_datasets.

    Returns null or an empty dict if the environment has not finished
    registering its process types yet (environment setup is itself a process).
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
