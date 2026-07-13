from backend.services.cluster_providers.kubeconfig import KubeconfigClusterProvider


class MinikubeClusterProvider(KubeconfigClusterProvider):
    """Runtime connection mechanics are identical to the generic 'kubeconfig' type — both are
    ultimately just a stored kubeconfig dict/string. The only real difference is the registration
    UX: a 'minikube' cluster's provider_config is filled in later, by
    POST /admin/clusters/register-callback, after the admin runs the self-service setup script on
    the target host — see docs/plans/done/remote-cluster-provisioning-and-registry.md Phase 3/4/5.
    self_service_registration=True is what actually drives that: a freshly-created 'minikube'
    cluster has an empty provider_config until the callback lands, so admin_create_cluster must
    not call test_connection() for it at creation time like it does for every other type."""

    self_service_registration = True

    def registration_command(self, token: str) -> str:
        from backend.config import settings
        return (
            f"curl -fsSL {settings.backend_base_url}/static/assets/setup-minikube-remote.sh "
            f"| REGISTER_TOKEN={token} bash"
        )
