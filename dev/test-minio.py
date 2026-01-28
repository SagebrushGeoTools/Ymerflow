#!/usr/bin/env python3
"""Test MinIO connection using Python SDK."""
import sys
from minio import Minio
from minio.error import S3Error

def test_connection(endpoint: str, access_key: str, secret_key: str) -> bool:
    """Test connection to MinIO.

    Args:
        endpoint: MinIO endpoint (e.g., localhost:9000)
        access_key: Access key
        secret_key: Secret key

    Returns:
        True if connection successful
    """
    try:
        # Determine if we should use HTTPS
        secure = endpoint.startswith("https://")
        endpoint = endpoint.replace("https://", "").replace("http://", "")

        # Create client
        client = Minio(
            endpoint,
            access_key=access_key,
            secret_key=secret_key,
            secure=secure
        )

        # Try to list buckets
        buckets = list(client.list_buckets())
        print(f"✓ Successfully connected to MinIO at {endpoint}")
        print(f"  Found {len(buckets)} bucket(s)")
        for bucket in buckets:
            print(f"    - {bucket.name}")

        return True

    except S3Error as e:
        print(f"✗ MinIO S3 error: {e}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"✗ Failed to connect to MinIO: {e}", file=sys.stderr)
        return False


if __name__ == "__main__":
    # Default values for local MinIO
    endpoint = sys.argv[1] if len(sys.argv) > 1 else "localhost:9000"
    access_key = sys.argv[2] if len(sys.argv) > 2 else "minioadmin"
    secret_key = sys.argv[3] if len(sys.argv) > 3 else "minioadmin"

    success = test_connection(endpoint, access_key, secret_key)
    sys.exit(0 if success else 1)
