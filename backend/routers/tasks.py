"""Task API endpoints for Flyte task authentication and operations"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Dict, Any
import logging
import uuid
import json

from backend.database import get_db
from backend.models import ProcessVersion, ProcessState, Dataset, Process
from backend.services.file_service import get_dataset_file_url, get_dataset_geography_url
import fsspec

router = APIRouter(prefix="/task", tags=["Tasks"])
logger = logging.getLogger(__name__)


async def get_task_from_token(
    token: str,
    db: AsyncSession = Depends(get_db)
) -> ProcessVersion:
    """
    Dependency to validate execution token and return ProcessVersion

    Args:
        token: Execution token
        db: Database session

    Returns:
        ProcessVersion if token is valid

    Raises:
        HTTPException: If token is invalid or expired
    """
    stmt = select(ProcessVersion).where(ProcessVersion.execution_token == token)
    result = await db.execute(stmt)
    version = result.scalar_one_or_none()

    if not version:
        logger.warning(f"Invalid execution token: {token}")
        raise HTTPException(status_code=403, detail="Invalid execution token")

    # Token is only valid while process is RUNNING
    if version.state != ProcessState.RUNNING:
        logger.warning(f"Token used for non-running process: {version.state}")
        raise HTTPException(status_code=403, detail="Token expired (process not running)")

    return version


@router.get("/{token}/dataset/{dataset_id}")
async def get_dataset_for_task(
    token: str,
    dataset_id: str,
    version: ProcessVersion = Depends(get_task_from_token),
    db: AsyncSession = Depends(get_db)
):
    """
    Download dataset for Flyte task (fsspec compatible)

    Args:
        token: Execution token
        dataset_id: Dataset ID to download
        version: ProcessVersion (from token dependency)
        db: Database session

    Returns:
        Binary dataset content with appropriate mime type
    """
    logger.info(f"Task requesting dataset: {dataset_id}")

    # Fetch dataset
    stmt = select(Dataset).where(Dataset.id == dataset_id)
    result = await db.execute(stmt)
    dataset = result.scalar_one_or_none()

    if not dataset:
        logger.error(f"Dataset not found: {dataset_id}")
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Get root part file URL
    root_part = dataset.parts.get("")
    if not root_part or "file_url" not in root_part:
        logger.error(f"Dataset has no root part: {dataset_id}")
        raise HTTPException(status_code=404, detail="Dataset has no data")

    file_url = root_part["file_url"]
    mime_type = root_part.get("mime_type", "application/octet-stream")

    # Read file using fsspec
    try:
        with fsspec.open(file_url, "rb") as f:
            content = f.read()

        logger.info(f"Served dataset {dataset_id}: {len(content)} bytes")

        # Return binary content with correct mime type
        from fastapi.responses import Response
        return Response(content=content, media_type=mime_type)

    except Exception as e:
        logger.error(f"Failed to read dataset file: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to read dataset: {str(e)}")


@router.post("/{token}/output")
async def create_output_for_task(
    token: str,
    output: Dict[str, Any],
    version: ProcessVersion = Depends(get_task_from_token),
    db: AsyncSession = Depends(get_db)
):
    """
    Create output dataset for Flyte task

    Args:
        token: Execution token
        output: Output data containing:
            - name: Output name (e.g., "output", "processed")
            - data: Hex-encoded binary data
            - mime_type: MIME type
            - parts: Optional dict of additional parts
            - geography: Optional GeoJSON geography data
        version: ProcessVersion (from token dependency)
        db: Database session

    Returns:
        Created dataset info including URL
    """
    name = output.get("name")
    data_hex = output.get("data")
    mime_type = output.get("mime_type")
    parts_data = output.get("parts", {})
    geography = output.get("geography")

    if not all([name, data_hex, mime_type]):
        raise HTTPException(status_code=400, detail="Missing required fields: name, data, mime_type")

    # Decode hex data
    try:
        data = bytes.fromhex(data_hex)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid hex data: {str(e)}")

    logger.info(f"Creating output '{name}' for process {version.process_id} v{version.version}")

    # Fetch process to get project_id
    stmt = select(Process).where(Process.id == version.process_id)
    result = await db.execute(stmt)
    process = result.scalar_one_or_none()

    if not process:
        raise HTTPException(status_code=404, detail="Process not found")

    # Create dataset
    dataset_id = str(uuid.uuid4())
    dataset = Dataset(
        id=dataset_id,
        mime_type=mime_type,
        process_id=version.process_id,
        process_name=process.name,
        process_version=version.version,
        dataset_name=name,
        project_id=process.project_id,
        parts={}
    )

    # Store root part
    file_url = get_dataset_file_url(dataset_id)

    try:
        # Write data using fsspec
        with fsspec.open(file_url, "wb") as f:
            f.write(data)

        logger.info(f"Wrote dataset file: {file_url} ({len(data)} bytes)")

        # Build parts dict
        root_part = {
            "mime_type": mime_type,
            "file_url": file_url
        }

        # Add geography if provided
        if geography:
            geography_url = get_dataset_geography_url(dataset_id)
            with fsspec.open(geography_url, "w") as f:
                json.dump(geography, f)
            root_part["geography_url"] = geography_url
            logger.info(f"Wrote geography file: {geography_url}")

        dataset.parts[""] = root_part

        # Add additional parts if provided
        # (Simplified - full implementation would handle parts like the original)
        if parts_data:
            dataset.parts.update(parts_data)

        # Save to database
        db.add(dataset)
        await db.commit()
        await db.refresh(dataset)

        # Update version outputs
        dataset_url = f"{version.process.project.workspace.backend_url if hasattr(version.process.project, 'workspace') else 'http://localhost:8000'}/dataset/{dataset_id}"

        # Fetch fresh version and update outputs
        stmt = select(ProcessVersion).where(ProcessVersion.id == version.id)
        result = await db.execute(stmt)
        fresh_version = result.scalar_one()

        outputs = fresh_version.outputs or {}
        outputs[name] = dataset_url
        fresh_version.outputs = outputs

        await db.commit()

        logger.info(f"Created output dataset: {dataset_url}")

        return {
            "dataset_id": dataset_id,
            "dataset_url": dataset_url,
            "status": "created"
        }

    except Exception as e:
        logger.error(f"Failed to create output: {e}", exc_info=True)
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create output: {str(e)}")


