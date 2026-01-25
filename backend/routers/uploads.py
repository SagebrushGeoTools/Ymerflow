from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import uuid

from backend.database import get_db
from backend.models import Upload
from backend.services.file_service import get_upload_file_url, write_file, read_file

router = APIRouter(tags=["Uploads"])


@router.post("/upload")
async def upload_file(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    """Upload a file and return download URL"""
    upload_id = str(uuid.uuid4())
    filename = file.filename
    content_type = file.content_type or "application/octet-stream"

    # Read file content
    content = await file.read()

    # Store file using fsspec
    file_url = get_upload_file_url(upload_id, filename)
    await write_file(file_url, content)

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

    return {
        "id": upload.id,
        "filename": upload.filename,
        "url": f"http://localhost:8000/uploads/{upload.id}"
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
    content = await read_file(upload.file_url)

    return Response(
        content=content,
        media_type=upload.content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{upload.filename}"'
        }
    )
