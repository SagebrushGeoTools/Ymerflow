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
# Defaults to http://<primary-host-IP>:30080 — the frontend NodePort, published directly
# on the host by minikube's docker driver (see dev/setup-minikube.sh).
SERVER_URL="${SERVER_URL:-http://$(hostname -I | awk '{print $1}'):30080}"
BACKEND_BASE_URL="${SERVER_URL}/api"

echo "========================================"
echo "Nagelfluh - Production Minikube Setup"
echo "========================================"
echo ""
echo "  Server URL:     ${SERVER_URL}  (set SERVER_URL in config.env to override)"
echo "  Backend URL:    ${BACKEND_BASE_URL}"
echo ""
echo "  Clients will reach the app at: ${SERVER_URL}"

# ── Step 1: Base infrastructure ───────────────────────────────────────────────

# LAN IP added to the apiserver cert SAN so a remote kubeconfig connecting via this IP
# passes TLS verification (see dev/setup-minikube.sh MINIKUBE_APISERVER_IPS).
export MINIKUBE_APISERVER_IPS="${MINIKUBE_APISERVER_IPS:-$(hostname -I | awk '{print $1}')}"

# Public host:port used to address the Docker registry everywhere (push and every cluster's
# pull, including this one) — never minikube's internal IP. See
# docs/plans/done/remote-cluster-provisioning-and-registry.md.
export REGISTRY_PUBLIC_HOST="${REGISTRY_PUBLIC_HOST:-$(hostname -I | awk '{print $1}')}"

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
echo "Step 1b: Pre-pulling images into minikube..."
"${PROJECT_ROOT}/dev/prepull-images.sh"

echo ""
echo "Step 2: Setting up MinIO..."
"${PROJECT_ROOT}/dev/setup-minio.sh"

echo ""
echo "Step 3: Setting up Docker registry..."
"${PROJECT_ROOT}/dev/setup-registry.sh"

# ── Step 4: Namespaces ────────────────────────────────────────────────────────
# Apply namespaces first so secrets and ConfigMap can be created into them.

echo ""
echo "Step 4: Creating namespaces..."
kubectl apply -f "${PROJECT_ROOT}/k8s/00-namespaces.yaml"

# ── Step 4b: Build backend Docker image (moved up from the old "Step 8") ──────
# The backend image is built here, ahead of secrets, so nagelfluh-bootstrap-provision (Step 4c
# below) can run against it via `docker run` — that script needs the full backend Python
# environment (it imports backend.services.registry_protocols/storage_protocols/
# cluster_providers), and this repo has no lightweight/dependency-free way to run it host-side
# for prod-minikube (unlike dev/runall.sh, which sets up a host venv). Building the image early
# and running it as a one-off `docker run --rm` is the closest equivalent to "host-side" this
# deployment mode has: `docker run` executes the container process, but the invocation and stdout
# capture happen from this host shell, so the resulting JSON ends up as a normal host-side shell
# variable — no K8s Job/API involved, matching Design decision 6's "host-side" constraint in
# docs/plans/registry-backend-hooks.md. The frontend image build stays at its original position
# (still "Step 8"), now building only the frontend image since the backend build moved here.

echo ""
echo "Step 4b: Building backend Docker image (using Minikube's Docker daemon)..."
eval $(minikube docker-env)

docker build -t nagelfluh-backend:prod \
    --build-arg BACKEND_PLUGINS="${BACKEND_PLUGINS:-}" \
    -f "${PROJECT_ROOT}/backend/Dockerfile" \
    "${PROJECT_ROOT}"

# ── Step 4c: Bootstrap-provision configured backends ──────────────────────────
# For each axis (registry/storage/cluster) where an operator opted into a plugin-provided
# protocol via <AXIS>_PROTOCOL/<AXIS>_CONFIG_JSON in config.env (already exported above),
# resolve its handler and call bootstrap(). The enriched {protocol, config} result is folded
# into nagelfluh-backend-secret below (Step 5) so the alembic-migrate Job (Step 9) and the
# backend Deployment both see it. If no axis is configured this way (the common case),
# bootstrap-provision prints "{}" and nothing is added to the secret — fully backward
# compatible. See docs/plans/registry-backend-hooks.md (Design decision 6).
#
# Bare `-e VARNAME` (no `=value`) forwards this shell's already-exported value (or nothing, if
# unset) into the container — safe either way.

