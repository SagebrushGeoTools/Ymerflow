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
# on the host by minikube's docker driver (see plugins/ymerflow-minikube's minikube_vm.py).
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

# ── Step 1: Base configuration ────────────────────────────────────────────────

# LAN IP added to the apiserver cert SAN so a remote kubeconfig connecting via this IP
# passes TLS verification (see plugins/ymerflow-minikube's minikube_vm.py MINIKUBE_APISERVER_IPS).
export MINIKUBE_APISERVER_IPS="${MINIKUBE_APISERVER_IPS:-$(hostname -I | awk '{print $1}')}"

# Public host:port used to address the Docker registry everywhere (push and every cluster's
# pull, including this one) — never minikube's internal IP. See
# docs/plans/done/remote-cluster-provisioning-and-registry.md.
export REGISTRY_PUBLIC_HOST="${REGISTRY_PUBLIC_HOST:-$(hostname -I | awk '{print $1}')}"

# ── Step 2: Build backend + frontend Docker images (host's own Docker daemon) ─────────────────
# Built against the HOST's own Docker daemon, not minikube's — this doesn't need Minikube to
# exist yet (a real dependency-order requirement now that Minikube itself is provisioned by Step
# 3's bootstrap-provision, not a shell script run up front). App images are never shared with a
# cluster via a local daemon anyway (Design decision 4 in docs/plans/app-deployment-hooks.md: they
# go through the registry axis, push then pull, like every other cluster) — building here instead
# of inside minikube's daemon changes nothing about how they reach the cluster.

echo ""
echo "Step 2: Building backend + frontend Docker images..."

docker build -t nagelfluh-backend:prod \
    --build-arg BACKEND_PLUGINS="${BACKEND_PLUGINS:-}" \
    -f "${PROJECT_ROOT}/backend/Dockerfile" \
    "${PROJECT_ROOT}"

docker build -t nagelfluh-frontend:prod \
    -f "${PROJECT_ROOT}/frontend/Dockerfile" \
    "${PROJECT_ROOT}/frontend"

# ── Step 3: Bootstrap-provision configured backends ───────────────────────────
# For each axis (registry/storage/cluster) where <AXIS>_PROTOCOL/<AXIS>_CONFIG_JSON is set in
# config.env (already exported above — see that file's defaults), resolve its handler and call
# bootstrap(). By default this is plugins/ymerflow-minikube's docker-v2/minio/minikube stack:
# MinikubeClusterProvider.bootstrap() starts/resizes the local Minikube VM itself (replacing the
# deleted dev/setup-minikube.sh), and MinioProtocolHandler/DockerV2ProtocolHandler.bootstrap()
# deploy MinIO/the registry into it (replacing dev/setup-minio.sh/dev/setup-registry.sh) — each is
# idempotent, so re-running this on every prod/runall-minikube.sh invocation is a fast no-op once
# already provisioned. The enriched {protocol, config} result is folded into
# nagelfluh-backend-secret below (Step 6). See docs/plans/minikube-provisioning-plugin.md and
# docs/plans/registry-backend-hooks.md (Design decision 6).
#
# Runs as `docker run --rm` against the image just built (Step 2) — no host venv needed, the only
# thing bootstrap needs beyond network access is control of the host's own Minikube/Docker, which
# these mounts + --network host provide (see Design decision 2 in
# docs/plans/minikube-provisioning-plugin.md):
#   - the host's Docker socket, so `minikube start`/`stop`/`delete` inside the container actually
#     control the host's real Minikube (its docker driver just runs `docker` commands);
#   - the host's ~/.minikube/~/.kube, so Minikube's own state and the resulting kubeconfig persist
#     on the host across bootstrap runs, and this container's `kubernetes_asyncio` calls connect
#     to it via the *local* kubeconfig (K8sClient(kubeconfig=None) falls back to
#     config.load_kube_config() once in-cluster detection fails);
#   - NAGELFLUH_DATA_DIR, so the self-signed MinIO/registry TLS certs persist across
#     `minikube delete` exactly as before;
#   - --network host, so the kubeconfig's `127.0.0.1:<port>` apiserver address (as published by
#     `docker port minikube`) is actually reachable from inside this container.
#
# ~/.minikube/~/.kube are mounted at the SAME absolute path as on the host (not /root/...), and
# HOME is set to match, for the same reason NAGELFLUH_DATA_DIR already is (see above): minikube's
# docker-machine driver bakes the absolute SSH-key path into machines/minikube/config.json at
# `minikube start` time. If that path were /root/.minikube/... (this container's real $HOME), the
# host's own `minikube`/`kubectl` — invoked directly, right after this step, e.g. by
# dev/prepull-images.sh — would try to open the HOST's actual /root (unrelated, root-owned,
# permission denied) instead of the mounted profile.
#
# The container still runs as root (needed for the Docker-socket mount above), so anything it
# writes under that path lands root-owned on the HOST regardless of which path string is used —
# breaking this user's own `minikube`/`kubectl` afterward via a plain ownership mismatch on top of
# the path one above. HOST_UID/HOST_GID let minikube_vm.py's ensure_minikube_running() chown
# ~/.minikube / ~/.kube back to this shell's invoking user once it's done (see
# plugins/ymerflow-minikube/minikube_plugin/minikube_vm.py).
#
# Bare `-e VARNAME` (no `=value`) forwards this shell's already-exported value (or nothing, if
# unset) into the container — safe either way.

