from backend.services.cluster_providers import ClusterProvider


class SameAsBackendClusterProvider(ClusterProvider):
    """Runs jobs on the very cluster the backend process itself is running in (or, in local dev,
    whatever cluster the backend's local kubeconfig points to). No config needed — connect()
    returning None is exactly what K8sClient already auto-detects on."""

    def connect(self, provider_config):
        return None
