"""MinIO bucket and IAM management service using Python SDK."""
import logging
import secrets
import json
from typing import Optional, Tuple
from minio import Minio
from minio.error import S3Error
from urllib.parse import urlparse
from backend.config import settings

logger = logging.getLogger(__name__)


def is_minio_enabled() -> bool:
    """Check if MinIO is being used (s3 protocol with endpoint)."""
    return settings.storage_protocol == "s3" and settings.storage_endpoint is not None


def generate_password(length: int = 32) -> str:
    """Generate a secure random password."""
    return secrets.token_urlsafe(length)


def get_minio_client() -> Optional[Minio]:
    """Get MinIO client instance.

    Returns:
        Minio client or None if MinIO not enabled
    """
    if not is_minio_enabled():
        return None

    # Parse endpoint URL
    parsed = urlparse(settings.storage_endpoint)
    endpoint = parsed.netloc or parsed.path
    secure = parsed.scheme == "https"

    # Use root credentials from settings or environment
    # These should be set in .env as MINIO_ROOT_USER and MINIO_ROOT_PASSWORD
    access_key = getattr(settings, 'minio_root_user', 'minioadmin')
    secret_key = getattr(settings, 'minio_root_password', 'minioadmin')

    return Minio(
        endpoint,
        access_key=access_key,
        secret_key=secret_key,
        secure=secure
    )


def test_connection() -> Tuple[bool, str]:
    """Test connection to MinIO.

    Returns:
        Tuple of (success, message)
    """
    try:
        client = get_minio_client()
        if not client:
            return False, "MinIO not enabled"

        # Try to list buckets
        list(client.list_buckets())
        return True, "Successfully connected to MinIO"
    except Exception as e:
        return False, f"Failed to connect to MinIO: {e}"


def setup_project_storage(project_id: str, k8s_namespace: str = "nagelfluh-jobs") -> dict:
    """Setup MinIO bucket and credentials for a project.

    Args:
        project_id: Project ID
        k8s_namespace: k8s namespace for secrets

    Returns:
        Dict with setup results and credentials
    """
    if not is_minio_enabled():
        logger.info(f"MinIO not enabled, skipping storage setup for project {project_id}")
        return {"status": "skipped", "reason": "MinIO not enabled"}

    bucket_name = f"{settings.storage_bucket_prefix}{project_id}"
    user_name = f"project-{project_id}"
    password = generate_password()
    policy_name = f"project-{project_id}-policy"

    logger.info(f"Setting up MinIO storage for project {project_id}")
    logger.info(f"Bucket: {bucket_name}, User: {user_name}")

    results = {"status": "success", "bucket": bucket_name, "user": user_name}

    try:
        client = get_minio_client()
        if not client:
            return {"status": "error", "error": "MinIO client not available"}

        # 1. Create bucket
        try:
            if not client.bucket_exists(bucket_name):
                client.make_bucket(bucket_name)
                logger.info(f"✓ Bucket created: {bucket_name}")
            else:
                logger.info(f"✓ Bucket already exists: {bucket_name}")
        except S3Error as e:
            logger.error(f"Failed to create bucket: {e}")
            results["status"] = "error"
            results["error"] = f"Failed to create bucket: {e}"
            return results

        # 2. Create IAM policy
        policy = {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Action": ["s3:GetObject"],
                    "Resource": [
                        f"arn:aws:s3:::{bucket_name}/uploads/*",
                        f"arn:aws:s3:::{bucket_name}/processes/*/datasets/*"
                    ]
                },
                {
                    "Effect": "Allow",
                    "Action": ["s3:PutObject"],
                    "Resource": [f"arn:aws:s3:::{bucket_name}/processes/*"]
                },
                {
                    "Effect": "Allow",
                    "Action": ["s3:ListBucket"],
                    "Resource": [f"arn:aws:s3:::{bucket_name}"]
                }
            ]
        }

        # MinIO admin API calls using REST endpoints
        # Note: The minio Python SDK doesn't have direct admin API support yet,
        # so we use the underlying HTTP client
        try:
            _create_minio_user(client, user_name, password)
            logger.info(f"✓ User created: {user_name}")
            results["credentials"] = {"access_key": user_name, "secret_key": password}
        except Exception as e:
            logger.error(f"Failed to create user: {e}")
            results["status"] = "error"
            results["error"] = f"Failed to create user: {e}"
            return results

        try:
            _create_minio_policy(client, policy_name, policy)
            logger.info(f"✓ Policy created: {policy_name}")
        except Exception as e:
            logger.error(f"Failed to create policy: {e}")
            results["status"] = "error"
            results["error"] = f"Failed to create policy: {e}"
            return results

        try:
            _attach_policy_to_user(client, user_name, policy_name)
            logger.info(f"✓ Policy attached to user")
        except Exception as e:
            logger.error(f"Failed to attach policy: {e}")
            results["status"] = "error"
            results["error"] = f"Failed to attach policy: {e}"
            return results

        # 5. Create k8s secret
        secret_name = f"project-{project_id}-storage"
        success, stdout, stderr = create_k8s_secret(
            secret_name=secret_name,
            namespace=k8s_namespace,
            access_key=user_name,
            secret_key=password
        )

        if not success:
            logger.warning(f"Failed to create k8s secret: {stderr}")
            results["k8s_secret"] = "failed"
            results["k8s_secret_error"] = stderr
        else:
            logger.info(f"✓ K8s secret created: {secret_name}")
            results["k8s_secret"] = secret_name

    except Exception as e:
        logger.error(f"Unexpected error during setup: {e}")
        results["status"] = "error"
        results["error"] = str(e)

    return results