echo ""
echo "Step 4c: Bootstrap-provisioning configured backends..."
BOOTSTRAP_JSON=$(docker run --rm \
    -e REGISTRY_PROTOCOL -e REGISTRY_CONFIG_JSON \
    -e STORAGE_PROTOCOL -e STORAGE_CONFIG_JSON \
    -e CLUSTER_TYPE -e CLUSTER_CONFIG_JSON \
    nagelfluh-backend:prod python backend/bin/nagelfluh-bootstrap-provision)

# eval runs directly in this shell (not inside a subshell) so the `export` statements it emits
# persist here, ready for Step 5's BACKEND_SECRET_ARGS assembly below. Do NOT wrap this eval in a
# command substitution — that would run it in a subshell and silently discard the exports.
eval "$(python3 -c '
import json, sys, shlex

data = json.loads(sys.argv[1])
axis_map = {
    "registry": ("REGISTRY_PROTOCOL", "REGISTRY_CONFIG_JSON"),
    "storage": ("STORAGE_PROTOCOL", "STORAGE_CONFIG_JSON"),
    "cluster": ("CLUSTER_TYPE", "CLUSTER_CONFIG_JSON"),
}
lines = []
for axis, (protocol_var, config_var) in axis_map.items():
    if axis not in data:
        continue
    entry = data[axis]
    protocol = entry["protocol"]
    config_json = json.dumps(entry["config"])
    lines.append(f"export {protocol_var}={shlex.quote(protocol)}")
    lines.append(f"export {config_var}={shlex.quote(config_json)}")
print("\n".join(lines))
' "${BOOTSTRAP_JSON}")"

BOOTSTRAPPED_AXES=$(python3 -c '
import json, sys

data = json.loads(sys.argv[1])
print(",".join(axis for axis in ("registry", "storage", "cluster") if axis in data))
' "${BOOTSTRAP_JSON}")

if [ -n "${BOOTSTRAPPED_AXES}" ]; then
    echo "  Bootstrap-provisioned axes: ${BOOTSTRAPPED_AXES} (enriched config will be folded into nagelfluh-backend-secret)"
else
    echo "  No axes bootstrap-provisioned (no <AXIS>_PROTOCOL/<AXIS>_CONFIG_JSON set in config.env)"
fi

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

# Preserve JWT key across runs AND across minikube delete+recreate.
# Priority: config.env JWT_SECRET_KEY > persistent file on host > generate new.
# The persistent file lives in NAGELFLUH_DATA_DIR (default ~/.nagelfluh/data),
# which is bind-mounted from the host so it survives minikube delete.
NAGELFLUH_DATA_DIR="${NAGELFLUH_DATA_DIR:-$HOME/.nagelfluh/data}"
JWT_SECRET_FILE="${NAGELFLUH_DATA_DIR}/jwt_secret_key"

if [ -n "${JWT_SECRET_KEY:-}" ]; then
    # Explicitly set in config.env — use it and keep the file in sync
    JWT_SECRET="${JWT_SECRET_KEY}"
    mkdir -p "${NAGELFLUH_DATA_DIR}"
    echo -n "${JWT_SECRET}" > "${JWT_SECRET_FILE}"
    echo "  JWT key: using JWT_SECRET_KEY from config.env"
elif [ -f "${JWT_SECRET_FILE}" ]; then
    # Persisted from a previous run — reuse it so existing tokens stay valid
    JWT_SECRET=$(cat "${JWT_SECRET_FILE}")
    echo "  JWT key: reusing persisted key from ${JWT_SECRET_FILE}"
else
    # First-ever run — generate and persist so future minikube recreates reuse it
    JWT_SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
    mkdir -p "${NAGELFLUH_DATA_DIR}"
    echo -n "${JWT_SECRET}" > "${JWT_SECRET_FILE}"
    chmod 600 "${JWT_SECRET_FILE}"
    echo "  JWT key: generated new key, saved to ${JWT_SECRET_FILE}"
fi

MINIO_ROOT_USER="${MINIO_ROOT_USER:-minioadmin}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-minioadmin}"
REGISTRY_USER="${REGISTRY_USER:-nagelfluh}"
REGISTRY_PASSWORD="${REGISTRY_PASSWORD:-nagelfluh}"
REGISTRY_AUTH=$(printf '%s:%s' "${REGISTRY_USER}" "${REGISTRY_PASSWORD}" | base64 -w0)

BACKEND_SECRET_ARGS=(
    --from-literal=JWT_SECRET_KEY="${JWT_SECRET}"
    --from-literal=MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD}"
    --from-literal="MC_HOST_minio=https://${MINIO_ROOT_USER}:${MINIO_ROOT_PASSWORD}@minio.minio.svc.cluster.local:9000"
    --from-literal=REGISTRY_AUTH="${REGISTRY_AUTH}"
)
# ADMIN_USERNAME/ADMIN_PASSWORD (from config.env) bootstrap the app's site-admin user the
# FIRST TIME migrations run against an empty DB (see backend/alembic/versions/e2f3a4b5c6d7).
# They must reach the backend/migrate pods via this secret's envFrom, separate from
# ADMIN_USER/ADMIN_PASSWORD below which only control the pgAdmin/Headlamp login.
# Fold in the enriched <AXIS>_PROTOCOL/<AXIS>_CONFIG_JSON from Step 4c's bootstrap-provision run,
# for whichever axes were actually configured. These go into the Secret (not the ConfigMap,
# Step 5c below) even though today's core protocols (docker-v2/minio/kubeconfig) carry no secret
# material — *_CONFIG_JSON may carry credentials for a plugin-provided protocol (e.g. a future GCP
# service-account key), so it's treated as secret material uniformly, not special-cased per
# protocol. Only axes present in BOOTSTRAP_JSON get added — an axis that wasn't configured in
# config.env leaves the secret's contents unchanged from today.
if [ -n "${REGISTRY_PROTOCOL:-}" ] && [ -n "${REGISTRY_CONFIG_JSON:-}" ]; then
    BACKEND_SECRET_ARGS+=(--from-literal=REGISTRY_PROTOCOL="${REGISTRY_PROTOCOL}")
    BACKEND_SECRET_ARGS+=(--from-literal=REGISTRY_CONFIG_JSON="${REGISTRY_CONFIG_JSON}")
