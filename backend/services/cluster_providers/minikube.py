from backend.services.cluster_providers.kubeconfig import KubeconfigClusterProvider


class MinikubeClusterProvider(KubeconfigClusterProvider):
    """Runtime connection mechanics are identical to the generic 'kubeconfig' type — both are
    ultimately just a stored kubeconfig dict/string. The only real difference is the registration
    UX: no Cluster row exists at all until the admin actually runs the self-service setup command
    on the target host and its callback lands at POST /admin/clusters/register-callback — see
    docs/plans/minikube-cluster-registration-ux.md. self_service_registration=True is what drives
    that: the setup command (built entirely client-side, in MinikubeClusterForm.jsx — no backend
    round trip) is what admin_create_cluster refuses to accept a direct POST for."""

    self_service_registration = True