echo ""
echo "Step 3: Bootstrap-provisioning configured backends..."
NAGELFLUH_DATA_DIR="${NAGELFLUH_DATA_DIR:-$HOME/.nagelfluh/data}"
mkdir -p "${NAGELFLUH_DATA_DIR}" "$HOME/.minikube" "$HOME/.kube"

BOOTSTRAP_JSON=$(docker run --rm \
    --network host \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$HOME/.minikube:$HOME/.minikube" \
    -v "$HOME/.kube:$HOME/.kube" \
    -v "${NAGELFLUH_DATA_DIR}:${NAGELFLUH_DATA_DIR}" \
    -e HOME="$HOME" \
    -e NAGELFLUH_DATA_DIR="${NAGELFLUH_DATA_DIR}" \
    -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
    -e MINIKUBE_CPUS -e MINIKUBE_MEMORY -e MINIKUBE_DISK_SIZE -e MINIKUBE_EXPOSE_PORTS \
    -e MINIKUBE_LISTEN_ADDRESS -e MINIKUBE_APISERVER_IPS -e MINIKUBE_ALLOW_RECREATE \
    -e MINIO_ROOT_USER -e MINIO_ROOT_PASSWORD \
    -e REGISTRY_USER -e REGISTRY_PASSWORD -e REGISTRY_PUBLIC_HOST \
    -e REGISTRY_PROTOCOL -e REGISTRY_CONFIG_JSON \
    -e STORAGE_PROTOCOL -e STORAGE_CONFIG_JSON \
    -e CLUSTER_TYPE -e CLUSTER_CONFIG_JSON \
    nagelfluh-backend:prod python backend/bin/nagelfluh-bootstrap-provision)

# eval runs directly in this shell (not inside a subshell) so the `export` statements it emits
# persist here, ready for Step 7's BACKEND_SECRET_ARGS assembly below. Do NOT wrap this eval in a
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

# ── Step 4: Pre-pull images + namespaces ──────────────────────────────────────
# Minikube now exists (Step 3 brought it up, if it wasn't already) — safe to talk to it.

echo ""
echo "Step 4: Pre-pulling images into minikube and creating namespaces..."
"${PROJECT_ROOT}/dev/prepull-images.sh"
kubectl apply -f "${PROJECT_ROOT}/k8s/00-namespaces.yaml"

