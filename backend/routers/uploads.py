from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import uuid

from backend.database import get_db
from backend.models import Upload
from backend.services.storage_service import get_upload_storage_url, storage_url_to_http_url
from backend.services.auth_service import get_current_user
from backend.models.user import User
import fsspec

router = APIRouter(tags=["Uploads"])


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    project_id: str = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Upload a file and return download URL"""
    upload_id = str(uuid.uuid4())
    filename = file.filename
    content_type = file.content_type or "application/octet-stream"

    # Use current user's default project if not specified
    if not project_id and current_user:
        # Get user's default project from preferences
        project_id = current_user.preferences.get('default_project') if current_user.preferences else None

    if not project_id:
        raise HTTPException(status_code=400, detail="project_id is required")

    # Read file content
    content = await file.read()

    # Store file using storage service
    file_url = get_upload_storage_url(project_id, upload_id, filename)
    with fsspec.open(file_url, 'wb') as f:
        f.write(content)

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
    with fsspec.open(upload.file_url, 'rb') as f:
        content = f.read()

    return Response(
        content=content,
        media_type=upload.content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{upload.filename}"'
        }
    )
