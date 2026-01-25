from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import Dict, Any, Optional
import logging

from backend.database import get_db
from backend.models import Process, ProcessVersion, ProcessLog, Project, Environment, User
from backend.services.auth_service import get_current_user
from backend.services.websocket_service import ws_manager

router = APIRouter(tags=["Processes"])
logger = logging.getLogger(__name__)


@router.post("/process")
async def create_process(
    request: Request,
    proc: Dict[str, Any],
    project_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Create a new process or add a new version to an existing process"""
    logger.info(f"Process creation request - Headers: {dict(request.headers)}")
    logger.info(f"Current user: {current_user.username if current_user else 'None'}")
    # Validate project_id
    if not project_id:
        raise HTTPException(status_code=400, detail="project_id is required")

    stmt = select(Project).where(Project.id == project_id)
    result = await db.execute(stmt)
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(status_code=400, detail="Valid project_id is required")

    # Validate environment_id
    environment_id = proc.get("environment_id")
    if not environment_id:
        raise HTTPException(status_code=400, detail="environment_id is required")

    stmt = select(Environment).where(Environment.id == environment_id)
    result = await db.execute(stmt)
    environment = result.scalar_one_or_none()

    if not environment:
        raise HTTPException(status_code=400, detail="Valid environment_id is required")

    # Create process with outputs
    process = await Process.create_with_outputs(
        db=db,
        proc=proc,
        project_id=project_id,
        environment_id=environment_id,
        username=current_user.username
    )

    # Refresh with relationships eagerly loaded
    stmt = select(Process).options(
        selectinload(Process.versions),
        selectinload(Process.logs)
    ).where(Process.id == process.id)
    result = await db.execute(stmt)
    process = result.scalar_one()

    return process.to_dict()


@router.get("/processes")
async def list_processes(
    project_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """List all processes, optionally filtered by project_id"""
    stmt = select(Process).options(
        selectinload(Process.versions),
        selectinload(Process.logs)
    )

    if project_id:
        stmt = stmt.where(Process.project_id == project_id)

    result = await db.execute(stmt)
    processes = result.scalars().all()

    return [p.to_dict() for p in processes]


@router.get("/process/{process_id}/logs")
async def get_process_logs(
    process_id: str,
    version: Optional[int] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get logs for a specific process version"""
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
