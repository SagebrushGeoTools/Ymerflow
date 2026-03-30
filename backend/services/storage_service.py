"""Storage service for URL translation and bucket management."""
from backend.config import settings
from typing import Any, Dict, Optional
import re


def get_fsspec_storage_options() -> Dict[str, Any]:
    """Get fsspec storage options for S3/MinIO access.

    Returns:
        Dict with storage options to pass to fsspec.open()
    """
    if settings.storage_protocol == "s3" and settings.storage_endpoint:
        # MinIO configuration
        return {
            "client_kwargs": {
                "endpoint_url": settings.storage_endpoint
            },
            "key": settings.minio_root_user,
            "secret": settings.minio_root_password
        }
    elif settings.storage_protocol == "s3":
        # AWS S3 - would need AWS credentials from environment
        # For now, return empty dict and let boto3 use default credential chain
        return {}
    else:
        # file://, gs://, az:// etc.
        return {}


def get_project_bucket_name(project_id: str) -> str:
    """Get bucket name for a project."""
    return f"{settings.storage_bucket_prefix}{project_id}"


def get_storage_base_url(project_id: str) -> str:
    """Get base storage URL for a project."""
    protocol = settings.storage_protocol
    bucket = get_project_bucket_name(project_id)
    return f"{protocol}://{bucket}"


def get_upload_storage_url(project_id: str, upload_id: str, filename: str) -> str:
    """Generate storage URL for upload file."""
    base = get_storage_base_url(project_id)
    return f"{base}/uploads/{upload_id}/{filename}"


def get_dataset_storage_url(project_id: str, process_id: str, process_version: str, dataset_id: str, part_path: str = None) -> str:
    """Generate storage URL for dataset file."""
    base = get_storage_base_url(project_id)
    path = f"{base}/processes/{process_id}/{process_version}/datasets/{dataset_id}"

    if part_path:
        return f"{path}/parts/{part_path}.msgpack"
    return f"{path}/root.msgpack"


def get_dataset_geography_url(project_id: str, process_id: str, process_version: str, dataset_id: str, part_path: str = None) -> str:
    """Generate storage URL for dataset geography file (GeoJSON)."""
    base = get_storage_base_url(project_id)
    path = f"{base}/processes/{process_id}/{process_version}/datasets/{dataset_id}"

    if part_path:
        return f"{path}/parts/{part_path}.geojson"
    return f"{path}/root.geojson"


def storage_url_to_http_url(storage_url: str) -> str:
    """Convert storage URL to HTTP API URL.

    Examples:
        s3://project-bucket/processes/proc-123/datasets/ds-456/root.msgpack
        -> http://localhost:8000/files/project-bucket/processes/proc-123/datasets/ds-456/root.msgpack

        s3://project-bucket/uploads/up-789/file.csv
        -> http://localhost:8000/files/project-bucket/uploads/up-789/file.csv
    """
    # Check if this is a storage URL
    if storage_url.startswith(('s3://', 'gs://', 'az://', 'file://')):
        # Extract protocol and path
        match = re.match(r'^(\w+)://(.+)$', storage_url)
        if match:
            # Strip protocol, add /files/ prefix
            path = match.group(2)
            return f"{settings.backend_base_url}/files/{path}"

    return storage_url


def http_url_to_storage_url(http_url: str, project_id: str, process_id: str = None) -> str:
    """Convert HTTP API URL to storage URL.

    Examples:
        http://localhost:8000/files/project-bucket/processes/proc-123/datasets/ds-456/root.msgpack
        -> s3://project-bucket/processes/proc-123/datasets/ds-456/root.msgpack

        http://localhost:8000/files/project-bucket/uploads/up-789/file.csv
        -> s3://project-bucket/uploads/up-789/file.csv
    """
    # Check if this is a /files/ URL
    files_url_prefix = f"{settings.backend_base_url}/files/"
    if http_url.startswith(files_url_prefix):
        # Strip HTTP prefix, extract path
        path = http_url.replace(files_url_prefix, '')
        # Add storage protocol
        protocol = settings.storage_protocol
        return f"{protocol}://{path}"

    return http_url


def translate_urls_in_dict(data: Any, project_id: str, to_storage: bool = True) -> Any:
    """Recursively translate URLs in a nested dict/list structure.

    Args:
        data: Dict, list, or primitive value
        project_id: Project ID for URL construction
        to_storage: If True, translate HTTP->storage. If False, translate storage->HTTP
    """
    if isinstance(data, dict):
        return {k: translate_urls_in_dict(v, project_id, to_storage) for k, v in data.items()}
    elif isinstance(data, list):
        return [translate_urls_in_dict(item, project_id, to_storage) for item in data]
    elif isinstance(data, str):
        if to_storage:
            # Translate HTTP URLs to storage URLs
            files_url_prefix = f"{settings.backend_base_url}/files/"
            if data.startswith(files_url_prefix):
                return http_url_to_storage_url(data, project_id)
            return data
        else:
            # Translate storage URLs to HTTP URLs
            if data.startswith(('s3://', 'gs://', 'az://', 'file://')):
                return storage_url_to_http_url(data)
            return data
    else:
        return data