fi
if [ -n "${STORAGE_PROTOCOL:-}" ] && [ -n "${STORAGE_CONFIG_JSON:-}" ]; then
    BACKEND_SECRET_ARGS+=(--from-literal=STORAGE_PROTOCOL="${STORAGE_PROTOCOL}")
    BACKEND_SECRET_ARGS+=(--from-literal=STORAGE_CONFIG_JSON="${STORAGE_CONFIG_JSON}")
fi
if [ -n "${CLUSTER_TYPE:-}" ] && [ -n "${CLUSTER_CONFIG_JSON:-}" ]; then
    BACKEND_SECRET_ARGS+=(--from-literal=CLUSTER_TYPE="${CLUSTER_TYPE}")
    BACKEND_SECRET_ARGS+=(--from-literal=CLUSTER_CONFIG_JSON="${CLUSTER_CONFIG_JSON}")
fi

if [ -n "${ADMIN_USERNAME:-}" ]; then
    BACKEND_SECRET_ARGS+=(--from-literal=ADMIN_USERNAME="${ADMIN_USERNAME}")
    BACKEND_SECRET_ARGS+=(--from-literal=ADMIN_PASSWORD="${ADMIN_PASSWORD:-}")
fi

kubectl create secret generic nagelfluh-backend-secret \
    "${BACKEND_SECRET_ARGS[@]}" \
    -n nagelfluh \
    --dry-run=client -o yaml | kubectl apply -f -
echo "  nagelfluh-backend-secret applied"

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
# BACKEND_BASE_URL must use HOST_IP:30080 because that is the address
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
  STORAGE_ENDPOINT: "https://minio.minio.svc.cluster.local:9000"
  STORAGE_BUCKET_PREFIX: "nagelfluh-project-"
  STORAGE_TLS_SKIP_VERIFY: "${STORAGE_TLS_SKIP_VERIFY:-true}"
  MINIO_ROOT_USER: "${MINIO_ROOT_USER}"
  BACKEND_BASE_URL: "${BACKEND_BASE_URL}"
  REGISTRY_URL: "${REGISTRY_PUBLIC_HOST}:30500"
  REGISTRY_PUBLIC_HOST: "${REGISTRY_PUBLIC_HOST}"
  ACCESS_TOKEN_EXPIRE_DAYS: "30"
  PROCESS_COST: "0.10"
  INITIAL_USER_BALANCE: "100.0"
EOF

# ── Step 6: Apply all Kubernetes manifests ────────────────────────────────────
# k8s/00-namespaces.yaml sorts first, ensuring namespaces exist before other
# resources are created. The backend image already exists (built in Step 4b); the frontend pod
# will stay pending until its image is built in Step 8 below.

