"""MinIO protocol handler.

`provision()` is `setup_project_storage()` from `backend/services/minio_service.py` moved
essentially unchanged — same bucket/policy/user/k8s-secret steps, same global `settings`-based
MinIO connection (per-backend connection config, e.g. reading `backend.endpoint/config` instead
of global settings, is future work, not part of this extraction).

`mint()` (short-lived, per-launch credentials via MinIO's expiring service accounts / native STS)
is genuinely new functionality, not an extraction of existing code — there is no such logic in
`minio_service.py` today. It is deliberately left unimplemented here; wiring it up is Phase 4's
job ("the only phase that changes runtime behavior for real jobs"). `credential_strategy`
defaults to `static-key` everywhere today, so this stub is never hit on the bootstrap backend.
"""
from backend.services.storage_protocols import StorageProtocolHandler
from backend.services.minio_service import setup_project_storage


class MinioProtocolHandler(StorageProtocolHandler):
    def provision(self, project, backend) -> dict:
        return setup_project_storage(project.id)

    def mint(self, project, backend) -> dict:
        raise NotImplementedError(
            "MinIO short-lived credential minting (expiring service account / native STS) "
            "lands in Phase 4 of short-lived-storage-credentials"
        )
