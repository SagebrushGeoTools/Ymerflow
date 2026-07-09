"""Registry of per-type cluster connection providers.

A `ClusterProvider` implements how to reach one value of `Cluster.cluster_type` (e.g.
'same-as-backend', 'kubeconfig'). `K8sClientRegistry.get()` (`backend/services/k8s_client.py`)
delegates to whichever provider `cluster.cluster_type` resolves to instead of branching on
cluster_type itself.

Providers are discovered through the `cluster_provider_handlers` fan-out hook, the same
`nagelfluh.hooks` mechanism used for `storage_protocol_handlers`. Core registers its own built-in
providers (same-as-backend/kubeconfig) through this exact hook too — see `setup.py`'s
`nagelfluh.hooks` entry point — so a plugin adding a new cluster type (e.g. GKE) uses the
identical channel core does, with no "core is special" path.
"""
import asyncio

from backend.hooks import hooks


class ClusterProvider:
    def connect(self, provider_config: dict):
        """Return a kubeconfig dict for K8sClient, or None to auto-detect."""
        raise NotImplementedError

    async def test_connection(self, provider_config: dict) -> None:
        """Raise a clear exception if this config can't actually reach a cluster.
        Default: resolve a kubeconfig via connect(), then a cheap, timeout-bounded
        list-namespaces call. Override for providers that can validate more cheaply/
        differently (e.g. before even attempting a network call)."""
        from backend.services.k8s_client import K8sClient
        client = K8sClient(namespace="default", kubeconfig=self.connect(provider_config))
        await client._ensure_initialized()
        await asyncio.wait_for(
            client.core_api.list_namespace(limit=1, _request_timeout=10), timeout=15
        )


def cluster_provider_handlers():
    """Core's built-in cluster providers, registered under nagelfluh.hooks in the root setup.py
    exactly like a plugin's would be — hence returned as (name, class) tuples, not stored in a
    private dict. Core has no special precedence over plugins.

    Imports are local to break the import cycle: each provider module imports `ClusterProvider`
    from this module, so they can only be imported once this module has finished defining it."""
    from backend.services.cluster_providers.same_as_backend import SameAsBackendClusterProvider
    from backend.services.cluster_providers.kubeconfig import KubeconfigClusterProvider

    return [
        ("same-as-backend", SameAsBackendClusterProvider),
        ("kubeconfig", KubeconfigClusterProvider),
    ]


_registry = None


def get_cluster_provider(cluster_type: str) -> ClusterProvider:
    global _registry
    if _registry is None:
        registry = {}
        for name, cls in hooks.run.cluster_provider_handlers():
            if name in registry:
                raise ValueError(f"duplicate cluster_provider_handlers registration for {name!r}")
            registry[name] = cls
        _registry = registry
    if cluster_type not in _registry:
        raise ValueError(f"unknown cluster_type {cluster_type!r}")
    return _registry[cluster_type]()
