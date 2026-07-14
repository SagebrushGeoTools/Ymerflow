# Cleanup: ClusterProvider.connect() returns a K8sClient

## Goal

`ClusterProvider.connect()` returns raw kubeconfig data (`dict | None`); callers build a
`K8sClient` from it. Change it to return a `K8sClient` (or subclass) directly, so a provider
needing custom client behavior (e.g. token refresh) can subclass `K8sClient` and override its
methods, instead of the base classes growing new parameters/hooks per use case.

## Current state

- `ClusterProvider.connect(self, provider_config) -> dict | None` (`backend/services/cluster_providers/__init__.py`).
- Two callers:
  - `ClusterProvider.test_connection()` default (`__init__.py:41`):
    `client = K8sClient(namespace="default", kubeconfig=self.connect(provider_config))`
  - `K8sClientRegistry.get()` (`backend/services/k8s_client.py:406`):
    `K8sClient(namespace=cluster.namespace, kubeconfig=provider.connect(cluster.provider_config))`
- Implementations: `SameAsBackendClusterProvider.connect()` returns `None`.
  `KubeconfigClusterProvider.connect()` returns `provider_config["kubeconfig"]`.
  `MinikubeClusterProvider` inherits `KubeconfigClusterProvider` unchanged.

## Change

**`backend/services/cluster_providers/__init__.py`**
- `connect(self, provider_config: dict, namespace: str) -> "K8sClient"` (signature + return type change).
- `test_connection()` default body: `client = self.connect(provider_config, "default")`.

**`backend/services/cluster_providers/same_as_backend.py`**
```python
def connect(self, provider_config, namespace):
    return K8sClient(namespace=namespace, kubeconfig=None)
```

**`backend/services/cluster_providers/kubeconfig.py`**
```python
def connect(self, provider_config, namespace):
    return K8sClient(namespace=namespace, kubeconfig=provider_config["kubeconfig"])
```
`test_connection()` unchanged.

**`backend/services/k8s_client.py`**
- `K8sClientRegistry.get()` body: `self._clients[cluster.id] = provider.connect(cluster.provider_config, cluster.namespace)`.
- `K8sClient` class: unchanged.

**`backend/services/cluster_providers/minikube.py`**: no change (inherits `KubeconfigClusterProvider`).

## Verification

- Existing clusters (`same-as-backend`, `kubeconfig`, `minikube`) still connect and run jobs.
- `test_connection()` (button + create/edit routes) still works for all three types.
