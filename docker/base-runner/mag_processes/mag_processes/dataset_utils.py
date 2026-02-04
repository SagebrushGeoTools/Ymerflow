"""Utility functions for writing MagData datasets to storage."""

import uuid
import json
import tempfile
import os

import fsspec


def write_dataset(mag_data, dataset_name, process_id, storage_base, storage_kwargs):
    """Write a MagData instance to storage as msgpack.

    Creates a dataset directory with a root msgpack file and an info.json
    manifest, following the same layout convention as aem_processes.

    MagData.save() requires a local filesystem path, so the msgpack is
    written to a temporary file first and then copied through fsspec to
    the target storage backend.

    Args:
        mag_data: AirMagTools.MagData instance
        dataset_name: Human-readable name for this dataset
        process_id: Process ID (UUID string)
        storage_base: Base URL for the storage backend
        storage_kwargs: fsspec open() keyword arguments

    Returns:
        Dataset ID (UUID string)
    """
    dataset_id = str(uuid.uuid4())
    dataset_prefix = f"{storage_base}/processes/{process_id}/datasets/{dataset_id}"
    msgpack_url = f"{dataset_prefix}/root.msgpack"

    print(f"Writing msgpack to: {msgpack_url}")
    with tempfile.NamedTemporaryFile(suffix=".msgpack", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        mag_data.save(tmp_path)
        with open(tmp_path, "rb") as src:
            with fsspec.open(msgpack_url, "wb", **storage_kwargs) as dst:
                dst.write(src.read())
    finally:
        os.unlink(tmp_path)

    # Write dataset manifest
    dataset_info = {
        "id": dataset_id,
        "mime_type": "application/x-magdata-msgpack",
        "dataset_name": dataset_name,
        "parts": {
            "": {
                "file_url": msgpack_url,
                "mime_type": "application/x-magdata-msgpack",
            }
        },
    }

    info_url = f"{dataset_prefix}/info.json"
    print(f"Writing dataset info to: {info_url}")
    with fsspec.open(info_url, "w", **storage_kwargs) as f:
        json.dump(dataset_info, f, indent=2)

    return dataset_id
