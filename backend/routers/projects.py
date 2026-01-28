from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Dict
from datetime import datetime
import uuid
import logging

from backend.database import get_db
from backend.models import Project
from backend.services.minio_service import setup_project_storage

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/projects", tags=["Projects"])


@router.get("")
async def list_projects(db: AsyncSession = Depends(get_db)):
    """List all projects"""
    stmt = select(Project)
    result = await db.execute(stmt)
    projects = result.scalars().all()

    return [p.to_dict() for p in projects]


@router.post("")
async def create_project(project: Dict, db: AsyncSession = Depends(get_db)):
    """Create a new project and set up storage."""
    project_id = str(uuid.uuid4())

    proj = Project(
        id=project_id,
        name=project.get("name", "Unnamed Project"),
        created_at=datetime.utcnow()
    )

    db.add(proj)
    await db.commit()
    await db.refresh(proj)

    # Set up MinIO storage if enabled (runs async in background)
    # Note: We don't block project creation on storage setup
    # If MinIO setup fails, logs will show the error
    try:
        import asyncio
        loop = asyncio.get_event_loop()
        storage_result = await loop.run_in_executor(
            None,
            setup_project_storage,
            project_id
        )
        if storage_result.get("status") == "error":
            logger.error(f"Storage setup failed for project {project_id}: {storage_result.get('error')}")
        else:
            logger.info(f"Storage setup complete for project {project_id}: {storage_result}")
    except Exception as e:
        logger.error(f"Exception during storage setup for project {project_id}: {e}", exc_info=True)

    return proj.to_dict()
