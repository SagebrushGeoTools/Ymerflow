import asyncio
import uuid
from datetime import datetime
from typing import Dict, Any
from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.models import (
    Process, ProcessVersion, ProcessLog, ProcessState,
    Dataset, User, UserTransaction, TransactionType,
    Environment
)
from backend.services.websocket_service import ws_manager
from backend.services.file_service import write_file, get_dataset_file_url
from backend.utils.xyz_utils import create_mock_xyz, xyz_to_msgpack
from backend.config import settings


async def add_log_entry(db: AsyncSession, process_id: str, version: int, message: str):
    """Add a log entry and broadcast to connected clients"""
    log_entry = ProcessLog(
        process_id=process_id,
        version=version,
        timestamp=datetime.utcnow(),
        message=message
    )

    db.add(log_entry)
    await db.commit()

    # Broadcast to connected WebSocket clients
    await ws_manager.broadcast_log(process_id, log_entry.to_dict())


async def update_process_state(db: AsyncSession, process_id: str, version: int, new_state: ProcessState):
    """Update process state and broadcast to all state listeners"""
    import logging
    logger = logging.getLogger(__name__)

    # Fetch the process version
    stmt = select(ProcessVersion).join(Process).where(
        Process.id == process_id,
        ProcessVersion.version == version
    )
    result = await db.execute(stmt)
    process_version = result.scalar_one_or_none()

    if not process_version:
        logger.error(f"Process version not found: {process_id} v{version}")
        return

    logger.info(f"Updating process state: {process_id} v{version} -> {new_state.value}")
    process_version.state = new_state
    await db.commit()

    # Broadcast state change to all connected clients
    state_update = {
        "process_id": process_id,
        "version": version,
        "state": new_state.value
    }

    logger.info(f"Broadcasting state update: {state_update}")
    await ws_manager.broadcast_state(state_update)


async def run_process_task(process_id: str, version: int):
    """Simulate running a process with fake log messages"""
    import logging
    from backend.database import async_session_maker

    logger = logging.getLogger(__name__)
    logger.info(f"🚀 Starting process task: {process_id} v{version}")

    try:
        # Wait a moment to simulate queue time
        await asyncio.sleep(1)

        async with async_session_maker() as db:
            # Transition to running
            logger.info(f"▶️ Transitioning to RUNNING: {process_id} v{version}")
            await update_process_state(db, process_id, version, ProcessState.RUNNING)
            await add_log_entry(db, process_id, version, "Process started")

            # Simulate processing with realistic log messages
            log_messages = [
                "Initializing processing environment...",
                "Loading input datasets...",
                "Validating input parameters...",
                "Setting up computation pipeline...",
                "Processing data chunks (1/5)...",
                "Processing data chunks (2/5)...",
                "Processing data chunks (3/5)...",
                "Processing data chunks (4/5)...",
                "Processing data chunks (5/5)...",
                "Aggregating results...",
                "Generating output datasets...",
                "Process completed successfully"
            ]

            for msg in log_messages:
                await asyncio.sleep(0.4)  # Simulate work
                await add_log_entry(db, process_id, version, msg)

            # Transition to done
            logger.info(f"✅ Transitioning to DONE: {process_id} v{version}")
            await update_process_state(db, process_id, version, ProcessState.DONE)
            logger.info(f"✅ Process task completed: {process_id} v{version}")
    except Exception as e:
        logger.error(f"❌ Process task failed: {process_id} v{version} - {str(e)}", exc_info=True)


def extract_dependencies(params: Dict[str, Any]) -> list:
    """Extract dataset URLs from params and build dependency list"""
    dependencies = []

    def find_dataset_urls(obj, path=""):
        """Recursively find dataset URLs in nested structures"""
        if isinstance(obj, str):
            if obj.startswith("http://localhost:8000/dataset/"):
                # Extract dataset_id from URL
                dataset_id = obj.split("/")[-1]
                # Note: We can't query the database here synchronously
                # Store the dataset_id for now, the endpoint will resolve it
                dependencies.append({
                    "source_dataset_id": dataset_id,
                    "target_param_name": path
                })
        elif isinstance(obj, dict):
            for key, value in obj.items():
                new_path = f"{path}.{key}" if path else key
                find_dataset_urls(value, new_path)
        elif isinstance(obj, list):
            for i, item in enumerate(obj):
                new_path = f"{path}[{i}]"
                find_dataset_urls(item, new_path)

    find_dataset_urls(params)
    return dependencies


