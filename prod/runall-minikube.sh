#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# ── Configuration ──────────────────────────────────────────────────────────────
# Site-specific overrides live in config.env at the project root (not committed to git).
# Copy config.env.example to config.env and edit it once per server.
if [ -f "${PROJECT_ROOT}/config.env" ]; then
    set -a
    # shellcheck source=/dev/null
    source "${PROJECT_ROOT}/config.env"
    set +a
fi

# SERVER_URL: public URL clients use to reach the app (set SERVER_URL in config.env).
# Defaults to http://<primary-host-IP>:3000.
SERVER_URL="${SERVER_URL:-http://$(hostname -I | awk '{print $1}'):3000}"
BACKEND_BASE_URL="${SERVER_URL}/api"

# FRONTEND_PORT: local port socat listens on.
# Defaults to the port in SERVER_URL (or 80/443 for standard HTTP/HTTPS).
if [ -z "${FRONTEND_PORT:-}" ]; then
    FRONTEND_PORT=$(python3 -c "
from urllib.parse import urlparse
url = urlparse('${SERVER_URL}')
if url.port:
    print(url.port)
elif url.scheme == 'https':
    print(443)
else:
    print(80)
")
fi

echo "========================================"
echo "Nagelfluh - Production Minikube Setup"
echo "========================================"
echo ""
echo "  Server URL:     ${SERVER_URL}  (set SERVER_URL in config.env to override)"
echo "  Backend URL:    ${BACKEND_BASE_URL}"
echo "  Listen port:    ${FRONTEND_PORT}"
echo ""
echo "  Clients will reach the app at: ${SERVER_URL}"

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

kubectl create secret generic pgadmin-pgpass \
    --from-literal=pgpass="postgres.nagelfluh.svc.cluster.local:5432:nagelfluh:nagelfluh:nagelfluhpass" \
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

# ── Step 5b: Admin credentials secret ────────────────────────────────────────
# ADMIN_USER and ADMIN_PASSWORD are read from config.env (defaults: admin/password).
# htpasswd is generated with openssl so nginx:alpine can verify it.
# nagelfluh-admin-secret is idempotent: skip if it already exists so a running
# deployment's credentials are never silently rotated.

ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-password}"

echo ""
echo "Step 5b: Creating admin credentials secret..."
if ! kubectl get secret nagelfluh-admin-secret -n nagelfluh &>/dev/null; then
    HTPASSWD="${ADMIN_USER}:$(openssl passwd -apr1 "${ADMIN_PASSWORD}")"
    kubectl create secret generic nagelfluh-admin-secret \
        --from-literal=htpasswd="${HTPASSWD}" \
        --from-literal=pgadmin-email="${ADMIN_USER}@example.com" \
        --from-literal=admin-password="${ADMIN_PASSWORD}" \
        -n nagelfluh
    echo "  Created nagelfluh-admin-secret"
    echo "  Admin username: ${ADMIN_USER}"
    echo "  Admin password: ${ADMIN_PASSWORD}"
    echo "  pgAdmin login:  ${ADMIN_USER}@example.com / ${ADMIN_PASSWORD}"
else
    echo "  nagelfluh-admin-secret already exists, skipping"
    echo "  (delete it with: kubectl delete secret nagelfluh-admin-secret -n nagelfluh)"
fi

# ── Step 5c: Backend ConfigMap ────────────────────────────────────────────────
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
DEPLOYMENT=production-minikube "${PROJECT_ROOT}/docker/build.sh"

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
echo "  App:           ${SERVER_URL}"
echo "  API Docs:      ${SERVER_URL}/api/docs"
echo "  pgAdmin:       ${SERVER_URL}/pgadmin/   (${ADMIN_USER:-admin}@example.com / <admin-password>)"
echo "  K8s Dashboard: ${SERVER_URL}/headlamp/  (${ADMIN_USER:-admin} / <admin-password>)"
echo "  MinIO Console: http://localhost:9001    (minioadmin / minioadmin)"
echo ""
echo "  Admin credentials are in secret nagelfluh-admin-secret (nagelfluh namespace)."
echo "  To rotate: kubectl delete secret nagelfluh-admin-secret -n nagelfluh, then re-run."
echo ""
echo "Useful commands:"
echo "  kubectl logs -f deployment/backend  -n nagelfluh"
echo "  kubectl logs -f deployment/frontend -n nagelfluh"
echo "  kubectl get pods -n nagelfluh"
echo ""
echo "All traffic goes through nginx on port ${FRONTEND_PORT}."
echo "The backend is only reachable inside the cluster."
