"""Registry of per-protocol storage handlers.

A `StorageProtocolHandler` implements the actual API calls for one value of
`StorageBackend.protocol` (e.g. 'minio', 'gcs', 's3'). `CredentialStrategy` implementations
(`backend/services/storage_credentials.py`) delegate to whichever handler `backend.protocol`
resolves to instead of branching on protocol themselves — that axis (strategy vs. protocol) stays
independently extensible.

Handlers are discovered through the `storage_protocol_handlers` fan-out hook, the same
`nagelfluh.hooks` mechanism used for `job_pre_run` / `job_completed` / `user_created`. Core
registers its own built-in handlers (minio/gcs/s3) through this exact hook too — see
`setup.py`'s `nagelfluh.hooks` entry point — so a plugin adding a new protocol (e.g. Azure) uses
the identical channel core does, with no "core is special" path.
"""
from backend.hooks import hooks


class StorageProtocolHandler:
    """Implements protocol-specific storage operations for one value of
    StorageBackend.protocol (e.g. 'minio', 'gcs', 's3'). CredentialStrategy
    implementations delegate to one of these instead of branching on
    `backend.protocol` themselves."""

    def provision(self, project, backend) -> dict:
        """One-time setup at project creation: bucket/service-account/policy creation.
        Returns credentials to persist for static-key use, or {} if this protocol never
        persists a long-lived credential."""
        raise NotImplementedError

    def mint(self, project, backend) -> dict:
        """Mint a fresh credential. Returns {"credentials": {...}, "expires_at": datetime | None}."""
        raise NotImplementedError

    async def test_connection(self, backend) -> None:
        """Validate connectivity/credentials only — no side effects, safe to call
        repeatedly from the admin UI before any project exists to provision for.
        No default implementation: protocols are too different from each other for a
        shared check (unlike ClusterProvider, where one generic k8s-list-namespaces
        check covers every cluster type)."""
        raise NotImplementedError


def storage_protocol_handlers():
    """Core's built-in protocol handlers, registered under nagelfluh.hooks in the root setup.py
    exactly like a plugin's would be — hence returned as (name, class) tuples, not stored in a
    private dict. Core has no special precedence over plugins.

    Imports are local to break the import cycle: each handler module imports
    `StorageProtocolHandler` from this module, so they can only be imported once this module has
    finished defining it."""
    from backend.services.storage_protocols.minio import MinioProtocolHandler
    from backend.services.storage_protocols.s3 import S3ProtocolHandler

    return [
        ("minio", MinioProtocolHandler),
        ("s3", S3ProtocolHandler),
    ]


_registry = None


def get_protocol_handler(protocol):
    global _registry
    if _registry is None:
        registry = {}
        for name, handler_cls in hooks.run.storage_protocol_handlers():
            if name in registry:
                raise ValueError(
                    f"duplicate storage_protocol_handlers registration for protocol {name!r}"
                )
            registry[name] = handler_cls
        _registry = registry
    return _registry[protocol]()
