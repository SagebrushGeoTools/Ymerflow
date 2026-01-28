"""Storage service for URL translation and bucket management."""
from backend.config import settings
from typing import Any, Dict
import re


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


def get_dataset_storage_url(project_id: str, process_id: str, dataset_id: str, part_path: str = None) -> str:
    """Generate storage URL for dataset file."""
    base = get_storage_base_url(project_id)
    path = f"{base}/processes/{process_id}/datasets/{dataset_id}"

    if part_path:
        return f"{path}/parts/{part_path}.msgpack"
    return f"{path}/root.msgpack"


def get_dataset_geography_url(project_id: str, process_id: str, dataset_id: str, part_path: str = None) -> str:
    """Generate storage URL for dataset geography file (GeoJSON)."""
    base = get_storage_base_url(project_id)
    path = f"{base}/processes/{process_id}/datasets/{dataset_id}"

    if part_path:
        return f"{path}/parts/{part_path}.geojson"
    return f"{path}/root.geojson"


def storage_url_to_http_url(storage_url: str) -> str:
    """Convert storage URL to HTTP API URL.

    Examples:
        s3://bucket/processes/proc-123/datasets/ds-456/root.msgpack
        -> http://localhost:8000/dataset/ds-456

        s3://bucket/uploads/up-789/file.csv
        -> http://localhost:8000/upload/up-789
    """
    # Extract dataset ID from storage URL
    dataset_match = re.search(r'/datasets/([^/]+)', storage_url)
    if dataset_match:
        dataset_id = dataset_match.group(1)
        return f"http://localhost:8000/dataset/{dataset_id}"

    # Extract upload ID from storage URL
    upload_match = re.search(r'/uploads/([^/]+)', storage_url)
    if upload_match:
        upload_id = upload_match.group(1)
        return f"http://localhost:8000/upload/{upload_id}"

    return storage_url


def http_url_to_storage_url(http_url: str, project_id: str, process_id: str = None) -> str:
    """Convert HTTP API URL to storage URL.

    Note: For datasets, we need process_id to construct the path.
    This should be looked up from the dataset record.

    Examples:
        http://localhost:8000/dataset/ds-456
        -> s3://bucket/processes/proc-123/datasets/ds-456/root.msgpack

        http://localhost:8000/upload/up-789
        -> s3://bucket/uploads/up-789 (filename from Upload record)
    """
    # This is a placeholder - in practice, we need to look up the dataset/upload
    # record to get the full storage URL. We'll handle this in the API layer.
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
            # This requires database lookups, so we'll handle it in the API layer
            return data
        else:
            # Translate storage URLs to HTTP URLs
            if data.startswith(('s3://', 'gs://', 'az://', 'file://')):
                return storage_url_to_http_url(data)
            return data
    else:
        return data