echo ""
echo "Step 7: Applying Kubernetes manifests..."
kubectl apply -R -f "${PROJECT_ROOT}/k8s/"

echo ""
echo "  Waiting for PostgreSQL to be ready..."
kubectl rollout status statefulset/postgres -n nagelfluh --timeout=120s
kubectl wait --for=condition=ready pod -l app=postgres -n nagelfluh --timeout=120s

# ── Step 7b: Copy Headlamp SA token to nagelfluh namespace for nginx ──────────
# The headlamp SA token lives in the headlamp namespace; nginx runs in nagelfluh.
# We copy the decoded token into a separate secret so nginx can mount and inject
# it as a request header, enabling automatic Headlamp authentication.

echo ""
echo "Step 7b: Copying Headlamp token to nagelfluh namespace..."
for i in $(seq 1 30); do
    HEADLAMP_TOKEN=$(kubectl get secret headlamp-static-token -n headlamp \
        -o jsonpath='{.data.token}' 2>/dev/null | base64 -d 2>/dev/null || true)
    if [ -n "${HEADLAMP_TOKEN}" ]; then
        echo "  Headlamp token obtained."
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo "  WARNING: Could not obtain headlamp token after 30 attempts; skipping auto-auth."
        HEADLAMP_TOKEN=""
        break
    fi
    echo "  Waiting for headlamp SA token to be populated... ($i/30)"
    sleep 2
done

if [ -n "${HEADLAMP_TOKEN}" ]; then
    kubectl create secret generic headlamp-nginx-token \
        --from-literal=token="${HEADLAMP_TOKEN}" \
        -n nagelfluh \
        --dry-run=client -o yaml | kubectl apply -f -
    echo "  headlamp-nginx-token secret created/updated in nagelfluh namespace."
fi

# ── Step 8: Build frontend Docker image ───────────────────────────────────────
# The backend image was already built in Step 4b, ahead of secrets, so
# nagelfluh-bootstrap-provision could run against it. `minikube docker-env` is already active
# (set in Step 4b) so this build also lands in Minikube's Docker daemon.

echo ""
echo "Step 8: Building frontend Docker image (REACT_APP_API_URL=/api via nginx proxy)..."
docker build \
    -t nagelfluh-frontend:prod \
    -f "${PROJECT_ROOT}/frontend/Dockerfile" \
    "${PROJECT_ROOT}/frontend"

# ── Step 9: Run migrations inside the cluster ─────────────────────────────────
# Runs alembic as a kubectl Job using nagelfluh-backend:prod (Python 3.11)
# so all dependencies (libaarhusxyz, msgpack, etc.) are available.
#
# envFrom pulls in nagelfluh-backend-secret/nagelfluh-backend-config (the same config the backend
# Deployment sees), closing the pre-existing gap noted in docs/plans/registry-backend-hooks.md's
# Background section — previously this Job only ever saw the literal DATABASE_URL below, so e.g.
# an operator-customized MINIO_ROOT_USER/PASSWORD (or a bootstrap-provisioned
# <AXIS>_PROTOCOL/<AXIS>_CONFIG_JSON pair from Step 4c/5) was invisible to seed migrations running
# in this Job. `env:` entries take precedence over `envFrom` on key collision; there's no
# collision here since DATABASE_URL isn't in either the secret or the configmap.

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
        command: ["python", "backend/bin/nagelfluh-migrate"]
        envFrom:
        - secretRef:
            name: nagelfluh-backend-secret
        - configMapRef:
            name: nagelfluh-backend-config
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

# The frontend NodePort (30080) is published directly on the host by minikube's docker
# driver (dev/setup-minikube.sh) — no socat forwarder needed.

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
echo "  MinIO Console: https://localhost:9001   (${MINIO_ROOT_USER} / ${MINIO_ROOT_PASSWORD}, self-signed cert)"
echo ""
echo "  Admin credentials are in secret nagelfluh-admin-secret (nagelfluh namespace)."
echo "  To rotate: kubectl delete secret nagelfluh-admin-secret -n nagelfluh, then re-run."
echo ""
echo "Useful commands:"
echo "  kubectl logs -f deployment/backend  -n nagelfluh"
echo "  kubectl logs -f deployment/frontend -n nagelfluh"
echo "  kubectl get pods -n nagelfluh"
echo ""
echo "All traffic goes through nginx on the frontend NodePort (30080)."
echo "The backend is only reachable inside the cluster."