# ── Step 5: Push backend + frontend images to the registry ────────────────────
# Design decision 4 in docs/plans/app-deployment-hooks.md: app images go through the registry
# axis, NOT imagePullPolicy:Never against a shared local daemon. The in-cluster nagelfluh-deploy-app
# Job (Step 12) and the Deployments it applies pull these from the registry with a pull secret,
# exactly like process-runner pods already do — so the app can be hosted on a cluster that does not
# share a Docker daemon with this build host. The registry now exists (Step 3's bootstrap-provision
# deployed it), so this can push.
#
# Addressed directly from REGISTRY_PUBLIC_HOST:30500 + REGISTRY_USER/REGISTRY_PASSWORD rather than
# via backend/bin/nagelfluh-registry-push, because that entry point resolves the active
# RegistryBackend row from the database, which isn't reachable host-side here (Postgres runs
# in-cluster and hasn't even been migrated/seeded yet at this point). The refs built here
# (host:port/repo:tag) are byte-for-byte what docker-v2's RegistryProtocolHandler.image_url()
# reconstructs inside nagelfluh-deploy-app from the same REGISTRY_PUBLIC_HOST — they must match, or
# the deploy Job would deploy pods pointing at a different ref than what was pushed.
#
# Pushed via a throwaway `crane` (google/go-containerregistry) container rather than the host's own
# `docker login`/`docker push`: crane is daemonless/rootless and takes a per-invocation --insecure
# flag to accept the registry's self-signed cert, whereas dockerd's TLS trust is system-wide config
# under /etc/docker — trusting a freshly-generated local dev cert there would need `sudo` plus
# either an `insecure-registries` daemon restart (disruptive: restarts every container on the host,
# including Minikube's own, since it runs on the docker driver) or a manual CA drop into
# /etc/docker/certs.d/<host:port>/ca.crt. crane sidesteps all of that. Auth is a throwaway
# ~/.docker/config.json (basic-auth entry, matching REGISTRY_AUTH's own encoding in Step 6 below)
# mounted read-only into the container — cleaned up via the EXIT trap, never touches the host's own
# Docker config.

REGISTRY_USER="${REGISTRY_USER:-nagelfluh}"
REGISTRY_PASSWORD="${REGISTRY_PASSWORD:-nagelfluh}"
REGISTRY_ADDR="${REGISTRY_PUBLIC_HOST}:30500"
BACKEND_IMAGE="${REGISTRY_ADDR}/nagelfluh-backend:prod"
FRONTEND_IMAGE="${REGISTRY_ADDR}/nagelfluh-frontend:prod"
CRANE_IMAGE="gcr.io/go-containerregistry/crane:debug"

echo ""
echo "Step 5: Pushing backend + frontend images to ${REGISTRY_ADDR}..."

CRANE_WORKDIR="$(mktemp -d)"
trap 'rm -rf "${CRANE_WORKDIR}"' EXIT

AUTH_B64="$(printf '%s:%s' "${REGISTRY_USER}" "${REGISTRY_PASSWORD}" | base64 -w0)"
cat > "${CRANE_WORKDIR}/config.json" <<EOF
{"auths":{"${REGISTRY_ADDR}":{"auth":"${AUTH_B64}"}}}
EOF

push_image() {
    local local_tag="$1" remote_ref="$2" tar_name="$3"
    docker save "${local_tag}" -o "${CRANE_WORKDIR}/${tar_name}"
    docker run --rm --network host \
        -v "${CRANE_WORKDIR}:/work:ro" \
        -e DOCKER_CONFIG=/work \
        --entrypoint crane "${CRANE_IMAGE}" \
        push --insecure "/work/${tar_name}" "${remote_ref}"
    rm -f "${CRANE_WORKDIR}/${tar_name}"
}

push_image nagelfluh-backend:prod "${BACKEND_IMAGE}" backend.tar
push_image nagelfluh-frontend:prod "${FRONTEND_IMAGE}" frontend.tar
echo "  Pushed ${BACKEND_IMAGE}"
echo "  Pushed ${FRONTEND_IMAGE}"

# ── Step 6: nagelfluh-backend-config / nagelfluh-backend-secret ────────────────
# These carry the app's workload-level config/secrets. They are created here as the INPUT the
# in-cluster nagelfluh-deploy-app Job (Step 12) reads via envFrom; nagelfluh-deploy-app hands their
# contents to backend.services.app_deployment.apply_app_workloads(), which then re-applies
# (create-or-patch) the canonical objects — so this Step is a bootstrap seed, and apply_app_workloads
# is the authority for their final state (adding the resolved JWT_SECRET_KEY, per Design decision 5).
#
# JWT persistence: NO host-file (NAGELFLUH_DATA_DIR/jwt_secret_key) mechanism anymore. If the
# operator set JWT_SECRET_KEY in config.env it is passed through here and wins; otherwise it is
# deliberately LEFT OUT, and apply_app_workloads generates-or-reuses it against the K8s API
# (check-before-generate: reuse the existing nagelfluh-backend-secret's value across a redeploy /
# minikube recreate so existing tokens stay valid, generate a fresh one only on a first-ever
# deploy). This works identically for a cluster that shares no filesystem with this host.

echo ""
echo "Step 6: Creating secrets and ConfigMap..."

