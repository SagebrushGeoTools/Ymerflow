from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from typing import Optional
import fsspec
import re

from backend.database import get_db
from backend.models import Dataset, ProcessVersion, ProcessState
from backend.config import settings

router = APIRouter(tags=["Datasets"])


@router.get("/datasets")
async def search_datasets(
    search: str = "",
    completed_only: bool = True,
    project_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Search datasets by process name or dataset name"""
    stmt = select(Dataset)

    # Filter by project_id if provided
    if project_id:
        stmt = stmt.where(Dataset.project_id == project_id)

    # Filter by search text
    if search:
        stmt = stmt.where(
            or_(
                Dataset.process_name.ilike(f"%{search}%"),
                Dataset.dataset_name.ilike(f"%{search}%")
            )
        )

    result = await db.execute(stmt)
    datasets = result.scalars().all()

    # Filter by completed processes if requested
    if completed_only:
        # Get completed process versions
        version_stmt = select(ProcessVersion).where(ProcessVersion.state == ProcessState.DONE)
        version_result = await db.execute(version_stmt)
        completed_versions = version_result.scalars().all()

        # Create set of (process_id, version) tuples
        completed_set = {(v.process_id, v.version) for v in completed_versions}

        # Filter datasets
        datasets = [
            d for d in datasets
            if (d.process_id, d.process_version) in completed_set
        ]

    return [d.to_dict() for d in datasets]


@router.get("/dataset/{dataset_id}")
async def get_dataset(dataset_id: str, db: AsyncSession = Depends(get_db)):
    """Get dataset metadata"""
    stmt = select(Dataset).where(Dataset.id == dataset_id)
    result = await db.execute(stmt)
    dataset = result.scalar_one_or_none()

    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    return dataset.to_dict()


@router.get("/dataset/{dataset_id}/data")
async def get_dataset_data(dataset_id: str, db: AsyncSession = Depends(get_db)):
    """Get dataset content (root part)"""
    # Root part is stored with empty string key
    return await get_dataset_part_data(dataset_id, "", db)


@router.get("/dataset/{dataset_id}/geography")
async def get_dataset_geography(dataset_id: str, db: AsyncSession = Depends(get_db)):
    """Get GeoJSON geography for a dataset (root part)"""
    # Root part is stored with empty string key
    return await get_dataset_part_geography(dataset_id, "", db)


@router.get("/dataset/{dataset_id}/{part_path:path}/data")
async def get_dataset_part_data(dataset_id: str, part_path: str, db: AsyncSession = Depends(get_db)):
    """Get data for a specific part of a dataset"""
    stmt = select(Dataset).where(Dataset.id == dataset_id)
    result = await db.execute(stmt)
    dataset = result.scalar_one_or_none()

    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Get part info
    part_info = dataset.parts.get(part_path)
    if not part_info:
        raise HTTPException(status_code=404, detail="Part not found")

    # Read part file from storage
    part_file_url = part_info.get("file_url")
    if not part_file_url:
        raise HTTPException(status_code=404, detail="Part data not found")

    with fsspec.open(part_file_url, 'rb') as f:
        data = f.read()

    return Response(
        content=data,
        media_type=part_info["mime_type"]
    )


@router.get("/dataset/{dataset_id}/{part_path:path}/geography")
async def get_dataset_part_geography(dataset_id: str, part_path: str, db: AsyncSession = Depends(get_db)):
    """Get GeoJSON geography for a specific part of a dataset"""
    stmt = select(Dataset).where(Dataset.id == dataset_id)
    result = await db.execute(stmt)
    dataset = result.scalar_one_or_none()

    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Get part info
    part_info = dataset.parts.get(part_path)
    if not part_info:
        raise HTTPException(status_code=404, detail="Part not found")

    # Read pre-generated GeoJSON from storage
    part_geography_url = part_info.get("geography_url")
    if not part_geography_url:
        raise HTTPException(status_code=404, detail="Part geography not found")

    with fsspec.open(part_geography_url, 'r') as f:
        data = f.read()

    return Response(
        content=data,
        media_type="application/geo+json"
    )


@router.get("/files/{path:path}")
async def get_file(path: str):
    """Unified file endpoint for datasets and uploads.

    Translates HTTP paths to storage URLs and serves the files.

    Examples:
        /files/project-bucket/processes/proc-123/datasets/ds-456/root.msgpack
        -> s3://project-bucket/processes/proc-123/datasets/ds-456/root.msgpack

        /files/project-bucket/uploads/up-789/file.csv
        -> s3://project-bucket/uploads/up-789/file.csv
    """
    # Construct storage URL
    protocol = settings.storage_protocol
    storage_url = f"{protocol}://{path}"

    # Determine MIME type based on file extension
    mime_type = "application/octet-stream"
    if path.endswith('.msgpack'):
        mime_type = "application/x-aarhusxyz-msgpack"
    elif path.endswith('.geojson'):
        mime_type = "application/geo+json"
    elif path.endswith('.json'):
        mime_type = "application/json"
    elif path.endswith('.csv'):
        mime_type = "text/csv"
    elif path.endswith('.txt'):
        mime_type = "text/plain"

    # Read file from storage
    try:
        # For text/JSON files, read as text
        if mime_type in ("application/geo+json", "application/json", "text/csv", "text/plain"):
            with fsspec.open(storage_url, 'r') as f:
                data = f.read()
        else:
            with fsspec.open(storage_url, 'rb') as f:
                data = f.read()

        # Determine if this is a download (uploads) or inline (datasets)
        headers = {}
        if '/uploads/' in path:
            # Extract filename from path
            filename = path.split('/')[-1]
            headers["Content-Disposition"] = f'attachment; filename="{filename}"'

        return Response(
            content=data,
            media_type=mime_type,
            headers=headers
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading file: {str(e)}")
