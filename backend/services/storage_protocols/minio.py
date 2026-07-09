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

from backend.services.storage_protocols import StorageProtocolHandler
from backend.services.minio_service import setup_project_storage, get_minio_client_for_backend


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