kubectl create secret generic nagelfluh-postgres-secret \
    --from-literal=postgres-password=nagelfluhpass \
    -n nagelfluh \
    --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret generic pgadmin-pgpass \
    --from-literal=pgpass="postgres.nagelfluh.svc.cluster.local:5432:nagelfluh:nagelfluh:nagelfluhpass" \
    -n nagelfluh \
    --dry-run=client -o yaml | kubectl apply -f -

MINIO_ROOT_USER="${MINIO_ROOT_USER:-minioadmin}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-minioadmin}"
REGISTRY_AUTH=$(printf '%s:%s' "${REGISTRY_USER}" "${REGISTRY_PASSWORD}" | base64 -w0)

# DATABASE_URL is fully resolved here (Postgres password inlined) and placed in the SECRET so
# apply_app_workloads' migration Job + the backend Deployment receive it purely via envFrom — no
# per-manifest secretKeyRef/$(VAR) substitution needed anymore (that substitution lived in the
# old static k8s/backend/deployment.yaml). It uses the asyncpg driver for the backend app; the
# migration Job's alembic step strips "+asyncpg" itself (see backend/alembic/env.py).
DATABASE_URL="postgresql+asyncpg://nagelfluh:nagelfluhpass@postgres.nagelfluh.svc.cluster.local:5432/nagelfluh"

BACKEND_SECRET_ARGS=(
    --from-literal=DATABASE_URL="${DATABASE_URL}"
    --from-literal=MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD}"
    --from-literal="MC_HOST_minio=https://${MINIO_ROOT_USER}:${MINIO_ROOT_PASSWORD}@minio.minio.svc.cluster.local:9000"
    --from-literal=REGISTRY_AUTH="${REGISTRY_AUTH}"
)

# JWT_SECRET_KEY only when explicitly set in config.env (see the JWT note above).
if [ -n "${JWT_SECRET_KEY:-}" ]; then
    BACKEND_SECRET_ARGS+=(--from-literal=JWT_SECRET_KEY="${JWT_SECRET_KEY}")
    echo "  JWT key: using JWT_SECRET_KEY from config.env"
else
    echo "  JWT key: none set in config.env — apply_app_workloads will generate-or-reuse it via the K8s API"
fi

# Fold in the enriched <AXIS>_PROTOCOL/<AXIS>_CONFIG_JSON from Step 3's bootstrap-provision run,
# for whichever axes were actually configured. These go into the Secret even though today's core
# protocols carry no secret material of their own — *_CONFIG_JSON may carry credentials for a
# plugin-provided protocol, so it's treated as secret material uniformly.
if [ -n "${REGISTRY_PROTOCOL:-}" ] && [ -n "${REGISTRY_CONFIG_JSON:-}" ]; then
    BACKEND_SECRET_ARGS+=(--from-literal=REGISTRY_PROTOCOL="${REGISTRY_PROTOCOL}")
    BACKEND_SECRET_ARGS+=(--from-literal=REGISTRY_CONFIG_JSON="${REGISTRY_CONFIG_JSON}")
fi
if [ -n "${STORAGE_PROTOCOL:-}" ] && [ -n "${STORAGE_CONFIG_JSON:-}" ]; then
    BACKEND_SECRET_ARGS+=(--from-literal=STORAGE_CONFIG_JSON="${STORAGE_CONFIG_JSON}")
fi
if [ -n "${CLUSTER_TYPE:-}" ] && [ -n "${CLUSTER_CONFIG_JSON:-}" ]; then
    BACKEND_SECRET_ARGS+=(--from-literal=CLUSTER_TYPE="${CLUSTER_TYPE}")
    BACKEND_SECRET_ARGS+=(--from-literal=CLUSTER_CONFIG_JSON="${CLUSTER_CONFIG_JSON}")
fi

# ADMIN_USERNAME/ADMIN_PASSWORD (from config.env) bootstrap the app's site-admin user the FIRST
# TIME migrations run against an empty DB (see backend/alembic/versions/e2f3a4b5c6d7). They must
# reach the migration Job via this secret's envFrom, separate from ADMIN_USER/ADMIN_PASSWORD below
# which only control the pgAdmin/Headlamp login.
if [ -n "${ADMIN_USERNAME:-}" ]; then
    BACKEND_SECRET_ARGS+=(--from-literal=ADMIN_USERNAME="${ADMIN_USERNAME}")
    BACKEND_SECRET_ARGS+=(--from-literal=ADMIN_PASSWORD="${ADMIN_PASSWORD:-}")
fi

