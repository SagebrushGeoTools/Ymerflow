#!/bin/bash
# Shared provisioning routine for a minikube-based Nagelfluh job cluster.
#
# Creates the jobs namespace, installs the Kueue operator (CRDs/controller/webhook, with
# readiness waits), computes and applies Kueue quotas from MINIKUBE_CPUS/MINIKUBE_MEMORY, and
# applies the backend-jobs RBAC. Used against whichever cluster the current kubectl context
# points at, so it works identically for the local default cluster and for a freshly `minikube
# start`-ed remote cluster.
#
# Does NOT touch the registry: image-pull credentials are now minted per-Job by the backend
# itself (RegistryBackend.pull_credentials(), see docs/plans/registry-backend-hooks.md Design
# decision 4 / Phase 3) rather than provisioned once here as a fixed-name Secret.
#
# Deliberately self-contained (every manifest is an inline heredoc, no `kubectl apply -f
# <repo-relative-path>`) so it can be sourced standalone on a remote host that has no Nagelfluh
# git checkout at all — see docs/plans/done/remote-cluster-provisioning-and-registry.md Phase 2/3.
#
# This file only DEFINES provision_nagelfluh_jobs() when sourced; it does nothing on its own.
# Callers must `source` it and then invoke the function, with these env vars already set:
#   NAGELFLUH_JOBS_NAMESPACE (default nagelfluh-jobs) - must match the Cluster row's `namespace`
#   NAGELFLUH_BACKEND_NAMESPACE (default nagelfluh) - namespace the backend's ServiceAccount
#     lives in; only meaningful for the "same-as-backend" cluster type, harmless otherwise
#   MINIKUBE_CPUS, MINIKUBE_MEMORY (defaults 4 / 8192) - used to size the Kueue ClusterQueue quota

