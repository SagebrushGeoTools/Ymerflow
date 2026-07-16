#!/bin/bash
# Namespace-creation-only provisioning helper for a minikube-based Nagelfluh job cluster.
#
# Historically this also installed the Kueue operator (CRDs/controller/webhook, with readiness
# waits), computed and applied Kueue quotas, and applied the backend-jobs RBAC. All of that has
# moved into `backend.services.cluster_job_provisioning.ensure_cluster_job_ready()` — a
# provider-agnostic Python routine written against `kubernetes_asyncio`, called from the backend
# itself whenever a Cluster is registered/created (`POST /admin/clusters/register-callback` and
# `admin_create_cluster` in `backend/routers/admin.py`) or seeded
# (`backend/alembic/versions/d1266f2f6e68_generic_seed_default_cluster.py`) — see
# docs/plans/registry-backend-hooks.md Design decision 8 / Phase 7.
#
# This shell function now exists ONLY for the remote self-service registration path
# (`dev/setup-minikube-remote.sh.in`, rendered and served by `backend/routers/admin.py`) — it
# provisions a freshly-registered remote cluster's namespace before any backend process has a
# connection to it yet. The LOCAL default cluster's namespace is provisioned the equivalent way by
# `plugins/ymerflow-minikube`'s `MinikubeClusterProvider.bootstrap()`
# (`minikube_plugin/cluster_provider.py`), not this shell function — see
# docs/plans/minikube-provisioning-plugin.md. Either way, `ensure_cluster_job_ready()` also creates
# the namespace idempotently once the backend does start and the Phase-6 seed migration runs
# against it — doing it in both places is harmless, not a duplication bug, see that migration's
# docstring.
#
# Does NOT touch the registry: image-pull credentials are minted per-Job by the backend itself
# (RegistryBackend.pull_credentials(), see docs/plans/registry-backend-hooks.md Design decision 4 /
# Phase 3) rather than provisioned once here as a fixed-name Secret.
#
# Deliberately self-contained (no `kubectl apply -f <repo-relative-path>`) so it can be sourced
# standalone on a remote host that has no Nagelfluh git checkout at all — see
# docs/plans/done/remote-cluster-provisioning-and-registry.md Phase 2/3. (For the remote path,
# Kueue/RBAC/quota readiness comes from register-callback's ensure_cluster_job_ready() call, once
# the admin runs the generated setup command and it calls back — this shell function only ever
# creates the namespace there too.)
#
# This file only DEFINES provision_nagelfluh_jobs() when sourced; it does nothing on its own.
# Callers must `source` it and then invoke the function, with this env var already set:
#   NAGELFLUH_JOBS_NAMESPACE (default nagelfluh-jobs) - must match the Cluster row's `namespace`

provision_nagelfluh_jobs() {
    set -e

    local NAMESPACE="${NAGELFLUH_JOBS_NAMESPACE:-nagelfluh-jobs}"

    echo "=== Provisioning Nagelfluh job prerequisites (namespace=${NAMESPACE}) ==="

    echo "Creating namespace ${NAMESPACE}..."
    kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

    echo "=== Provisioning complete (namespace=${NAMESPACE}) ==="
}
