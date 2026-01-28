"""File service - delegates to storage_service for new storage paths.

Legacy functions maintained for backward compatibility.
"""
from backend.config import settings
from backend.services.storage_service import (
    get_upload_storage_url,
    get_dataset_storage_url,
    get_dataset_geography_url as get_dataset_geography_storage_url
)


# Legacy functions using old data_base_path (for backward compatibility)
def get_dataset_file_url(dataset_id: str, part_path: str = None) -> str:
    """Legacy: Generate fsspec URL for dataset file using data_base_path."""
    base = settings.data_base_path
    if part_path:
        return f"{base}/datasets/{dataset_id}/parts/{part_path}.msgpack"
    return f"{base}/datasets/{dataset_id}/root.msgpack"


def get_dataset_geography_url(dataset_id: str, part_path: str = None) -> str:
    """Legacy: Generate fsspec URL for dataset geography file using data_base_path."""
    base = settings.data_base_path
    if part_path:
        return f"{base}/datasets/{dataset_id}/parts/{part_path}.geojson"
    return f"{base}/datasets/{dataset_id}/root.geojson"


def get_upload_file_url(upload_id: str, filename: str) -> str:
    """Legacy: Generate fsspec URL for upload file using data_base_path."""
    base = settings.data_base_path
    return f"{base}/uploads/{upload_id}/{filename}"
