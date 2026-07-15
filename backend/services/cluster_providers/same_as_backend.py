from backend.services.cluster_providers import ClusterProvider


class SameAsBackendClusterProvider(ClusterProvider):
    """Runs jobs on the very cluster the backend process itself is running in (or, in local dev,
    whatever cluster the backend's local kubeconfig points to). No config needed — kubeconfig=None
    is exactly what K8sClient already auto-detects on."""

    def connect(self, provider_config, namespace):
        from backend.services.k8s_client import K8sClient
        return K8sClient(namespace=namespace, kubeconfig=None)

    def bootstrap(self, provider_config: dict) -> dict:
        """Passthrough — there is nothing to provision, this provider always just points at
        whatever cluster the backend process itself is already running in (see Design decision 6
        in docs/plans/registry-backend-hooks.md)."""
        return provider_config
