import yaml

from backend.services.cluster_providers import ClusterProvider


class KubeconfigClusterProvider(ClusterProvider):
    """provider_config['kubeconfig'] is either an already-parsed dict (the steady state, once
    test_connection has normalized it) or a raw YAML/JSON string (as submitted by the frontend,
    which never parses the pasted kubeconfig itself — see docs/plans/cluster-admin-ui.md Phase
    4.1)."""

    def connect(self, provider_config):
        return provider_config["kubeconfig"]

    async def test_connection(self, provider_config):
        raw = provider_config.get("kubeconfig")
        if isinstance(raw, str):
            try:
                parsed = yaml.safe_load(raw)
            except yaml.YAMLError as e:
                raise ValueError(f"invalid kubeconfig YAML/JSON: {e}")
            if not isinstance(parsed, dict):
                raise ValueError("kubeconfig must be a YAML/JSON mapping")
            provider_config["kubeconfig"] = parsed
        await super().test_connection(provider_config)
