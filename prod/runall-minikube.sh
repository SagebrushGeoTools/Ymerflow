#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# ── Configuration ──────────────────────────────────────────────────────────────
# HOST_IP: the IP (or hostname) that client machines will use to reach this server.
# Defaults to the primary non-loopback IP of this host.
HOST_IP="${HOST_IP:-$(hostname -I | awk '{print $1}')}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

echo "========================================"
echo "Nagelfluh - Production Minikube Setup"
echo "========================================"
echo ""
echo "  Host IP:   ${HOST_IP}  (override with HOST_IP=x.x.x.x)"
echo "  Port:      ${FRONTEND_PORT}  (override with FRONTEND_PORT=N)"
echo ""
echo "  Clients will reach the app at: http://${HOST_IP}:${FRONTEND_PORT}"

# ── Step 1: Base infrastructure ───────────────────────────────────────────────

echo ""
echo "Step 1: Setting up Minikube / Kueue..."
"${PROJECT_ROOT}/dev/setup-minikube.sh"

echo ""
echo "Step 2: Setting up MinIO..."
"${PROJECT_ROOT}/dev/setup-minio.sh"

echo ""
echo "Step 3: Setting up Docker registry..."
"${PROJECT_ROOT}/dev/setup-registry.sh"

# ── Step 2: Python venv (needed for docker/build.sh) ──────────────────────────

echo ""
echo "Step 4: Setting up Python environment..."
if [ ! -d "${PROJECT_ROOT}/env" ]; then
    python3 -m venv "${PROJECT_ROOT}/env"
fi
"${PROJECT_ROOT}/env/bin/pip" install -q -r "${PROJECT_ROOT}/backend/requirements.txt"
source "${PROJECT_ROOT}/env/bin/activate"

# ── Step 3: Namespace + secrets ───────────────────────────────────────────────

MINIKUBE_IP=$(minikube ip)

echo ""
echo "Step 5: Creating nagelfluh namespace..."
kubectl create namespace nagelfluh --dry-run=client -o yaml | kubectl apply -f -

echo ""
echo "Step 6: Creating secrets..."

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

# ── Step 4: PostgreSQL ────────────────────────────────────────────────────────

echo ""
echo "Step 7: Deploying PostgreSQL..."
kubectl apply -f "${PROJECT_ROOT}/k8s/postgres/"

echo "  Waiting for PostgreSQL to be ready..."
kubectl rollout status statefulset/postgres -n nagelfluh --timeout=120s
kubectl wait --for=condition=ready pod -l app=postgres -n nagelfluh --timeout=120s

# ── Step 5: Build Docker images ───────────────────────────────────────────────

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

# ── Step 6: Run migrations inside the cluster, then build runner image ────────
# Migrations run as a kubectl Job using nagelfluh-backend:prod (Python 3.11)
# so all dependencies are available. build.sh auto-detects the nagelfluh
# namespace and also updates the bootstrap environment via a kubectl Job.

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

echo ""
echo "Step 10: Building process runner image and updating bootstrap environment..."
"${PROJECT_ROOT}/docker/build.sh"

# ── Step 7: Backend ConfigMap ─────────────────────────────────────────────────
# BACKEND_BASE_URL must use HOST_IP:FRONTEND_PORT because that is the address
# clients' browsers will follow when fetching dataset URLs.

echo ""
echo "Step 11: Creating backend ConfigMap..."
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
  BACKEND_BASE_URL: "http://${HOST_IP}:${FRONTEND_PORT}/api"
  REGISTRY_URL: "${MINIKUBE_IP}:30500"
  ACCESS_TOKEN_EXPIRE_DAYS: "30"
  PROCESS_COST: "0.10"
  INITIAL_USER_BALANCE: "100.0"
EOF

# ── Step 8: Deploy backend and frontend ───────────────────────────────────────

echo ""
echo "Step 12: Deploying backend..."
kubectl apply -f "${PROJECT_ROOT}/k8s/backend/"

echo ""
echo "Step 13: Deploying frontend..."
kubectl apply -f "${PROJECT_ROOT}/k8s/frontend/"

# ── Step 9: Wait for deployments ──────────────────────────────────────────────

echo ""
echo "Step 14: Waiting for deployments to be ready..."
kubectl rollout status deployment/backend -n nagelfluh --timeout=180s
kubectl rollout status deployment/frontend -n nagelfluh --timeout=60s

# ── Step 10: Port-forward frontend on all interfaces ─────────────────────────
# kubectl port-forward with --address 0.0.0.0 binds on every network interface,
# making the app reachable from other machines on the network.

echo ""
echo "Step 15: Starting frontend port-forward (0.0.0.0:${FRONTEND_PORT} -> nginx:80)..."
pkill -f "kubectl port-forward.*nagelfluh.*svc/frontend" 2>/dev/null || true
sleep 1
kubectl port-forward \
    --address 0.0.0.0 \
    -n nagelfluh \
    svc/frontend \
    "${FRONTEND_PORT}:80" \
    &>/dev/null &
echo "  Port-forward started (PID: $!)"

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
