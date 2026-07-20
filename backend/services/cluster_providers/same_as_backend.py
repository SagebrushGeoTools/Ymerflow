import base64
import os

import yaml

from backend.services.cluster_providers import ClusterProvider
from backend.services.cluster_providers.nodeport_app_deployment import NodePortAppDeploymentMixin

_IN_CLUSTER_SA_DIR = "/var/run/secrets/kubernetes.io/serviceaccount"
_ENV_KUBECONFIG_PATH_SEPARATOR = ";" if os.name == "nt" else ":"


class SameAsBackendClusterProvider(NodePortAppDeploymentMixin, ClusterProvider):
    """Runs jobs on the very cluster the backend process itself is running in (or, in local dev,
    whatever cluster the backend's local kubeconfig points to). No config needed — kubeconfig=None
    is exactly what K8sClient already auto-detects on.

    Supports hosting the app itself too (NodePortAppDeploymentMixin) — this is the cluster type the
    default prod-minikube deployment uses, so it's where dogfooding deploy_app()/expose_app()
    actually happens (Design decision 2 / Phase 5 in docs/plans/app-deployment-hooks.md)."""

    def connect(self, provider_config, namespace):
        from backend.services.k8s_client import K8sClient
        return K8sClient(namespace=namespace, kubeconfig=None)

    def materialize_kubeconfig(self, provider_config: dict) -> dict:
        """Mirrors exactly what connect()'s K8sClient(kubeconfig=None) auto-detects on
        (_ensure_initialized(): load_incluster_config() first, else load_kube_config()) — but
        returns the credential as a kubeconfig dict instead of loading it into process-global
        client state, for a kubectl-based script to consume via KUBECONFIG. See
        docs/plans/base-infrastructure-via-cluster-provider.md, Design decision 1."""
        if os.path.exists(os.path.join(_IN_CLUSTER_SA_DIR, "token")):
            with open(os.path.join(_IN_CLUSTER_SA_DIR, "token")) as f:
                token = f.read().strip()
            with open(os.path.join(_IN_CLUSTER_SA_DIR, "ca.crt"), "rb") as f:
                ca_cert_data = base64.b64encode(f.read()).decode()
            host = os.environ["KUBERNETES_SERVICE_HOST"]
            port = os.environ["KUBERNETES_SERVICE_PORT"]
            return {
                "apiVersion": "v1",
                "kind": "Config",
                "clusters": [{
                    "name": "in-cluster",
                    "cluster": {
                        "server": f"https://{host}:{port}",
                        "certificate-authority-data": ca_cert_data,
                    },
                }],
                "users": [{"name": "in-cluster", "user": {"token": token}}],
                "contexts": [{
                    "name": "in-cluster",
                    "context": {"cluster": "in-cluster", "user": "in-cluster"},
                }],
                "current-context": "in-cluster",
            }

        return self._load_local_kubeconfig()

    def _load_local_kubeconfig(self) -> dict:
        """Read and merge whatever kubeconfig file(s) load_kube_config() would auto-detect
        (KUBECONFIG, colon-separated on POSIX, falling back to ~/.kube/config), the same merge
        semantics as kubernetes_asyncio's own KubeConfigMerger (later files only add
        clusters/contexts/users not already present by name; the last file that sets
        current-context wins)."""
        default_path = os.path.expanduser(os.path.join("~", ".kube", "config"))
        paths = [
            os.path.expanduser(p)
            for p in os.environ.get("KUBECONFIG", default_path).split(_ENV_KUBECONFIG_PATH_SEPARATOR)
            if p and os.path.exists(os.path.expanduser(p))
        ]
        if not paths:
            raise FileNotFoundError(
                f"no kubeconfig file found (KUBECONFIG={os.environ.get('KUBECONFIG')!r}, "
                f"default={default_path!r})"
            )

        merged = None
        for path in paths:
            with open(path) as f:
                config = yaml.safe_load(f)
            if merged is None:
                merged = {**config, "clusters": [], "contexts": [], "users": []}
            for key in ("clusters", "contexts", "users"):
                existing_names = {item["name"] for item in merged[key]}
                merged[key].extend(
                    item for item in (config.get(key) or []) if item["name"] not in existing_names
                )
            if "current-context" in config:
                merged["current-context"] = config["current-context"]
        return merged

    def bootstrap(self, provider_config: dict) -> dict:
        """Passthrough — there is nothing to provision, this provider always just points at
        whatever cluster the backend process itself is already running in (see Design decision 6
        in docs/plans/registry-backend-hooks.md)."""
        return provider_config
