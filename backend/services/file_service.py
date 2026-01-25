import fsspec
import os
from backend.config import settings


def get_dataset_file_url(dataset_id: str, part_path: str = None) -> str:
    """
    Generate fsspec URL for dataset file

    Args:
        dataset_id: Dataset ID
        part_path: Optional part path (without extension)

    Returns:
        Full fsspec URL
    """
    base = settings.data_base_path
    if part_path:
        return f"{base}/datasets/{dataset_id}/parts/{part_path}.msgpack"
    return f"{base}/datasets/{dataset_id}/root.msgpack"


def get_upload_file_url(upload_id: str, filename: str) -> str:
    """
    Generate fsspec URL for upload file

    Args:
        upload_id: Upload ID
        filename: Original filename

    Returns:
        Full fsspec URL
    """
    base = settings.data_base_path
    return f"{base}/uploads/{upload_id}/{filename}"


async def write_file(url: str, content: bytes):
    """
    Write file using fsspec

    Args:
        url: fsspec URL
        content: File content as bytes
    """
    with fsspec.open(url, 'wb') as f:
        f.write(content)


async def read_file(url: str) -> bytes:
    """
    Read file using fsspec

    Args:
        url: fsspec URL

    Returns:
        File content as bytes
    """
    with fsspec.open(url, 'rb') as f:
        return f.read()


async def file_exists(url: str) -> bool:
    """
    Check if file exists using fsspec

    Args:
        url: fsspec URL

    Returns:
        True if file exists, False otherwise
    """
    try:
        fs = fsspec.core.url_to_fs(url)[0]
        path = fsspec.core.url_to_fs(url)[1]
        return fs.exists(path)
    except Exception:
        return False


async def delete_file(url: str):
    """
    Delete file using fsspec

    Args:
        url: fsspec URL
    """
    fs = fsspec.core.url_to_fs(url)[0]
    path = fsspec.core.url_to_fs(url)[1]
    if fs.exists(path):
        fs.rm(path)
