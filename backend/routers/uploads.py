from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import asyncio
import uuid

from backend.database import get_db
from backend.models import Upload
from backend.services.storage_service import get_upload_storage_url, storage_url_to_http_url, get_fsspec_storage_options
from backend.services.auth_service import get_current_user, AuthContext
import fsspec

router = APIRouter(tags=["Uploads"])


@router.post("/upload", summary="Upload a raw input file")
async def upload_file(
    file: UploadFile = File(...),
    project_id: str = Query(None, description="Project ID from list_projects. Required — the file is stored in the project's bucket."),
    auth: AuthContext = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Upload a raw input file (e.g. AEM data, CSV) that is not the output of any process.

    Use this when you have a local file to provide as input to a process. The
    response includes a 'url' field — this is a direct HTTP file URL, ready to
    pass as input_data in create_process params. It does NOT need to be resolved
    via get_dataset (unlike the /dataset/{id} URLs returned by list_processes outputs).

    Accepts multipart/form-data with a single 'file' field.
    """
    upload_id = str(uuid.uuid4())
    filename = file.filename
    content_type = file.content_type or "application/octet-stream"

    # Use current user's default project if not specified
    if not project_id:
        project_id = auth.user.preferences.get('default_project') if auth.user.preferences else None

    if not project_id:
        raise HTTPException(status_code=400, detail="project_id is required")

    # Read file content
    content = await file.read()

    # Store file using storage service
    file_url = get_upload_storage_url(project_id, upload_id, filename)
    storage_options = get_fsspec_storage_options()
    def _write():
        with fsspec.open(file_url, 'wb', **storage_options) as f:
            f.write(content)
    await asyncio.to_thread(_write)

    # Create upload record
    upload = Upload(
        id=upload_id,
        filename=filename,
        content_type=content_type,
        file_url=file_url
    )

    db.add(upload)
    await db.commit()
    await db.refresh(upload)

    # Convert storage URL to HTTP URL
    http_url = storage_url_to_http_url(file_url)

    return {
        "id": upload.id,
        "filename": upload.filename,
        "url": http_url
    }


@router.get("/uploads/{file_id}")
async def download_file(file_id: str, db: AsyncSession = Depends(get_db)):
    """Download an uploaded file"""
    stmt = select(Upload).where(Upload.id == file_id)
    result = await db.execute(stmt)
    upload = result.scalar_one_or_none()

    if not upload:
        raise HTTPException(status_code=404, detail="File not found")

    # Read file from storage
    storage_options = get_fsspec_storage_options()
    def _read():
        with fsspec.open(upload.file_url, 'rb', **storage_options) as f:
            return f.read()
    content = await asyncio.to_thread(_read)

    return Response(
        content=content,
        media_type=upload.content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{upload.filename}"'
        }
    )
