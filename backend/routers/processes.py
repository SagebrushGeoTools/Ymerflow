from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import Dict, Any, Optional
import logging

from backend.database import get_db
from backend.models import Process, ProcessVersion, ProcessLog, Project, Environment, User
from backend.models.project_member import ProjectMember
from backend.services.auth_service import get_current_user
from backend.services.project_member_service import require_project_member
from backend.services.websocket_service import ws_manager

router = APIRouter(tags=["Processes"])
logger = logging.getLogger(__name__)


@router.post("/process")
async def create_process(
    proc: Dict[str, Any],
    project_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Create a new process - returns immediately, execution runs in background."""
    if not project_id:
        raise HTTPException(status_code=400, detail="project_id is required")

    stmt = select(Project).where(Project.id == project_id)
    result = await db.execute(stmt)
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=400, detail="Valid project_id is required")

    await require_project_member(db, current_user, project_id)

    environment_id = proc.get("environment_id")
    if not environment_id:
        raise HTTPException(status_code=400, detail="environment_id is required")

    stmt = select(Environment).where(Environment.id == environment_id)
    result = await db.execute(stmt)
    environment = result.scalar_one_or_none()
    if not environment:
        raise HTTPException(status_code=400, detail="Valid environment_id is required")

    process, version = await Process.create_queued(
        db=db,
        proc=proc,
        project_id=project_id,
        environment_id=environment_id,
        username=current_user.username
    )

    return {"id": process.id, "versions": [{"version": version}]}


@router.get("/processes")
async def list_processes(
    project_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """List processes, filtered by project. Only returns processes in projects the user is a member of."""
    stmt = select(Process).options(
        selectinload(Process.versions).selectinload(ProcessVersion.datasets),
        selectinload(Process.logs)
    )

    if project_id:
        await require_project_member(db, current_user, project_id)
        stmt = stmt.where(Process.project_id == project_id)
    else:
        # Only show processes in projects the user is a member of
        stmt = stmt.join(
            ProjectMember,
            (ProjectMember.project_id == Process.project_id) & (ProjectMember.user_id == current_user.id)
        )

    result = await db.execute(stmt)
    processes = result.scalars().all()

    return [p.to_dict() for p in processes]


@router.get("/process/{process_id}/logs")
async def get_process_logs(
    process_id: str,
    version: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get logs for a specific process version"""
    stmt = select(Process).where(Process.id == process_id)
    result = await db.execute(stmt)
    process = result.scalar_one_or_none()
    if not process:
        raise HTTPException(status_code=404, detail="Process not found")

    await require_project_member(db, current_user, process.project_id)

    stmt = select(ProcessLog).where(ProcessLog.process_id == process_id)
    if version is not None:
        stmt = stmt.where(ProcessLog.version == version)
    stmt = stmt.order_by(ProcessLog.timestamp)

    result = await db.execute(stmt)
    logs = result.scalars().all()

    return [log.to_dict() for log in logs]


@router.websocket("/ws/process/{process_id}/logs")
async def process_logs_websocket(websocket: WebSocket, process_id: str, version: Optional[int] = None):
    """WebSocket endpoint for streaming process logs"""
    await websocket.accept()
    await ws_manager.connect_logs(process_id, websocket)

    try:
        # Send existing logs first
        from backend.database import async_session_maker
        async with async_session_maker() as db:
            stmt = select(ProcessLog).where(ProcessLog.process_id == process_id)
            if version is not None:
                stmt = stmt.where(ProcessLog.version == version)
            stmt = stmt.order_by(ProcessLog.timestamp)

            result = await db.execute(stmt)
            logs = result.scalars().all()

            for log in logs:
                await websocket.send_json(log.to_dict())

        # Keep connection alive and listen for disconnection
        while True:
            await websocket.receive_text()

    except WebSocketDisconnect:
        await ws_manager.disconnect_logs(process_id, websocket)
    except Exception:
        await ws_manager.disconnect_logs(process_id, websocket)


@router.websocket("/ws/processes/updates")
async def process_state_websocket(websocket: WebSocket):
    """WebSocket endpoint for streaming global process state updates"""
    await websocket.accept()
    await ws_manager.connect_state(websocket)

    try:
        # Send message to trigger refetch
        await websocket.send_json({"refetch": True})

        # Keep connection alive and listen for disconnection
        while True:
            await websocket.receive_text()

    except WebSocketDisconnect:
        await ws_manager.disconnect_state(websocket)
    except Exception:
        await ws_manager.disconnect_state(websocket)
