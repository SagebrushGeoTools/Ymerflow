from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import Dict
from datetime import datetime

from backend.database import get_db
from backend.models import User
from backend.models.project_member import ProjectMember
from backend.services.auth_service import get_current_user
from backend.services.project_member_service import require_project_member, require_project_admin

router = APIRouter(prefix="/projects/{project_id}/members", tags=["Project Members"])


@router.get("")
async def list_members(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all members of a project. Requires project membership."""
    await require_project_member(db, current_user, project_id)

    stmt = (
        select(ProjectMember)
        .where(ProjectMember.project_id == project_id)
        .options(selectinload(ProjectMember.user))
    )
    result = await db.execute(stmt)
    members = result.scalars().all()
    return [m.to_dict() for m in members]


@router.post("")
async def invite_member(
    project_id: str,
    body: Dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Invite a user to a project by username. Requires admin role."""
    await require_project_admin(db, current_user, project_id)

    username = body.get("username", "").strip().lower()
    if not username:
        raise HTTPException(status_code=400, detail="username is required")

    stmt = select(User).where(User.username == username)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail=f"User '{username}' not found")

    stmt = select(ProjectMember).where(
        ProjectMember.project_id == project_id,
        ProjectMember.user_id == user.id,
    )
    result = await db.execute(stmt)
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="User is already a member of this project")

    role = body.get("role", "member")
    if role not in ("admin", "member"):
        raise HTTPException(status_code=400, detail="role must be 'admin' or 'member'")

    member = ProjectMember(
        project_id=project_id,
        user_id=user.id,
        role=role,
        created_at=datetime.utcnow(),
    )
    db.add(member)
    await db.commit()

    stmt = (
        select(ProjectMember)
        .where(ProjectMember.project_id == project_id, ProjectMember.user_id == user.id)
        .options(selectinload(ProjectMember.user))
    )
    result = await db.execute(stmt)
    member = result.scalar_one()
    return member.to_dict()


@router.put("/{user_id}")
async def update_member_role(
    project_id: str,
    user_id: int,
    body: Dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a member's role. Requires admin role. Cannot change own role."""
    await require_project_admin(db, current_user, project_id)

    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot change your own role")

    role = body.get("role")
    if role not in ("admin", "member"):
        raise HTTPException(status_code=400, detail="role must be 'admin' or 'member'")

    stmt = (
        select(ProjectMember)
        .where(ProjectMember.project_id == project_id, ProjectMember.user_id == user_id)
        .options(selectinload(ProjectMember.user))
    )
    result = await db.execute(stmt)
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    member.role = role
    await db.commit()
    await db.refresh(member)
    return member.to_dict()


@router.delete("/{user_id}")
async def remove_member(
    project_id: str,
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove a member from a project. Requires admin role. Cannot remove self."""
    await require_project_admin(db, current_user, project_id)

    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot remove yourself from the project")

    stmt = select(ProjectMember).where(
        ProjectMember.project_id == project_id,
        ProjectMember.user_id == user_id,
    )
    result = await db.execute(stmt)
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    await db.delete(member)
    await db.commit()
    return {"message": "Member removed"}
