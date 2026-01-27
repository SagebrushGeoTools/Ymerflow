"""Import data process implementation (stubbed)"""

import logging

logger = logging.getLogger(__name__)


def run(params: dict, backend_client):
    """
    Import data from uploaded file

    Args:
        params: Process parameters including:
            - file_url: Upload file URL
            - file_format: File format ("csv", "xyz", "json")
        backend_client: BackendClient for API communication
    """
    file_format = params.get("file_format", "csv")

    logger.info("Starting import data process...")
    logger.info(f"File format: {file_format}")

    # TODO: Actual import implementation
    # For now, just create fake outputs
    logger.info(f"Reading {file_format} file (stubbed)...")
    fake_data = b"fake imported msgpack data"

    # Create outputs
    logger.info("Creating output datasets...")
    backend_client.create_output(
        "output",
        fake_data,
        "application/x-aarhusxyz-msgpack"
    )
    backend_client.create_output(
        "processed",
        fake_data,
        "application/x-aarhusxyz-msgpack"
    )

    logger.info("Import data process complete!")
