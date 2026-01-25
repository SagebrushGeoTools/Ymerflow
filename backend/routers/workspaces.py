from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Dict
from datetime import datetime

from backend.database import get_db
from backend.models import Workspace

router = APIRouter(prefix="/workspace", tags=["Workspaces"])


@router.get("s")
async def list_workspaces(db: AsyncSession = Depends(get_db)):
    """List workspace summaries (id, title, created_at)"""
    stmt = select(Workspace)
    result = await db.execute(stmt)
    workspaces = result.scalars().all()

    return [w.to_dict(include_layout=False) for w in workspaces]


@router.get("/{workspace_id}")
async def get_workspace(workspace_id: str, db: AsyncSession = Depends(get_db)):
    """Get full workspace with layout"""
    stmt = select(Workspace).where(Workspace.id == workspace_id)
    result = await db.execute(stmt)
    workspace = result.scalar_one_or_none()

    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    return workspace.to_dict(include_layout=True)


@router.post("")
async def save_workspace(workspace: Dict, db: AsyncSession = Depends(get_db)):
    """Save or update workspace"""
    workspace_id = workspace.get("id")
    title = workspace.get("title", "Untitled Workspace")
    layout = workspace.get("layout", {})

    if workspace_id:
        # Update existing workspace
        stmt = select(Workspace).where(Workspace.id == workspace_id)
        result = await db.execute(stmt)
        ws = result.scalar_one_or_none()

        if ws:
            ws.title = title
            ws.layout = layout
            ws.updated_at = datetime.utcnow()
        else:
            # Create new workspace with specified ID
            ws = Workspace(
                id=workspace_id,
                title=title,
                layout=layout
            )
            db.add(ws)
    else:
        # Create new workspace with auto-generated ID
        import uuid
        ws = Workspace(
            id=str(uuid.uuid4()),
            title=title,
            layout=layout
        )
        db.add(ws)

    await db.commit()
    await db.refresh(ws)

    return ws.to_dict(include_layout=True)


@router.delete("/{workspace_id}")
async def delete_workspace(workspace_id: str, db: AsyncSession = Depends(get_db)):
    """Delete workspace (cannot delete 'default')"""
    if workspace_id == "default":
        raise HTTPException(status_code=400, detail="Cannot delete default workspace")

    stmt = select(Workspace).where(Workspace.id == workspace_id)
    result = await db.execute(stmt)
    workspace = result.scalar_one_or_none()

    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    await db.delete(workspace)
    await db.commit()

    return {"message": "Workspace deleted successfully"}