async def resolve_dependencies(db: AsyncSession, dependencies: list) -> list:
    """Resolve dataset IDs to full dependency objects"""
    resolved = []

    for dep in dependencies:
        dataset_id = dep.get("source_dataset_id")
        if dataset_id:
            stmt = select(Dataset).where(Dataset.id == dataset_id)
            result = await db.execute(stmt)
            dataset = result.scalar_one_or_none()

            if dataset:
                resolved.append({
                    "source_process_id": dataset.process_id,
                    "source_process_version": dataset.process_version,
                    "source_dataset_name": dataset.dataset_name,
                    "target_param_name": dep["target_param_name"]
                })

    return resolved


async def create_process_with_outputs(
    db: AsyncSession,
    proc: Dict[str, Any],
    project_id: str,
    environment_id: str,
    username: str
) -> Process:
    """
    Create a process with output datasets

    Args:
        db: Database session
        proc: Process data dict
        project_id: Project ID
        environment_id: Environment ID
        username: Username for billing

    Returns:
        Created/updated Process object
    """
    # Deduct cost from user balance
    stmt = select(User).where(User.username == username)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user:
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="User not found")

    if user.balance < Decimal(str(settings.process_cost)):
        from fastapi import HTTPException
        raise HTTPException(status_code=402, detail="Insufficient balance")

    user.balance -= Decimal(str(settings.process_cost))

    # Check if this is a new version of an existing process
    existing_id = proc.get("id")
    process = None

    if existing_id:
        stmt = select(Process).where(Process.id == existing_id)
        result = await db.execute(stmt)
        process = result.scalar_one_or_none()

    if process:
        # Adding new version to existing process
        new_version = len(process.versions) + 1
    else:
        # Creating new process
        process = Process(
            id=str(uuid.uuid4()),
            name=proc.get("name", f"{proc['type']}-process"),
            type=proc["type"],
            environment_id=environment_id,
            project_id=project_id
        )
        db.add(process)
        new_version = 1

    # Create output datasets for this version
    outputs = {}
    output_names = ["output", "processed"]  # Default output names

    for output_name in output_names:
        dataset_id = str(uuid.uuid4())

        # Create XYZ dataset with msgpack format
        xyz_data = create_mock_xyz(process_type=proc["type"])
        msgpack_data = xyz_to_msgpack(xyz_data)

        # Store XYZ data to file
        file_url = get_dataset_file_url(dataset_id)
        await write_file(file_url, msgpack_data)

        # Create parts structure from unique values in "title" column
        parts = {}
        if "title" in xyz_data["xyz"].flightlines.columns:
            unique_titles = xyz_data["xyz"].flightlines["title"].unique()
            for title in unique_titles:
                import pandas as pd
                # Convert numpy types to Python native types for JSON serialization
                title_str = str(title) if pd.notna(title) else "unknown"
                part_file_url = get_dataset_file_url(dataset_id, title_str)

                # Extract and save part data
                from backend.utils.xyz_utils import extract_xyz_part
                part_xyz = extract_xyz_part(xyz_data, title_str)
                if part_xyz:
                    part_msgpack = xyz_to_msgpack(part_xyz)
                    await write_file(part_file_url, part_msgpack)

                parts[title_str] = {
                    "mime_type": "application/x-aarhusxyz-msgpack",
                    "file_url": part_file_url
                }

        dataset = Dataset(
            id=dataset_id,
            mime_type="application/x-aarhusxyz-msgpack",
            process_id=process.id,
            process_name=process.name,
            process_version=new_version,
            dataset_name=output_name,
            project_id=project_id,
            parts=parts,
            file_url=file_url
        )

        db.add(dataset)
        outputs[output_name] = f"http://localhost:8000/dataset/{dataset_id}"

    # Extract and resolve dependencies
    raw_dependencies = extract_dependencies(proc.get("params", {}))
    dependencies = await resolve_dependencies(db, raw_dependencies)

    # Create version object
    version_obj = ProcessVersion(
        process_id=process.id,
        version=new_version,
        parameters=proc.get("params", {}),
        outputs=outputs,
        state=ProcessState.QUEUED,
        dependencies=dependencies
    )

    db.add(version_obj)

    # Record transaction for process cost
    transaction = UserTransaction(
        user_id=user.id,
        timestamp=datetime.utcnow(),
        type=TransactionType.DEBIT,
        description=f"Process run: {process.name}",
        amount=Decimal(str(settings.process_cost)),
        process_id=process.id,
        process_version=new_version,
        process_name=process.name
    )
    db.add(transaction)

    await db.commit()
    await db.refresh(process)

    # Broadcast initial queued state
    await update_process_state(db, process.id, new_version, ProcessState.QUEUED)

    # Start background task to run the process
    asyncio.create_task(run_process_task(process.id, new_version))

    return process