def _create_minio_user(client: Minio, username: str, password: str):
    """Create MinIO user using admin API.

    Note: The minio Python SDK doesn't expose admin APIs directly,
    so we use urllib to make HTTP requests to the admin endpoints.
    """
    import urllib.request
    import urllib.error

    # Build admin API URL
    scheme = "https" if client._base_url.is_https else "http"
    endpoint = f"{scheme}://{client._base_url.host}"
    if client._base_url.port:
        endpoint = f"{endpoint}:{client._base_url.port}"

    url = f"{endpoint}/minio/admin/v3/add-user?accessKey={username}"

    # Create request with authentication
    req = urllib.request.Request(url, method='PUT')
    req.add_header('Content-Type', 'application/json')

    # Use root credentials for admin operations
    import base64
    credentials = base64.b64encode(f"{client._provider.retrieve().access_key}:{client._provider.retrieve().secret_key}".encode()).decode()
    req.add_header('Authorization', f'Basic {credentials}')

    # Send password in body
    data = json.dumps({"secretKey": password}).encode()

    try:
        with urllib.request.urlopen(req, data=data) as response:
            response.read()
    except urllib.error.HTTPError as e:
        if e.code == 409:  # Conflict - user already exists
            logger.info(f"User {username} already exists")
        else:
            raise Exception(f"Failed to create user: {e.code} {e.reason}")


def _create_minio_policy(client: Minio, policy_name: str, policy: dict):
    """Create MinIO policy using admin API."""
    import urllib.request
    import urllib.error

    # Build admin API URL
    scheme = "https" if client._base_url.is_https else "http"
    endpoint = f"{scheme}://{client._base_url.host}"
    if client._base_url.port:
        endpoint = f"{endpoint}:{client._base_url.port}"

    url = f"{endpoint}/minio/admin/v3/add-canned-policy?name={policy_name}"

    # Create request
    req = urllib.request.Request(url, method='PUT')
    req.add_header('Content-Type', 'application/json')

    # Add authentication
    import base64
    credentials = base64.b64encode(f"{client._provider.retrieve().access_key}:{client._provider.retrieve().secret_key}".encode()).decode()
    req.add_header('Authorization', f'Basic {credentials}')

    # Send policy in body
    data = json.dumps(policy).encode()

    try:
        with urllib.request.urlopen(req, data=data) as response:
            response.read()
    except urllib.error.HTTPError as e:
        if e.code == 409:  # Conflict - policy already exists
            logger.info(f"Policy {policy_name} already exists")
        else:
            raise Exception(f"Failed to create policy: {e.code} {e.reason}")