kubectl create secret generic nagelfluh-backend-secret \
    "${BACKEND_SECRET_ARGS[@]}" \
    -n nagelfluh \
    --dry-run=client -o yaml | kubectl apply -f -
echo "  nagelfluh-backend-secret applied"

# BACKEND_BASE_URL must use the public host:port because that is the address clients' browsers
# follow when fetching dataset URLs. SERVER_URL/APP_DOMAIN/FRONTEND_NODE_PORT are consumed by the
# provider's expose_app() (nagelfluh-deploy-app threads them through app_config).
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
  REGISTRY_URL: "${REGISTRY_ADDR}"
  REGISTRY_PUBLIC_HOST: "${REGISTRY_PUBLIC_HOST}"
  ACCESS_TOKEN_EXPIRE_DAYS: "30"
  PROCESS_COST: "0.10"
  INITIAL_USER_BALANCE: "100.0"
  SERVER_URL: "${SERVER_URL}"
  APP_DOMAIN: "${APP_DOMAIN:-}"
EOF
echo "  nagelfluh-backend-config applied"

# ── Step 6b: Admin credentials secret ────────────────────────────────────────
# ADMIN_USER and ADMIN_PASSWORD are read from config.env (defaults: admin/password).
# nagelfluh-admin-secret is idempotent: skip if it already exists so a running deployment's
# credentials are never silently rotated.

ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-password}"

echo ""
echo "Step 6b: Creating admin credentials secret..."
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

# ── Step 6c: App image-pull Secret ────────────────────────────────────────────
# The in-cluster nagelfluh-deploy-app Job pulls nagelfluh-backend from the registry (Step 5), so
# its pod needs a pull credential BEFORE it starts (a Secret it creates itself would be too late
# for its own image). Same-named as app_deployment.IMAGE_PULL_SECRET_NAME so apply_app_workloads
# just re-applies (patches) it for the backend/frontend Deployments — one pull Secret, created here
# for the deploy Job and re-owned by apply_app_workloads for the workloads it applies.

echo ""
echo "Step 6c: Creating app image-pull secret + applying app-deploy RBAC..."
kubectl create secret docker-registry nagelfluh-app-pull \
    --docker-server="${REGISTRY_ADDR}" \
    --docker-username="${REGISTRY_USER}" \
    --docker-password="${REGISTRY_PASSWORD}" \
    -n nagelfluh \
    --dry-run=client -o yaml | kubectl apply -f -

kubectl apply -f "${PROJECT_ROOT}/k8s/rbac/app-deploy-rbac.yaml"

# ── Step 7: Apply base Kubernetes manifests ───────────────────────────────────
# Everything EXCEPT the app's own backend/frontend Deployments + the frontend NodePort Service,
# which nagelfluh-deploy-app (Step 12) now owns. Postgres, the backend ExternalName Service in the
# nagelfluh-jobs namespace, backend-jobs RBAC, pgAdmin and Headlamp are all still plain manifests.
# k8s/storage/ now holds ONLY the Postgres PV/PVC — MinIO's moved into
# plugins/ymerflow-minikube's own MinioProtocolHandler.bootstrap() (Step 3), see
# docs/plans/minikube-provisioning-plugin.md.

echo ""
echo "Step 7: Applying base Kubernetes manifests..."
kubectl apply -R \
    -f "${PROJECT_ROOT}/k8s/00-namespaces.yaml" \
    -f "${PROJECT_ROOT}/k8s/postgres" \
    -f "${PROJECT_ROOT}/k8s/storage" \
    -f "${PROJECT_ROOT}/k8s/backend/service.yaml" \
    -f "${PROJECT_ROOT}/k8s/rbac/backend-jobs-rbac.yaml" \
    -f "${PROJECT_ROOT}/k8s/pgadmin" \
    -f "${PROJECT_ROOT}/k8s/headlamp"

echo ""
echo "  Waiting for PostgreSQL to be ready..."
kubectl rollout status statefulset/postgres -n nagelfluh --timeout=120s
kubectl wait --for=condition=ready pod -l app=postgres -n nagelfluh --timeout=120s

# ── Step 8: Copy Headlamp SA token to nagelfluh namespace for nginx ───────────
# The headlamp SA token lives in the headlamp namespace; nginx (in the frontend pod) runs in
# nagelfluh. We copy the decoded token into a separate secret so nginx can mount and inject it as
# a request header, enabling automatic Headlamp authentication. Done BEFORE nagelfluh-deploy-app so
# the frontend pod it creates finds the (optional) headlamp-nginx-token secret already present.

