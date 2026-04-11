from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, cast, String
from sqlalchemy.orm import selectinload
from typing import Optional
import asyncio
import fsspec
import re

from backend.database import get_db
from backend.models import Dataset, ProcessVersion, ProcessState
from backend.config import settings
from backend.services.storage_service import get_fsspec_storage_options

router = APIRouter(tags=["Datasets"])


@router.get("/datasets")
async def search_datasets(
    search: str = "",
    completed_only: bool = True,
    project_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Search datasets by process name or dataset name"""
    stmt = (
        select(Dataset)
        .options(selectinload(Dataset.process_version))
        .join(ProcessVersion, Dataset.process_version_id == ProcessVersion.id)
    )

    # Filter by project_id if provided
    if project_id:
        stmt = stmt.where(Dataset.project_id == project_id)

    # Filter by search: case-insensitive substring match against the full display string
    # e.g. "FFT / 1" matches "Super cool FFT / 12 / output"
    if search:
        combined = (
            Dataset.process_name + ' / v' +
            cast(ProcessVersion.version, String) + ' / ' +
            Dataset.dataset_name
        )
        stmt = stmt.where(combined.ilike(f"%{search}%"))

    if completed_only:
        stmt = stmt.where(ProcessVersion.state == ProcessState.DONE)

    result = await db.execute(stmt)
    datasets = result.scalars().all()

    return [d.to_dict() for d in datasets]


@router.get("/dataset/{dataset_id}")
async def get_dataset(dataset_id: str, db: AsyncSession = Depends(get_db)):
    """Get dataset metadata"""
    stmt = select(Dataset).options(selectinload(Dataset.process_version)).where(Dataset.id == dataset_id)
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

    # Determine format by checking structure
    is_new_format = "files" in dataset.parts and "parts" in dataset.parts

    part_file_url = None
    mime_type = dataset.mime_type

    if part_path == "":
        # Root part
        if is_new_format:
            # New format: files at top level
            part_file_url = dataset.parts.get("files", {}).get(dataset.mime_type)
        else:
            # Old format: parts[""] with file_url
            part_info = dataset.parts.get("")
            if part_info:
                part_file_url = part_info.get("file_url")
                mime_type = part_info.get("mime_type", dataset.mime_type)
    else:
        # Child part
        if is_new_format:
            # New format: parts nested under "parts" key
            parts_dict = dataset.parts.get("parts", {})
            part_info = parts_dict.get(part_path)
            if not part_info:
                raise HTTPException(status_code=404, detail="Part not found")

            if "files" in part_info and dataset.mime_type in part_info["files"]:
                part_file_url = part_info["files"][dataset.mime_type]
        else:
            # Old format: parts at top level
            part_info = dataset.parts.get(part_path)
            if not part_info:
                raise HTTPException(status_code=404, detail="Part not found")

            part_file_url = part_info.get("file_url")
            mime_type = part_info.get("mime_type", dataset.mime_type)

    if not part_file_url:
        raise HTTPException(status_code=404, detail="Part data not found")

    storage_options = get_fsspec_storage_options()
    def _read():
        with fsspec.open(part_file_url, 'rb', **storage_options) as f:
            return f.read()
    data = await asyncio.to_thread(_read)

    return Response(
        content=data,
        media_type=mime_type
    )


@router.get("/dataset/{dataset_id}/{part_path:path}/geography")
async def get_dataset_part_geography(dataset_id: str, part_path: str, db: AsyncSession = Depends(get_db)):
    """Get GeoJSON geography for a specific part of a dataset"""
    stmt = select(Dataset).where(Dataset.id == dataset_id)
    result = await db.execute(stmt)
    dataset = result.scalar_one_or_none()

    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Determine format by checking structure
    is_new_format = "files" in dataset.parts and "parts" in dataset.parts

    part_geography_url = None

    if part_path == "":
        # Root part
        if is_new_format:
            # New format: files at top level
            part_geography_url = dataset.parts.get("files", {}).get("application/geo+json")
        else:
            # Old format: parts[""] with geography_url
            part_info = dataset.parts.get("")
            if part_info:
                part_geography_url = part_info.get("geography_url")
    else:
        # Child part
        if is_new_format:
            # New format: parts nested under "parts" key
            parts_dict = dataset.parts.get("parts", {})
            part_info = parts_dict.get(part_path)
            if not part_info:
                raise HTTPException(status_code=404, detail="Part not found")

            if "files" in part_info and "application/geo+json" in part_info["files"]:
                part_geography_url = part_info["files"]["application/geo+json"]
        else:
            # Old format: parts at top level
            part_info = dataset.parts.get(part_path)
            if not part_info:
                raise HTTPException(status_code=404, detail="Part not found")

            part_geography_url = part_info.get("geography_url")

    if not part_geography_url:
        raise HTTPException(status_code=404, detail="Part geography not found")

    storage_options = get_fsspec_storage_options()
    def _read():
        with fsspec.open(part_geography_url, 'r', **storage_options) as f:
            return f.read()
    data = await asyncio.to_thread(_read)

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
    storage_options = get_fsspec_storage_options()
    try:
        mode = 'r' if mime_type in ("application/geo+json", "application/json", "text/csv", "text/plain") else 'rb'
        def _read():
            with fsspec.open(storage_url, mode, **storage_options) as f:
                return f.read()
        data = await asyncio.to_thread(_read)

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
