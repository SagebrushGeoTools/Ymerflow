#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# ── Configuration ──────────────────────────────────────────────────────────────
# Site-specific overrides live in prod/config.env (not committed to git).
# Copy prod/config.env.example to prod/config.env and edit it once per server.
if [ -f "${SCRIPT_DIR}/config.env" ]; then
    # shellcheck source=/dev/null
    source "${SCRIPT_DIR}/config.env"
fi

# HOST_IP: the IP (or hostname) that client machines will use to reach this server.
# Defaults to the primary non-loopback IP of this host.
HOST_IP="${HOST_IP:-$(hostname -I | awk '{print $1}')}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

# BACKEND_BASE_URL: full public URL of the API as seen by client browsers.
# Resolution order:
#   1. Value from prod/config.env (or env var passed on command line)
#   2. Value already stored in the cluster ConfigMap (preserves across upgrades)
#   3. Computed default using HOST_IP (only correct for plain IP access, not HTTPS)
if [ -z "${BACKEND_BASE_URL:-}" ]; then
    BACKEND_BASE_URL=$(kubectl get configmap nagelfluh-backend-config -n nagelfluh \
        -o jsonpath='{.data.BACKEND_BASE_URL}' 2>/dev/null || true)
fi
BACKEND_BASE_URL="${BACKEND_BASE_URL:-http://${HOST_IP}:${FRONTEND_PORT}/api}"

echo "========================================"
echo "Nagelfluh - Production Minikube Setup"
echo "========================================"
echo ""
echo "  Host IP:        ${HOST_IP}  (override with HOST_IP=x.x.x.x)"
echo "  Port:           ${FRONTEND_PORT}  (override with FRONTEND_PORT=N)"
echo "  Backend URL:    ${BACKEND_BASE_URL}  (override with BACKEND_BASE_URL=https://...)"
echo ""
echo "  Clients will reach the app at: ${BACKEND_BASE_URL%/api}"

# ── Step 1: Base infrastructure ───────────────────────────────────────────────

echo ""
echo "Step 1: Setting up Minikube / Kueue..."
"${PROJECT_ROOT}/dev/setup-minikube.sh"

echo ""
echo "  Waiting for Kueue webhook to be ready..."
kubectl wait --for=condition=available --timeout=120s deployment/kueue-controller-manager -n kueue-system
# Wait for the webhook TLS endpoint to actually accept connections before proceeding
for i in {1..30}; do
    WEBHOOK_EP=$(kubectl get endpoints kueue-webhook-service -n kueue-system -o jsonpath='{.subsets[0].addresses[0].ip}' 2>/dev/null || true)
    if [ -n "${WEBHOOK_EP}" ]; then
        echo "  Kueue webhook endpoint ready: ${WEBHOOK_EP}"
        break
    fi
    sleep 3
done

echo ""
echo "Step 2: Setting up MinIO..."
"${PROJECT_ROOT}/dev/setup-minio.sh"

echo ""
echo "Step 3: Setting up Docker registry..."
"${PROJECT_ROOT}/dev/setup-registry.sh"

# ── Step 4: Namespaces ────────────────────────────────────────────────────────
# Apply namespaces first so secrets and ConfigMap can be created into them.

MINIKUBE_IP=$(minikube ip)

echo ""
echo "Step 4: Creating namespaces..."
kubectl apply -f "${PROJECT_ROOT}/k8s/00-namespaces.yaml"

# ── Step 5: Secrets ───────────────────────────────────────────────────────────
# Secrets are created imperatively because they either contain generated values
# (JWT key) or are managed outside of git (credentials).

echo ""
echo "Step 5: Creating secrets..."

kubectl create secret generic nagelfluh-postgres-secret \
    --from-literal=postgres-password=nagelfluhpass \
    -n nagelfluh \
    --dry-run=client -o yaml | kubectl apply -f -

# Preserve JWT key across runs so existing sessions stay valid
if ! kubectl get secret nagelfluh-backend-secret -n nagelfluh &>/dev/null; then
    JWT_SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
    kubectl create secret generic nagelfluh-backend-secret \
        --from-literal=JWT_SECRET_KEY="${JWT_SECRET}" \
        --from-literal=MINIO_ROOT_PASSWORD=minioadmin \
        --from-literal="MC_HOST_minio=http://minioadmin:minioadmin@minio.minio.svc.cluster.local:9000" \
        -n nagelfluh
    echo "  Created nagelfluh-backend-secret"
else
    echo "  nagelfluh-backend-secret already exists, skipping"
fi

# ── Step 5: Backend ConfigMap ─────────────────────────────────────────────────
# Created before applying k8s/ so the backend deployment can reference it.
# BACKEND_BASE_URL must use HOST_IP:FRONTEND_PORT because that is the address
# clients' browsers will follow when fetching dataset URLs.

echo ""
echo "Step 6: Creating backend ConfigMap..."
kubectl apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: nagelfluh-backend-config
  namespace: nagelfluh
data:
  STORAGE_PROTOCOL: "s3"
  STORAGE_ENDPOINT: "http://minio.minio.svc.cluster.local:9000"
  STORAGE_BUCKET_PREFIX: "nagelfluh-project-"
  MINIO_ROOT_USER: "minioadmin"
  BACKEND_BASE_URL: "${BACKEND_BASE_URL}"
  REGISTRY_URL: "${MINIKUBE_IP}:30500"
  ACCESS_TOKEN_EXPIRE_DAYS: "30"
  PROCESS_COST: "0.10"
  INITIAL_USER_BALANCE: "100.0"
EOF

# ── Step 6: Apply all Kubernetes manifests ────────────────────────────────────
# k8s/00-namespaces.yaml sorts first, ensuring namespaces exist before other
# resources are created. Backend/frontend pods will stay pending until images
# are built in the next step.

