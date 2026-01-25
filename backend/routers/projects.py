from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Dict
from datetime import datetime
import uuid

from backend.database import get_db
from backend.models import Project

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
    """Create a new project"""
    proj = Project(
        id=str(uuid.uuid4()),
        name=project.get("name", "Unnamed Project"),
        created_at=datetime.utcnow()
    )

    db.add(proj)
    await db.commit()
    await db.refresh(proj)

    return proj.to_dict()
