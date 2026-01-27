"""FFT process implementation (stubbed)"""

import logging

logger = logging.getLogger(__name__)


def run(params: dict, backend_client):
    """
    Run FFT process on input data

    Args:
        params: Process parameters including:
            - input_signal: Dataset URL
            - window: Window size (default 1.0)
            - overlap: Overlap fraction (default 0.5)
        backend_client: BackendClient for API communication
    """
    logger.info("Starting FFT process...")
    logger.info(f"Parameters: window={params.get('window', 1.0)}, overlap={params.get('overlap', 0.5)}")

    # Get input dataset
    input_url = params.get("input_signal")
    if input_url:
        logger.info("Loading input dataset...")
        input_data = backend_client.get_dataset(input_url)
        logger.info(f"Loaded input dataset: {len(input_data)} bytes")
    else:
        logger.warning("No input dataset provided, using fake data")
        input_data = b"fake msgpack data"

    # TODO: Actual FFT implementation
    # For now, just create fake outputs
    logger.info("Computing FFT (stubbed)...")

    # Create outputs
    logger.info("Creating output datasets...")
    backend_client.create_output(
        "output",
        input_data,
        "application/x-aarhusxyz-msgpack"
    )
    backend_client.create_output(
        "processed",
        input_data,
        "application/x-aarhusxyz-msgpack"
    )

    logger.info("FFT process complete!")