echo ""
echo "Step 8: Copying Headlamp token to nagelfluh namespace..."
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

# ── Step 9: Deploy the app via nagelfluh-deploy-app (dogfoods deploy_app/expose_app) ──────────
# This replaces three things the old script did imperatively: (1) the hardcoded-image alembic
# migration Job, (2) the static k8s/backend + k8s/frontend Deployments (imagePullPolicy:Never),
# and (3) the hardcoded frontend NodePort Service. It runs as an in-cluster Job so
# same-as-backend's K8sClient(kubeconfig=None) auto-detects in-cluster config; it reads config from
# the nagelfluh-backend-config/secret created above via envFrom, resolves the default Cluster's
# provider, and calls deploy_app() (→ apply_app_workloads: ConfigMap/Secret/migration Job/backend+
# frontend Deployments + backend Service) then expose_app() (→ frontend NodePort). See
# docs/plans/app-deployment-hooks.md Phase 5.

echo ""
echo "Step 9: Deploying the application (nagelfluh-deploy-app Job)..."
kubectl delete job nagelfluh-deploy-app -n nagelfluh --ignore-not-found=true 2>/dev/null
kubectl apply -f - <<MANIFEST
apiVersion: batch/v1
kind: Job
metadata:
  name: nagelfluh-deploy-app
  namespace: nagelfluh
spec:
  template:
    spec:
      serviceAccountName: nagelfluh-app-deployer
      imagePullSecrets:
      - name: nagelfluh-app-pull
      containers:
      - name: deploy
        image: ${BACKEND_IMAGE}
        command: ["python", "backend/bin/nagelfluh-deploy-app"]
        envFrom:
        - configMapRef:
            name: nagelfluh-backend-config
        - secretRef:
            name: nagelfluh-backend-secret
      restartPolicy: Never
  backoffLimit: 0
MANIFEST

# apply_app_workloads runs the DB migration Job to completion inside this Job, so allow generous
# time (migrations + Kueue-independent workload apply). Poll for Complete/Failed directly instead
# of `kubectl wait --for=condition=complete`, which does not wake up early on a Failed condition
# and would otherwise report a fast crash only after the full timeout. On failure, dump the deploy
# Job's logs before exiting so the migration/apply error is visible.
deploy_app_deadline=$((SECONDS + 420))
while true; do
    complete=$(kubectl get job/nagelfluh-deploy-app -n nagelfluh \
        -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}' 2>/dev/null)
    failed=$(kubectl get job/nagelfluh-deploy-app -n nagelfluh \
        -o jsonpath='{.status.conditions[?(@.type=="Failed")].status}' 2>/dev/null)
    [ "$complete" = "True" ] && break
    if [ "$failed" = "True" ]; then
        echo "  nagelfluh-deploy-app Job failed — logs follow:"
        kubectl logs job/nagelfluh-deploy-app -n nagelfluh || true
        exit 1
    fi
    if [ "$SECONDS" -ge "$deploy_app_deadline" ]; then
        echo "  nagelfluh-deploy-app Job did not complete — logs follow:"
        kubectl logs job/nagelfluh-deploy-app -n nagelfluh || true
        exit 1
    fi
    sleep 2
done
kubectl logs job/nagelfluh-deploy-app -n nagelfluh
kubectl delete job nagelfluh-deploy-app -n nagelfluh

echo ""
echo "  Waiting for app Deployments to be ready..."
kubectl rollout status deployment/backend -n nagelfluh --timeout=180s
kubectl rollout status deployment/frontend -n nagelfluh --timeout=60s

# ── Step 10: Build runner image and update bootstrap environment ──────────────
# build.sh detects the nagelfluh namespace and runs update_bootstrap_environment as a kubectl Job,
# reaching PostgreSQL via in-cluster DNS. Minikube exists by now (Step 3), so build.sh's own
# `eval $(minikube docker-env)` (unrelated to this plan — it builds the process-runner image, not
# app infra) works exactly as before.

echo ""
echo "Step 10: Building process runner image and updating bootstrap environment..."
DEPLOYMENT=production-minikube "${PROJECT_ROOT}/docker/build.sh"

# The frontend NodePort (30080) is published directly on the host by minikube's docker driver
# (plugins/ymerflow-minikube's minikube_vm.py) — no socat forwarder needed.

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
