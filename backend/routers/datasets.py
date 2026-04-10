from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from sqlalchemy.orm import selectinload
from typing import Optional
import asyncio
import fsspec
import re

from backend.database import get_db
from backend.models import Dataset, ProcessVersion, ProcessState, User
from backend.models.project_member import ProjectMember
from backend.config import settings
from backend.services.storage_service import get_fsspec_storage_options
from backend.services.auth_service import get_current_user
from backend.services.project_member_service import require_project_member

router = APIRouter(tags=["Datasets"])


async def _check_dataset_access(dataset_id: str, current_user: User, db: AsyncSession) -> Dataset:
    """Load a dataset and verify the current user is a member of its project."""
    stmt = select(Dataset).options(selectinload(Dataset.process_version)).where(Dataset.id == dataset_id)
    result = await db.execute(stmt)
    dataset = result.scalar_one_or_none()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    await require_project_member(db, current_user, dataset.project_id)
    return dataset


@router.get("/datasets")
async def search_datasets(
    search: str = "",
    completed_only: bool = True,
    project_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Search datasets by process name or dataset name. Only returns datasets in accessible projects."""
    stmt = select(Dataset).options(selectinload(Dataset.process_version))

    if project_id:
        await require_project_member(db, current_user, project_id)
        stmt = stmt.where(Dataset.project_id == project_id)
    else:
        # Only return datasets from projects the user is a member of
        stmt = stmt.join(
            ProjectMember,
            (ProjectMember.project_id == Dataset.project_id) & (ProjectMember.user_id == current_user.id)
        )

    if search:
        stmt = stmt.where(
            or_(
                Dataset.process_name.ilike(f"%{search}%"),
                Dataset.dataset_name.ilike(f"%{search}%")
            )
        )

    if completed_only:
        stmt = stmt.join(ProcessVersion, Dataset.process_version_id == ProcessVersion.id).where(
            ProcessVersion.state == ProcessState.DONE
        )

    result = await db.execute(stmt)
    datasets = result.scalars().all()

    return [d.to_dict() for d in datasets]


@router.get("/dataset/{dataset_id}")
async def get_dataset(
    dataset_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get dataset metadata"""
    dataset = await _check_dataset_access(dataset_id, current_user, db)
    return dataset.to_dict()


@router.get("/dataset/{dataset_id}/data")
async def get_dataset_data(
    dataset_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get dataset content (root part)"""
    return await get_dataset_part_data(dataset_id, "", current_user, db)


@router.get("/dataset/{dataset_id}/geography")
async def get_dataset_geography(
    dataset_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get GeoJSON geography for a dataset (root part)"""
    return await get_dataset_part_geography(dataset_id, "", current_user, db)


@router.get("/dataset/{dataset_id}/{part_path:path}/data")
async def get_dataset_part_data(
    dataset_id: str,
    part_path: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get data for a specific part of a dataset"""
    stmt = select(Dataset).where(Dataset.id == dataset_id)
    result = await db.execute(stmt)
    dataset = result.scalar_one_or_none()

    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    await require_project_member(db, current_user, dataset.project_id)

    # Determine format by checking structure
    is_new_format = "files" in dataset.parts and "parts" in dataset.parts

    part_file_url = None
    mime_type = dataset.mime_type

    if part_path == "":
        # Root part
        if is_new_format:
            part_file_url = dataset.parts.get("files", {}).get(dataset.mime_type)
        else:
            part_info = dataset.parts.get("")
            if part_info:
                part_file_url = part_info.get("file_url")
                mime_type = part_info.get("mime_type", dataset.mime_type)
    else:
        # Child part
        if is_new_format:
            parts_dict = dataset.parts.get("parts", {})
            part_info = parts_dict.get(part_path)
            if not part_info:
                raise HTTPException(status_code=404, detail="Part not found")
            if "files" in part_info and dataset.mime_type in part_info["files"]:
                part_file_url = part_info["files"][dataset.mime_type]
        else:
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

    return Response(content=data, media_type=mime_type)


@router.get("/dataset/{dataset_id}/{part_path:path}/geography")
async def get_dataset_part_geography(
    dataset_id: str,
    part_path: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get GeoJSON geography for a specific part of a dataset"""
    stmt = select(Dataset).where(Dataset.id == dataset_id)
    result = await db.execute(stmt)
    dataset = result.scalar_one_or_none()

    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    await require_project_member(db, current_user, dataset.project_id)

    # Determine format by checking structure
    is_new_format = "files" in dataset.parts and "parts" in dataset.parts

    part_geography_url = None

    if part_path == "":
        if is_new_format:
            part_geography_url = dataset.parts.get("files", {}).get("application/geo+json")
        else:
            part_info = dataset.parts.get("")
            if part_info:
                part_geography_url = part_info.get("geography_url")
    else:
        if is_new_format:
            parts_dict = dataset.parts.get("parts", {})
            part_info = parts_dict.get(part_path)
            if not part_info:
                raise HTTPException(status_code=404, detail="Part not found")
            if "files" in part_info and "application/geo+json" in part_info["files"]:
                part_geography_url = part_info["files"]["application/geo+json"]
        else:
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

    return Response(content=data, media_type="application/geo+json")


@router.get("/files/{path:path}")
async def get_file(
    path: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Unified file endpoint for datasets and uploads.

    Translates HTTP paths to storage URLs and serves the files.
    The bucket name encodes the project_id; membership is verified before serving.
    """
    # Extract project_id from bucket name: "{prefix}{project_id}/..."
    prefix = settings.storage_bucket_prefix
    bucket = path.split('/')[0]
    if bucket.startswith(prefix):
        project_id = bucket[len(prefix):]
        await require_project_member(db, current_user, project_id)
    else:
        raise HTTPException(status_code=403, detail="Access denied")

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

    storage_options = get_fsspec_storage_options()
    try:
        mode = 'r' if mime_type in ("application/geo+json", "application/json", "text/csv", "text/plain") else 'rb'
        def _read():
            with fsspec.open(storage_url, mode, **storage_options) as f:
                return f.read()
        data = await asyncio.to_thread(_read)

        headers = {}
        if '/uploads/' in path:
            filename = path.split('/')[-1]
            headers["Content-Disposition"] = f'attachment; filename="{filename}"'

        return Response(content=data, media_type=mime_type, headers=headers)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading file: {str(e)}")
