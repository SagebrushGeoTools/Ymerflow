"""GCS protocol handler — stub.

New code, not a refactor of anything existing (Nagelfluh has no GCS storage support today).
`provision()` will create a service account + bucket + IAM binding for `static-key` use;
`mint()` will call the IAM Credentials API's `generateAccessToken` (impersonation) for the
`short-lived` strategy. Both are Phase 4+ work, tracked by
docs/plans/short-lived-storage-credentials-00-overview.md's Open Questions.
"""
from backend.services.storage_protocols import StorageProtocolHandler


class GcsProtocolHandler(StorageProtocolHandler):
    def provision(self, project, backend) -> dict:
        raise NotImplementedError("GCS storage provisioning is not implemented yet")

    def mint(self, project, backend) -> dict:
        raise NotImplementedError("GCS short-lived credential minting is not implemented yet")
