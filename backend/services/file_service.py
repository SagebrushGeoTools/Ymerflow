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
