"""Backend HTTP client for Flyte tasks to communicate with the Nagelfluh API

Tasks use Python's logging system for log messages, which Flyte captures from stdout/stderr.
This client is only for data operations (downloading datasets, creating outputs).
"""

import requests
import logging

logger = logging.getLogger(__name__)


class BackendClient:
    """Client for Flyte tasks to interact with the Nagelfluh backend API"""

    def __init__(self, backend_url: str, execution_token: str):
        """
        Initialize backend client

        Args:
            backend_url: Base URL of the backend API (e.g., http://localhost:8000)
            execution_token: Execution token for authentication
        """
        self.backend_url = backend_url
        self.token = execution_token
        self.base_url = f"{backend_url}/task/{execution_token}"
        self.session = requests.Session()

    def get_dataset(self, dataset_url: str) -> bytes:
        """
        Download dataset from backend

        Args:
            dataset_url: Full dataset URL (http://localhost:8000/dataset/{id})

        Returns:
            Dataset bytes (msgpack format)
        """
        try:
            # Extract dataset_id from URL
            dataset_id = dataset_url.split("/")[-1]
            url = f"{self.base_url}/dataset/{dataset_id}"

            logger.info(f"Downloading dataset {dataset_id}...")
            response = self.session.get(url, timeout=300)
            response.raise_for_status()

            data = response.content
            logger.info(f"Downloaded dataset: {len(data)} bytes")
            return data

        except Exception as e:
            logger.error(f"Failed to download dataset: {e}")
            raise

    def create_output(
        self,
        name: str,
        data: bytes,
        mime_type: str,
        parts: dict = None,
        geography: dict = None
    ):
        """
        Create output dataset for this process

        Args:
            name: Output name (e.g., "output", "processed")
            data: Binary dataset data (msgpack format)
            mime_type: MIME type (e.g., "application/x-aarhusxyz-msgpack")
            parts: Optional dict of additional parts
            geography: Optional GeoJSON geography data
        """
        try:
            payload = {
                "name": name,
                "data": data.hex(),  # Hex encode binary data
                "mime_type": mime_type,
                "parts": parts or {},
                "geography": geography
            }

            logger.info(f"Creating output '{name}' ({len(data)} bytes)...")
            response = self.session.post(
                f"{self.base_url}/output",
                json=payload,
                timeout=300
            )
            response.raise_for_status()

            result = response.json()
            logger.info(f"Created output: {result.get('dataset_url')}")

        except Exception as e:
            logger.error(f"Failed to create output: {e}")
            raise
