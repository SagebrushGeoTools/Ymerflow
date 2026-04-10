from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.models.project_member import ProjectMember


async def get_user_project_role(db: AsyncSession, user_id: int, project_id: str) -> str | None:
    """Returns 'admin', 'member', or None if the user is not a member."""
    stmt = select(ProjectMember).where(
        ProjectMember.project_id == project_id,
        ProjectMember.user_id == user_id,
    )
    result = await db.execute(stmt)
    member = result.scalar_one_or_none()
    return member.role if member else None


async def require_project_member(db: AsyncSession, user, project_id: str) -> str:
    """Raises HTTP 403 if the user is not a member of the project. Returns the role."""
    role = await get_user_project_role(db, user.id, project_id)
    if role is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this project",
        )
    return role


async def require_project_admin(db: AsyncSession, user, project_id: str) -> None:
    """Raises HTTP 403 if the user is not an admin of the project."""
    role = await require_project_member(db, user, project_id)
    if role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required for this action",
        )