echo ""
echo "Step 7: Applying Kubernetes manifests..."
kubectl apply -R -f "${PROJECT_ROOT}/k8s/"

echo ""
echo "  Waiting for PostgreSQL to be ready..."
kubectl rollout status statefulset/postgres -n nagelfluh --timeout=120s
kubectl wait --for=condition=ready pod -l app=postgres -n nagelfluh --timeout=120s

# ── Step 7: Build Docker images ───────────────────────────────────────────────

echo ""
echo "Step 8: Building Docker images (using Minikube's Docker daemon)..."
eval $(minikube docker-env)

echo ""
echo "  Building backend image..."
docker build -t nagelfluh-backend:prod \
    -f "${PROJECT_ROOT}/backend/Dockerfile" \
    "${PROJECT_ROOT}"

echo ""
echo "  Building frontend image (REACT_APP_API_URL=/api via nginx proxy)..."
docker build \
    -t nagelfluh-frontend:prod \
    -f "${PROJECT_ROOT}/frontend/Dockerfile" \
    "${PROJECT_ROOT}/frontend"

# ── Step 8: Run migrations inside the cluster ─────────────────────────────────
# Runs alembic as a kubectl Job using nagelfluh-backend:prod (Python 3.11)
# so all dependencies (libaarhusxyz, msgpack, etc.) are available.

echo ""
echo "Step 9: Running database migrations..."
kubectl delete job alembic-migrate -n nagelfluh --ignore-not-found=true 2>/dev/null
kubectl apply -f - <<'MANIFEST'
apiVersion: batch/v1
kind: Job
metadata:
  name: alembic-migrate
  namespace: nagelfluh
spec:
  template:
    spec:
      containers:
      - name: alembic
        image: nagelfluh-backend:prod
        imagePullPolicy: Never
        command: ["alembic", "-c", "backend/alembic.ini", "upgrade", "head"]
        env:
        - name: DATABASE_URL
          value: "postgresql://nagelfluh:nagelfluhpass@postgres.nagelfluh.svc.cluster.local:5432/nagelfluh"
      restartPolicy: Never
  backoffLimit: 0
MANIFEST
kubectl wait --for=condition=complete job/alembic-migrate -n nagelfluh --timeout=120s
kubectl logs job/alembic-migrate -n nagelfluh
kubectl delete job alembic-migrate -n nagelfluh

# ── Step 9: Build runner image and update bootstrap environment ───────────────
# build.sh detects the nagelfluh namespace and runs update_bootstrap_environment
# as a kubectl Job, reaching PostgreSQL via in-cluster DNS.

echo ""
echo "Step 10: Building process runner image and updating bootstrap environment..."
PRODUCTION=true "${PROJECT_ROOT}/docker/build.sh"

# ── Step 10: Restart deployments to pick up new images ───────────────────────

echo ""
echo "Step 11: Restarting deployments..."
kubectl rollout restart deployment/backend -n nagelfluh
kubectl rollout restart deployment/frontend -n nagelfluh

echo ""
echo "  Waiting for deployments to be ready..."
kubectl rollout status deployment/backend -n nagelfluh --timeout=180s
kubectl rollout status deployment/frontend -n nagelfluh --timeout=60s

# ── Step 11: Port-forward frontend on all interfaces ─────────────────────────
# kubectl port-forward with --address 0.0.0.0 binds on every network interface,
# making the app reachable from other machines on the network.

echo ""
echo "Step 12: Starting socat forwarder (0.0.0.0:${FRONTEND_PORT} -> minikube:30080)..."
pkill -f "socat TCP-LISTEN:${FRONTEND_PORT}" 2>/dev/null || true
sleep 1

MINIKUBE_IP=$(minikube ip)

if [ "${FRONTEND_PORT}" -lt 1024 ]; then
    echo "  Port ${FRONTEND_PORT} < 1024: running socat with sudo..."
    sudo -v
    sudo setsid socat TCP-LISTEN:${FRONTEND_PORT},bind=0.0.0.0,fork,reuseaddr TCP:${MINIKUBE_IP}:30080 &>/tmp/socat-frontend.log &
else
    setsid socat TCP-LISTEN:${FRONTEND_PORT},bind=0.0.0.0,fork,reuseaddr TCP:${MINIKUBE_IP}:30080 &>/tmp/socat-frontend.log &
fi
sleep 2

# Verify the port is actually listening
if ss -tlnp | grep -q ":${FRONTEND_PORT} "; then
    echo "  socat is listening on :${FRONTEND_PORT}"
else
    echo "  WARNING: socat does not appear to be listening on :${FRONTEND_PORT}"
    echo "  Try running manually: sudo socat TCP-LISTEN:${FRONTEND_PORT},bind=0.0.0.0,fork,reuseaddr TCP:${MINIKUBE_IP}:30080"
    echo "  socat log: /tmp/socat-frontend.log"
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "========================================"
echo "Setup complete!"
echo "========================================"
echo ""
echo "  App:           http://${HOST_IP}:${FRONTEND_PORT}"
echo "  API Docs:      http://${HOST_IP}:${FRONTEND_PORT}/api/docs"
echo "  MinIO Console: http://localhost:9001  (minioadmin / minioadmin)"
echo ""
echo "Useful commands:"
echo "  kubectl logs -f deployment/backend  -n nagelfluh"
echo "  kubectl logs -f deployment/frontend -n nagelfluh"
echo "  kubectl get pods -n nagelfluh"
echo ""
echo "All traffic goes through nginx on port ${FRONTEND_PORT}."
echo "The backend is only reachable inside the cluster."
