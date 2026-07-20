import yaml

from backend.services.cluster_providers import ClusterProvider


class KubeconfigClusterProvider(ClusterProvider):
    """provider_config['kubeconfig'] is either an already-parsed dict (the steady state, once
    test_connection has normalized it) or a raw YAML/JSON string (as submitted by the frontend,
    which never parses the pasted kubeconfig itself — see docs/plans/cluster-admin-ui.md Phase
    4.1)."""

    def connect(self, provider_config, namespace):
        from backend.services.k8s_client import K8sClient
        return K8sClient(namespace=namespace, kubeconfig=provider_config["kubeconfig"])

    def materialize_kubeconfig(self, provider_config: dict) -> dict:
        """provider_config["kubeconfig"] already *is* one — parse it if it's still the raw
        YAML/JSON string form (test_connection() normalizes it to a dict, but a caller may not
        have run that first)."""
        raw = provider_config["kubeconfig"]
        return yaml.safe_load(raw) if isinstance(raw, str) else raw

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

    def bootstrap(self, provider_config: dict) -> dict:
        """Passthrough — there is nothing to provision, this provider always just connects with
        whatever kubeconfig was supplied (see Design decision 6 in
        docs/plans/registry-backend-hooks.md)."""
        return provider_config
