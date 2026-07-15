"""MinIO bucket and IAM management service using Python SDK."""
import logging
import secrets
import json
import hashlib
import urllib3
from minio import Minio
from minio.error import S3Error
from urllib.parse import urlparse
import subprocess
import tempfile
from pathlib import Path

from backend.config import settings

logger = logging.getLogger(__name__)



def _run_mc(args: list[str]) -> subprocess.CompletedProcess:
    """
    Run a minio-client command and return the CompletedProcess.
    Raises on unexpected failures.
    """
    cmd = ["minio-client"]
    if settings.storage_tls_skip_verify:
        cmd.append("--insecure")
    cmd += args
    logger.debug("Running command: %s", " ".join(cmd))

    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
    )

    if proc.returncode != 0:
        stderr = proc.stderr.strip()
        # MinIO CLI uses stderr even for some non-fatal messages
        raise RuntimeError(f"minio-client failed: {stderr}")

    return proc

def _create_minio_user(client: Minio, username: str, password: str, alias: str = "minio"):
    """
    Create or update a MinIO user using minio-client.
    mc admin user add is an upsert — it sets the password even for existing users.
    """
    _run_mc([
        "admin", "user", "add",
        alias,
        username,
        password,
    ])
    logger.info("Created/updated MinIO user %s", username)

def _create_minio_policy(client: Minio, policy_name: str, policy: dict, alias: str = "minio"):
    """
    Create a MinIO policy using minio-client.
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        policy_path = Path(tmpdir) / f"{policy_name}.json"
        policy_path.write_text(json.dumps(policy, indent=2))

        try:
            _run_mc([
                "admin", "policy", "create",
                alias,
                policy_name,
                str(policy_path),
            ])
            logger.info("Created policy %s", policy_name)

        except RuntimeError as e:
            if "already exists" in str(e).lower():
                logger.info("Policy %s already exists", policy_name)
            else:
                raise

def _attach_policy_to_user(client: Minio, username: str, policy_name: str, alias: str = "minio"):
    """
    Attach a policy to a MinIO user using minio-client.
    """
    try:
        _run_mc([
            "admin", "policy", "attach",
            alias,
            policy_name,
            "--user",
            username,
        ])
        logger.info("Attached policy %s to user %s", policy_name, username)
    except RuntimeError as e:
        if "already attached" in str(e).lower():
            logger.info("Policy %s already attached to user %s", policy_name, username)
        else:
            raise


def generate_password(length: int = 32) -> str:
    """Generate a secure random password."""
    return secrets.token_urlsafe(length)


def get_minio_client_for_backend(endpoint: str, admin_access_key: str, admin_secret_key: str) -> Minio:
    """Build a MinIO SDK client for a specific StorageBackend's connection config."""
    parsed = urlparse(endpoint)
    http_client = None
    if settings.storage_tls_skip_verify:
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        http_client = urllib3.PoolManager(cert_reqs="CERT_NONE")
    return Minio(
        parsed.netloc or parsed.path,
        access_key=admin_access_key,
        secret_key=admin_secret_key,
        secure=parsed.scheme == "https",
        http_client=http_client,
    )


def _ensure_mc_alias(alias: str, endpoint: str, admin_access_key: str, admin_secret_key: str) -> None:
    """mc alias set is an idempotent upsert — safe to call before every operation."""
    _run_mc(["alias", "set", alias, endpoint, admin_access_key, admin_secret_key])


def setup_project_storage(
    project_id: str,
    endpoint: str,
    bucket_prefix: str,
    admin_access_key: str,
    admin_secret_key: str,
) -> dict:
    """Setup MinIO bucket and credentials for a project against a specific backend.

    Args:
        project_id: Project ID
        endpoint: MinIO endpoint URL for the target StorageBackend
        bucket_prefix: Bucket name prefix for the target StorageBackend
        admin_access_key: MinIO admin access key for the target StorageBackend
        admin_secret_key: MinIO admin secret key for the target StorageBackend

    Returns:
        Dict with setup results and credentials
    """
    alias = f"backend-{hashlib.sha1(endpoint.encode()).hexdigest()[:12]}"
    _ensure_mc_alias(alias, endpoint, admin_access_key, admin_secret_key)

    bucket_name = f"{bucket_prefix}{project_id}"
    user_name = f"project-{project_id}"
    password = generate_password()
    policy_name = f"project-{project_id}-policy"

    logger.info(f"Setting up MinIO storage for project {project_id}")
    logger.info(f"Bucket: {bucket_name}, User: {user_name}")

    results = {"status": "success", "bucket": bucket_name, "user": user_name}

    try:
        client = get_minio_client_for_backend(endpoint, admin_access_key, admin_secret_key)

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
                        f"arn:aws:s3:::{bucket_name}/processes/*/*/datasets/*"
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
            _create_minio_user(client, user_name, password, alias=alias)
            logger.info(f"✓ User created: {user_name}")
            results["credentials"] = {"access_key": user_name, "secret_key": password}
        except Exception as e:
            logger.error(f"Failed to create user: {e}")
            results["status"] = "error"
            results["error"] = f"Failed to create user: {e}"
            return results

        try:
            _create_minio_policy(client, policy_name, policy, alias=alias)
            logger.info(f"✓ Policy created: {policy_name}")
        except Exception as e:
            logger.error(f"Failed to create policy: {e}")
            results["status"] = "error"
            results["error"] = f"Failed to create policy: {e}"
            return results

        try:
            _attach_policy_to_user(client, user_name, policy_name, alias=alias)
            logger.info(f"✓ Policy attached to user")
        except Exception as e:
            logger.error(f"Failed to attach policy: {e}")
            results["status"] = "error"
            results["error"] = f"Failed to attach policy: {e}"
            return results

        # The pod receives its (project-scoped) fsspec kwargs directly as an env var at launch time
        # (see docs/plans/per-project-storage-routing.md decision 3), so no per-project K8s secret is
        # created here anymore — that secret was created on the backend's own cluster, not the job's
        # target cluster, which broke jobs on remote clusters.

    except Exception as e:
        logger.error(f"Unexpected error during setup: {e}")
        results["status"] = "error"
        results["error"] = str(e)

    return results

