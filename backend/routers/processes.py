from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import Dict, Any, Optional
from pydantic import BaseModel, Field
import logging

from backend.database import get_db
from backend.models import Process, ProcessVersion, ProcessLog, Project, Environment, User, ProjectMember
from backend.services.auth_service import get_current_user, AuthContext
from backend.services.websocket_service import ws_manager

router = APIRouter(tags=["Processes"])
logger = logging.getLogger(__name__)


class ResourceRequests(BaseModel):
    cpu: str = Field("1000m", description="CPU request in Kubernetes notation, e.g. '500m' (0.5 cores) or '2' (2 cores)")
    memory: str = Field("2Gi", description="Memory request, e.g. '512Mi' or '4Gi'")
    ephemeral_storage: str = Field("10Gi", alias="ephemeral-storage", description="Temporary disk space for the job")

    model_config = {"populate_by_name": True}


class ProcessCreate(BaseModel):
    type: str = Field(..., description="Process type key, e.g. 'aem_processing' or 'aem_inversion'. Obtain valid types from get_environment_process_types.")
    environment_id: str = Field(..., description="ID of the compute environment that provides this process type. Obtain from list_environments.")
    name: Optional[str] = Field(None, description="Human-readable display name. Defaults to '<type>-process' if omitted.")
    params: Dict[str, Any] = Field(default_factory=dict, description="Process-type-specific input parameters. The required keys and their types are defined by the process type's JSON Schema (from get_environment_process_types). Dataset URLs from search_datasets can be passed here for input_data fields.")
    id: Optional[str] = Field(None, description="Existing process ID. When provided, creates a new version of that process instead of a new process record. Omit to create a fresh process.")
    resource_requests: Optional[ResourceRequests] = Field(None, description="Kubernetes resource requests for the job pod. Use defaults unless the process is known to need more resources.")
    deadline_seconds: int = Field(3600, description="Maximum wall-clock time in seconds before the job is killed. Increase for long-running inversions.")

    model_config = {"extra": "allow", "populate_by_name": True}


@router.post("/process", summary="Run a data processing job")
async def create_process(
    proc: ProcessCreate,
    project_id: str,
    auth: AuthContext = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Submit a new data processing job and return immediately.

    The job is queued and executed asynchronously in Kubernetes. Poll
    list_processes (filtering by project_id) to check when state becomes
    'done'. Retrieve output dataset URLs from the process version's outputs
    once complete, then use search_datasets or get_dataset to access results.

    Typical workflow:
    1. Call list_environments to find an environment_id.
    2. Call get_environment_process_types to see available types and their parameter schemas.
    3. Build params from the chosen type's schema.
    4. Call this endpoint with type, environment_id, and params.
    5. Poll list_processes until state == 'done' or 'failed'.
    6. On failure, call get_process_logs to diagnose.
    """
    if not project_id:
        raise HTTPException(status_code=400, detail="project_id is required")

    # Enforce API key scope
    if auth.api_key_project_id is not None and auth.api_key_project_id != project_id:
        raise HTTPException(status_code=403, detail="API key is not scoped to this project")

    # Verify project exists and user is a member
    stmt = (
        select(Project)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .where(Project.id == project_id, ProjectMember.user_id == auth.user.id)
    )
    result = await db.execute(stmt)
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=403, detail="Project not found or not a member")

    environment_id = proc.environment_id
    stmt = select(Environment).where(Environment.id == environment_id)
    result = await db.execute(stmt)
    environment = result.scalar_one_or_none()
    if not environment:
        raise HTTPException(status_code=400, detail="Valid environment_id is required")

    # Convert Pydantic model back to dict for create_queued (existing contract)
    proc_dict = proc.model_dump(by_alias=True, exclude_none=True)

    process, version = await Process.create_queued(
        db=db,
        proc=proc_dict,
        project_id=project_id,
        environment_id=environment_id,
        username=auth.user.username
    )

    return {"id": process.id, "versions": [{"version": version}]}


@router.get("/processes", summary="List data processing jobs")
async def list_processes(
    project_id: Optional[str] = None,
    auth: AuthContext = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """List processes (jobs) the current user can access, with their status and outputs.

    Each process has a 'versions' array. Each version has:
    - state: 'queued' | 'running' | 'done' | 'failed'
    - outputs: dict mapping output name → dataset URL (populated when state == 'done')
    - parameters: the input params the job was run with

    Filter by project_id to narrow results. Without project_id, returns all
    processes across all the user's projects (or, for API key auth, just the
    key's scoped project).
    """
    stmt = select(Process).options(
        selectinload(Process.versions).selectinload(ProcessVersion.datasets),
        selectinload(Process.logs)
    )

    if project_id:
        # Enforce API key scope
        if auth.api_key_project_id is not None and auth.api_key_project_id != project_id:
            raise HTTPException(status_code=403, detail="API key is not scoped to this project")

        member_stmt = select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == auth.user.id
        )
        member_result = await db.execute(member_stmt)
        if not member_result.scalar_one_or_none():
            raise HTTPException(status_code=403, detail="Not a member of this project")
        stmt = stmt.where(Process.project_id == project_id)
    else:
        # When using an API key, restrict to the key's project
        if auth.api_key_project_id is not None:
            stmt = stmt.where(Process.project_id == auth.api_key_project_id)
        else:
            user_projects = select(ProjectMember.project_id).where(
                ProjectMember.user_id == auth.user.id
            ).scalar_subquery()
            stmt = stmt.where(Process.project_id.in_(user_projects))

    result = await db.execute(stmt)
    processes = result.scalars().all()

    return [p.to_dict() for p in processes]


@router.get("/process/{process_id}/logs", summary="Get job execution logs")
async def get_process_logs(
    process_id: str,
    version: Optional[int] = None,
    db: AsyncSession = Depends(get_db)
):
    """Retrieve execution logs for a process job, optionally filtered to a specific version.

    Use this to diagnose why a job failed (state == 'failed'). Log entries
    include timestamps and log levels. If version is omitted, returns logs
    for all versions of the process.
    """
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
        await websocket.send_json({"refetch": True})

        while True:
            await websocket.receive_text()

    except WebSocketDisconnect:
        await ws_manager.disconnect_state(websocket)
    except Exception:
        await ws_manager.disconnect_state(websocket)