provision_nagelfluh_jobs() {
    set -e

    local NAMESPACE="${NAGELFLUH_JOBS_NAMESPACE:-nagelfluh-jobs}"
    local BACKEND_NAMESPACE="${NAGELFLUH_BACKEND_NAMESPACE:-nagelfluh}"
    local CPUS="${MINIKUBE_CPUS:-4}"
    local MEMORY_MB="${MINIKUBE_MEMORY:-8192}"

    echo "=== Provisioning Nagelfluh job prerequisites (namespace=${NAMESPACE}) ==="

    echo "Creating namespace ${NAMESPACE}..."
    kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

    # ── Kueue operator ──────────────────────────────────────────────────────────
    local KUEUE_NEEDS_INSTALL=false
    if kubectl get namespace kueue-system &> /dev/null 2>&1; then
        if kubectl get deployment -n kueue-system kueue-controller-manager &> /dev/null 2>&1; then
            local READY
            READY=$(kubectl get deployment -n kueue-system kueue-controller-manager -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
            [ "${READY:-0}" -eq 0 ] && KUEUE_NEEDS_INSTALL=true
        else
            KUEUE_NEEDS_INSTALL=true
        fi
    else
        KUEUE_NEEDS_INSTALL=true
    fi

    if [ "$KUEUE_NEEDS_INSTALL" = true ]; then
        echo "Installing Kueue v0.16.4..."
        if kubectl get namespace kueue-system &> /dev/null 2>&1; then
            echo "  Removing existing kueue-system installation..."
            # Stale APIServices pointing into kueue-system block namespace termination if left
            # behind (the backing service is gone but discovery keeps trying to enumerate it).
            local STALE_APISERVICES
            STALE_APISERVICES=$(kubectl get apiservice \
                -o jsonpath='{range .items[?(@.spec.service.namespace=="kueue-system")]}{.metadata.name}{"\n"}{end}' \
                2>/dev/null || true)
            [ -n "$STALE_APISERVICES" ] && echo "$STALE_APISERVICES" | xargs kubectl delete apiservice --ignore-not-found=true
            kubectl delete namespace kueue-system --timeout=60s || true
        fi
        kubectl apply --server-side -f https://github.com/kubernetes-sigs/kueue/releases/download/v0.16.4/manifests.yaml

        echo "  Waiting for Kueue CRDs to be registered..."
        for i in {1..30}; do
            kubectl get crd clusterqueues.kueue.x-k8s.io &> /dev/null 2>&1 && break
            sleep 2
        done

        echo "  Waiting for Kueue controller to be ready..."
        kubectl wait --for=condition=available --timeout=120s deployment/kueue-controller-manager -n kueue-system || {
            echo "  ⚠ Warning: Kueue controller not ready yet, continuing anyway"
        }
        sleep 10
    else
        echo "✓ Kueue already installed and running"
    fi

    echo "Waiting for Kueue webhook to accept connections..."
    for i in {1..80}; do
        local WEBHOOK_IP WEBHOOK_PORT
        WEBHOOK_IP=$(kubectl get endpoints kueue-webhook-service -n kueue-system \
            -o jsonpath='{.subsets[0].addresses[0].ip}' 2>/dev/null || true)
        WEBHOOK_PORT=$(kubectl get endpoints kueue-webhook-service -n kueue-system \
            -o jsonpath='{.subsets[0].ports[0].port}' 2>/dev/null || true)
        if [ -n "${WEBHOOK_IP}" ] && [ -n "${WEBHOOK_PORT}" ] && minikube ssh -- nc -z -w2 "${WEBHOOK_IP}" "${WEBHOOK_PORT}" 2>/dev/null; then
            echo "✓ Kueue webhook accepting connections at ${WEBHOOK_IP}:${WEBHOOK_PORT}"
            break
        fi
        if [ "$i" -eq 80 ]; then
            echo "❌ Kueue webhook did not become ready in time"
            return 1
        fi
        sleep 5
    done

    # ── Kueue quotas / queues ───────────────────────────────────────────────────
    local KUEUE_CPU_QUOTA=$(( CPUS - 1 ))
    local KUEUE_MEMORY_GI=$(( (MEMORY_MB / 1024) - 1 ))
    [ "$KUEUE_CPU_QUOTA" -lt 1 ] && KUEUE_CPU_QUOTA=1
    [ "$KUEUE_MEMORY_GI" -lt 1 ] && KUEUE_MEMORY_GI=1
    local KUEUE_MEMORY_QUOTA="${KUEUE_MEMORY_GI}Gi"
    echo "Applying Kueue quotas: cpu=${KUEUE_CPU_QUOTA}, memory=${KUEUE_MEMORY_QUOTA}"

    kubectl apply -f - <<EOF
apiVersion: kueue.x-k8s.io/v1beta2
kind: ResourceFlavor
metadata:
  name: default-flavor
---
apiVersion: kueue.x-k8s.io/v1beta2
kind: ClusterQueue
metadata:
  name: nagelfluh-cluster-queue
spec:
  namespaceSelector: {}
  resourceGroups:
  - coveredResources: ["cpu", "memory", "ephemeral-storage"]
    flavors:
    - name: default-flavor
      resources:
      - name: "cpu"
        nominalQuota: ${KUEUE_CPU_QUOTA}
      - name: "memory"
        nominalQuota: ${KUEUE_MEMORY_QUOTA}
      - name: "ephemeral-storage"
        nominalQuota: 100Gi
---
apiVersion: kueue.x-k8s.io/v1beta2
kind: LocalQueue
metadata:
  name: nagelfluh-queue
  namespace: ${NAMESPACE}
spec:
  clusterQueue: nagelfluh-cluster-queue
EOF

    # ── Backend RBAC ─────────────────────────────────────────────────────────────
    # Mirrors k8s/rbac/backend-jobs-rbac.yaml. Only actually exercised by the "same-as-backend"
    # cluster type (where the backend connects using its own in-cluster ServiceAccount token);
    # for kubeconfig-based remote clusters the connecting identity already has whatever rights
    # minikube's own admin kubeconfig grants. Applied unconditionally anyway so every
    # provisioned cluster carries the same least-privilege intent.
    echo "Applying backend-jobs RBAC..."
    kubectl apply -f - <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: nagelfluh-backend-jobs
  namespace: ${NAMESPACE}
rules:
- apiGroups: ["batch"]
  resources: ["jobs"]
  verbs: ["create", "get", "list", "watch", "delete"]
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list", "watch"]
- apiGroups: [""]
  resources: ["pods/log"]
  verbs: ["get"]
- apiGroups: [""]
  resources: ["events"]
  verbs: ["get", "list", "watch"]
- apiGroups: [""]
  resources: ["secrets"]
  verbs: ["create", "get", "update"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: nagelfluh-backend-jobs
  namespace: ${NAMESPACE}
subjects:
- kind: ServiceAccount
  name: default
  namespace: ${BACKEND_NAMESPACE}
roleRef:
  kind: Role
  name: nagelfluh-backend-jobs
  apiGroup: rbac.authorization.k8s.io
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: nagelfluh-backend-kueue-reader
rules:
- apiGroups: ["kueue.x-k8s.io"]
  resources: ["clusterqueues"]
  verbs: ["get"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: nagelfluh-backend-kueue-reader
subjects:
- kind: ServiceAccount
  name: default
  namespace: ${BACKEND_NAMESPACE}
roleRef:
  kind: ClusterRole
  name: nagelfluh-backend-kueue-reader
  apiGroup: rbac.authorization.k8s.io
EOF

    echo "=== Provisioning complete (namespace=${NAMESPACE}) ==="
}
