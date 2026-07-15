"""Registry of per-protocol container-registry handlers.

A `RegistryProtocolHandler` implements the actual operations for one value of
`RegistryBackend.protocol` (e.g. 'docker-v2', 'gar'). This is the third pluggable-backend axis,
mirroring `StorageBackend`/`StorageProtocolHandler` (`backend/services/storage_protocols/`) and
`Cluster`/`ClusterProvider` (`backend/services/cluster_providers/`) exactly.

Handlers are discovered through the `registry_protocol_handlers` fan-out hook, the same
`nagelfluh.hooks` mechanism used for `storage_protocol_handlers` / `cluster_provider_handlers`.
Core registers its own built-in handler (docker-v2) through this exact hook too — see
`setup.py`'s `nagelfluh.hooks` entry point — so a plugin adding a new protocol (e.g. Google
Artifact Registry) uses the identical channel core does, with no "core is special" path.
"""
from backend.hooks import hooks


class RegistryProtocolHandler:
    """Implements protocol-specific container-registry operations for one value of
    RegistryBackend.protocol (e.g. 'docker-v2', 'gar')."""

    def image_url(self, config: dict, repository: str, tag: str) -> str:
        """The single place address *shape* is decided (mirrors
        StorageProtocolHandler.storage_base_url). `docker-v2` returns
        `host:port/repository:tag`."""
        raise NotImplementedError

    async def pull_credentials(self, config: dict) -> dict:
        """Resolve a pod image-pull credential. Returns
        {"username": str, "password": str, "expires_at": datetime | None}.
        `docker-v2` returns the static user/password from its config, expires_at=None (i.e.
        "never refresh, reuse the pod-launch-time value" — see Design decision 4 in
        docs/plans/registry-backend-hooks.md)."""
        raise NotImplementedError

    def configure_push_auth(self, config: dict) -> None:
        """Perform whatever local docker login / credential-helper setup push-side tooling
        needs before a `docker push`. `docker-v2` does today's
        `docker login host:port -u ... -p ...` (see docker/build.sh)."""
        raise NotImplementedError

    async def test_connection(self, config: dict) -> None:
        """Raise a clear exception if this config can't actually reach/authenticate against a
        registry. No default implementation: protocols are too different from each other for a
        shared check (unlike ClusterProvider, where one generic k8s-list-namespaces check
        covers every cluster type)."""
        raise NotImplementedError

    def bootstrap(self, config: dict) -> dict:
        """Given whatever config.env / seed-time config was supplied for this protocol, return
        an enriched config ready to persist onto the RegistryBackend row — e.g. provisioning a
        service account or minting a first credential. Every core-provided handler implements
        this as a passthrough (`return config`); live-provisioning bootstrap is entirely plugin
        territory (see Design decision 6 in docs/plans/registry-backend-hooks.md). Not called
        anywhere yet in Phase 1 — the hook exists so Phase 4's generic
        `nagelfluh-bootstrap-provision` entry point has somewhere to call into."""
        raise NotImplementedError


def registry_protocol_handlers():
    """Core's built-in protocol handlers, registered under nagelfluh.hooks in the root setup.py
    exactly like a plugin's would be — hence returned as (name, class) tuples, not stored in a
    private dict. Core has no special precedence over plugins.

    Imports are local to break the import cycle: each handler module imports
    `RegistryProtocolHandler` from this module, so they can only be imported once this module has
    finished defining it."""
    from backend.services.registry_protocols.docker_v2 import DockerV2ProtocolHandler

    return [
        ("docker-v2", DockerV2ProtocolHandler),
    ]


_registry = None


def get_registry_protocol_handler(protocol):
    global _registry
    if _registry is None:
        registry = {}
        for name, handler_cls in hooks.run.registry_protocol_handlers():
            if name in registry:
                raise ValueError(
                    f"duplicate registry_protocol_handlers registration for protocol {name!r}"
                )
            registry[name] = handler_cls
        _registry = registry
    return _registry[protocol]()
