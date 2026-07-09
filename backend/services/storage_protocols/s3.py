"""AWS S3 protocol handler — stub.

New code, not a refactor of anything existing (Nagelfluh has no real-AWS storage support today —
the existing `minio_service.py` code talks to MinIO's S3-compatible API, handled by
`MinioProtocolHandler`, not this one). `provision()` will create an IAM role/policy + bucket for
`static-key` use; `mint()` will call STS `AssumeRole` for the `short-lived` strategy. Both are
Phase 4+ work.
"""
from backend.services.storage_protocols import StorageProtocolHandler


class S3ProtocolHandler(StorageProtocolHandler):
    def provision(self, project, backend) -> dict:
        raise NotImplementedError("AWS S3 storage provisioning is not implemented yet")

    def mint(self, project, backend) -> dict:
        raise NotImplementedError("AWS S3 short-lived credential minting is not implemented yet")

    async def test_connection(self, backend) -> None:
        raise NotImplementedError("AWS S3 storage support is not implemented yet")