def _attach_policy_to_user(client: Minio, username: str, policy_name: str):
    """Attach policy to user using admin API."""
    import urllib.request
    import urllib.error

    # Build admin API URL
    scheme = "https" if client._base_url.is_https else "http"
    endpoint = f"{scheme}://{client._base_url.host}"
    if client._base_url.port:
        endpoint = f"{endpoint}:{client._base_url.port}"

    url = f"{endpoint}/minio/admin/v3/set-user-policy?accessKey={username}&policyName={policy_name}"

    # Create request
    req = urllib.request.Request(url, method='PUT')

    # Add authentication
    import base64
    credentials = base64.b64encode(f"{client._provider.retrieve().access_key}:{client._provider.retrieve().secret_key}".encode()).decode()
    req.add_header('Authorization', f'Basic {credentials}')

    try:
        with urllib.request.urlopen(req, data=b'') as response:
            response.read()
    except urllib.error.HTTPError as e:
        raise Exception(f"Failed to attach policy: {e.code} {e.reason}")


def create_k8s_secret(secret_name: str, namespace: str, access_key: str, secret_key: str) -> Tuple[bool, str, str]:
    """Create k8s secret for storage credentials.

    Args:
        secret_name: Name of the k8s secret
        namespace: k8s namespace
        access_key: MinIO access key
        secret_key: MinIO secret key

    Returns:
        Tuple of (success, stdout, stderr)
    """
    import subprocess

    cmd = [
        "kubectl", "create", "secret", "generic", secret_name,
        f"--namespace={namespace}",
        f"--from-literal=access-key={access_key}",
        f"--from-literal=secret-key={secret_key}",
        "--dry-run=client",
        "-o", "yaml"
    ]

    try:
        # Generate manifest
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if result.returncode != 0:
            return False, result.stdout, result.stderr

        # Apply manifest
        apply_cmd = ["kubectl", "apply", "-f", "-"]
        apply_result = subprocess.run(
            apply_cmd,
            input=result.stdout,
            capture_output=True,
            text=True,
            timeout=10
        )
        return apply_result.returncode == 0, apply_result.stdout, apply_result.stderr

    except subprocess.TimeoutExpired:
        return False, "", "kubectl command timed out"
    except FileNotFoundError:
        return False, "", "kubectl command not found"
    except Exception as e:
        return False, "", str(e)


def cleanup_project_storage(project_id: str) -> dict:
    """Clean up MinIO bucket and user for a project (for testing).

    WARNING: This will delete all data in the bucket!

    Args:
        project_id: Project ID

    Returns:
        Dict with cleanup results
    """
    if not is_minio_enabled():
        return {"status": "skipped", "reason": "MinIO not enabled"}

    bucket_name = f"{settings.storage_bucket_prefix}{project_id}"
    user_name = f"project-{project_id}"
    policy_name = f"project-{project_id}-policy"

    logger.info(f"Cleaning up MinIO storage for project {project_id}")

    results = {"status": "success"}

    try:
        client = get_minio_client()
        if not client:
            return {"status": "error", "error": "MinIO client not available"}

        # Remove bucket (must be empty first)
        try:
            if client.bucket_exists(bucket_name):
                # Delete all objects first
                objects = client.list_objects(bucket_name, recursive=True)
                for obj in objects:
                    client.remove_object(bucket_name, obj.object_name)
                # Delete bucket
                client.remove_bucket(bucket_name)
                logger.info(f"✓ Bucket removed: {bucket_name}")
        except S3Error as e:
            if "NoSuchBucket" not in str(e):
                logger.warning(f"Failed to remove bucket: {e}")

        # Note: Removing users and policies requires admin API calls
        # These are best handled manually or via mc client for now
        logger.warning(f"Note: User '{user_name}' and policy '{policy_name}' should be removed manually")

    except Exception as e:
        logger.error(f"Cleanup error: {e}")
        results["status"] = "error"
        results["error"] = str(e)

    logger.info(f"✓ Cleanup complete for project {project_id}")
    return results
