from backend.services.cluster_providers.kubeconfig import KubeconfigClusterProvider
from backend.services.cluster_providers.nodeport_app_deployment import NodePortAppDeploymentMixin


class MinikubeClusterProvider(NodePortAppDeploymentMixin, KubeconfigClusterProvider):
    """Runtime connection mechanics are identical to the generic 'kubeconfig' type — both are
    ultimately just a stored kubeconfig dict/string. The only real difference is the registration
    UX: no Cluster row exists at all until the admin actually runs the self-service setup command
    on the target host and its callback lands at POST /admin/clusters/register-callback — see
    docs/plans/minikube-cluster-registration-ux.md. self_service_registration=True is what drives
    that: the setup command (built entirely client-side, in MinikubeClusterForm.jsx — no backend
    round trip) is what admin_create_cluster refuses to accept a direct POST for.

    App hosting is NodePort-based, identical to same-as-backend (NodePortAppDeploymentMixin) —
    both ultimately expose the frontend on a host-published NodePort, which is exactly how a
    minikube deployment reaches the app today."""

    self_service_registration = True
