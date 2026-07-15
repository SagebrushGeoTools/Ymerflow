"""MinIO protocol handler.

`provision()`/`test_connection()` are genuinely per-backend-parametrized: they read
`backend.endpoint`/`backend.bucket_prefix`/`backend.config` (the MinIO admin credentials for
*that specific endpoint*) instead of global `settings` — see docs/plans/storage-admin-ui.md
Design decisions. Every MinIO backend, including the original bootstrap row, goes through this
identical path; there is no "the default row still reads settings" carve-out.

`mint()` (short-lived, per-launch credentials via MinIO's expiring service accounts / native STS)
is genuinely new functionality, not an extraction of existing code — there is no such logic in
`minio_service.py` today. It is deliberately left unimplemented here. `credential_strategy`
defaults to `static-key` everywhere today, so this stub is never hit on the bootstrap backend.
"""
import asyncio

from backend.config import settings
from backend.services.storage_protocols import StorageProtocolHandler
from backend.services.minio_service import setup_project_storage, get_minio_client_for_backend


def _pod_endpoint(endpoint: str) -> str:
    """Translate a backend-facing MinIO endpoint (e.g. the dev host's `https://localhost:9000`,
    reached via a port-forward / NodePort) to the in-cluster address a job pod must use. In prod
    the ConfigMap already sets the in-cluster service name as the endpoint, so this is a no-op
    there. This is the dev-convenience that used to live inline in job_orchestrator; it lives here
    now so job_orchestrator never branches on protocol."""
    if not endpoint:
        return endpoint
    return endpoint.replace(
        "https://localhost:9000",
        "https://minio-nagelfluh.nagelfluh-jobs.svc.cluster.local:9000",
    ).replace(
        "http://localhost:9000",
        "http://minio-nagelfluh.nagelfluh-jobs.svc.cluster.local:9000",
    )


class MinioProtocolHandler(StorageProtocolHandler):
    def provision(self, project, backend) -> dict:
        return setup_project_storage(
            project.id, backend.endpoint, backend.bucket_prefix,
            backend.config["admin_access_key"], backend.config["admin_secret_key"],
        )

    def mint(self, project, backend) -> dict:
        raise NotImplementedError(
            "MinIO short-lived credential minting (expiring service account / native STS) "
            "is not implemented yet"
        )

    async def test_connection(self, backend) -> None:
        client = get_minio_client_for_backend(
            backend.endpoint, backend.config["admin_access_key"], backend.config["admin_secret_key"]
        )
        await asyncio.to_thread(lambda: list(client.list_buckets()))

    def storage_base_url(self, project, backend) -> str:
        # fsspec scheme is s3:// (MinIO speaks the S3 API); backend.protocol is the 'minio'
        # identifier, not the URL scheme. One bucket per project — <bucket_prefix><project_id>.
        return f"s3://{backend.bucket_prefix}{project.id}"

    def fsspec_kwargs(self, backend, credentials, for_pod: bool = False) -> dict:
        endpoint = _pod_endpoint(backend.endpoint) if for_pod else backend.endpoint
        client_kwargs = {"endpoint_url": endpoint}
        if settings.storage_tls_skip_verify:
            client_kwargs["verify"] = False
        return {
            "key": credentials.get("access_key"),
            "secret": credentials.get("secret_key"),
            "client_kwargs": client_kwargs,
        }

    def admin_credentials(self, backend) -> dict:
        return {
            "access_key": backend.config["admin_access_key"],
            "secret_key": backend.config["admin_secret_key"],
        }
