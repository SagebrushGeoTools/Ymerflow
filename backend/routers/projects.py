from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Dict
from datetime import datetime
import asyncio
import uuid
import logging

from backend.database import get_db
from backend.models import Project, User
from backend.models.project_member import ProjectMember
from backend.services.minio_service import setup_project_storage
from backend.services.auth_service import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/projects", tags=["Projects"])


async def _setup_storage_background(project_id: str):
    """Run MinIO/kubectl storage setup in a thread without blocking the HTTP response."""
    try:
        storage_result = await asyncio.to_thread(setup_project_storage, project_id)
        if storage_result.get("status") == "error":
            logger.error(f"Storage setup failed for project {project_id}: {storage_result.get('error')}")
        else:
            logger.info(f"Storage setup complete for project {project_id}: {storage_result}")
    except Exception as e:
        logger.error(f"Exception during storage setup for project {project_id}: {e}", exc_info=True)


@router.get("")
async def list_projects(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """List all projects the current user is a member of."""
    stmt = (
        select(Project, ProjectMember.role)
        .join(
            ProjectMember,
            (ProjectMember.project_id == Project.id) & (ProjectMember.user_id == current_user.id)
        )
    )
    result = await db.execute(stmt)
    rows = result.all()
    return [project.to_dict(my_role=role) for project, role in rows]


@router.post("")
async def create_project(
    project: Dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Create a new project. The creator is automatically added as admin."""
    project_id = str(uuid.uuid4())

    proj = Project(
        id=project_id,
        name=project.get("name", "Unnamed Project"),
        created_at=datetime.utcnow()
    )
    db.add(proj)
    await db.flush()

    member = ProjectMember(
        project_id=project_id,
        user_id=current_user.id,
        role="admin",
        created_at=datetime.utcnow(),
    )
    db.add(member)
    await db.commit()
    await db.refresh(proj)

    asyncio.create_task(_setup_storage_background(project_id))

    return proj.to_dict(my_role="admin")
