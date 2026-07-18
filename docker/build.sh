#!/bin/bash
set -e

# Accept optional environment name parameter (defaults to "Bootstrap")
ENV_NAME="${1:-Bootstrap}"
ENV_TAG=$(echo "$ENV_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')

# Change to project root (parent directory of docker/)
cd "$(dirname "$0")/.."

# Load DEPLOYMENT (and other settings) from config.env; command-line env vars take precedence
_ENV_DEPLOYMENT="${DEPLOYMENT:-}"
if [ -f "config.env" ]; then
    source "config.env"
fi
[ -n "$_ENV_DEPLOYMENT" ] && DEPLOYMENT="$_ENV_DEPLOYMENT"

echo "=== Building Nagelfluh Runner Image for ${ENV_NAME} Environment ==="
echo "    Docker tag: nagelfluh-runner:${ENV_TAG}"
echo ""

# Check if minikube is running
if ! minikube status &> /dev/null; then
    echo "❌ Error: Minikube is not running. Start it with:"
    echo "   ./dev/runall.sh    # dev, or ./prod/runall-minikube.sh for production-minikube"
    exit 1
fi

# Use minikube's docker daemon
echo "Configuring Docker to use minikube's daemon..."
eval $(minikube docker-env)

# minikube's internal dockerd is far newer than the host's docker CLI package (e.g. Debian's
# docker.io 20.10, API 1.41) and has dropped support for API versions below 1.44, so the host
# CLI's default negotiated version gets rejected outright ("client version 1.41 is too old").
# Forcing the version string the CLI sends works around this without requiring a host docker
# upgrade — the wire format is compatible for the basic build/tag/push operations used here.
export DOCKER_API_VERSION=1.44

# Build the image from project root with explicit Dockerfile path
echo "Building nagelfluh-runner:${ENV_TAG}..."
docker build -f docker/base-runner/Dockerfile -t nagelfluh-runner:${ENV_TAG} .

# Verify the image exists
echo ""
echo "Verifying image..."
if docker images nagelfluh-runner:${ENV_TAG} | grep -q nagelfluh-runner; then
    echo "✓ Image nagelfluh-runner:${ENV_TAG} built successfully"
else
    echo "❌ Error: Image not found after build"
    exit 1
fi

# Tag and push to the registry
echo ""
echo "Pushing to registry..."

# Registry-protocol-agnostic: resolve the active RegistryBackend and configure push auth via
# backend/bin/nagelfluh-registry-push (see docs/plans/registry-backend-hooks.md, Design decision
# 5). It prints the resolved full image reference (e.g. host:port/nagelfluh-base-runner:tag for
# docker-v2) to stdout and nothing else; docker login / credential-helper setup happens inside it,
# before it prints anything.
if [ "${DEPLOYMENT:-}" = "production-minikube" ]; then
    # nagelfluh-registry-push needs a DB connection to look up the active RegistryBackend, but
    # in production-minikube Postgres is ClusterIP-only (no host-reachable port) — the host can't
    # query it directly. The `backend` Deployment pod can (its DATABASE_URL is already wired up
    # via envFrom), so resolve protocol+config there via --resolve-only, then hand that resolved
    # JSON to a second, host-side invocation that does the docker login/push against minikube's
    # docker daemon (which in turn only the host, not the pod, has access to).
    RESOLVED_JSON=$(kubectl exec -n nagelfluh deploy/backend -- python backend/bin/nagelfluh-registry-push --resolve-only)
    FULL_IMAGE=$(env/bin/python backend/bin/nagelfluh-registry-push nagelfluh-base-runner "${ENV_TAG}" "${RESOLVED_JSON}")
else
    FULL_IMAGE=$(env/bin/python backend/bin/nagelfluh-registry-push nagelfluh-base-runner "${ENV_TAG}")
fi

echo "Registry image: ${FULL_IMAGE}"
docker tag nagelfluh-runner:${ENV_TAG} "${FULL_IMAGE}"

# Push the image
if docker push "${FULL_IMAGE}"; then
    echo "✓ Image pushed to ${FULL_IMAGE}"
else
    echo "❌ Error: Failed to push image to registry"
    echo ""
    echo "This is likely because minikube's Docker daemon doesn't trust the HTTP registry."
    echo ""
    echo "To fix this, restart minikube with insecure registry support:"
    echo "  minikube stop"
    echo "  minikube delete  # (optional, but recommended for clean state)"
    echo "  ./dev/runall.sh  # Re-run full setup — bootstrap-provision will reconfigure insecure registries"
    echo ""
    exit 1
fi

echo ""
echo "=== ✅ Build complete! ==="
echo ""
echo "The image is now available in:"
echo "  - Minikube's Docker daemon: nagelfluh-runner:${ENV_TAG}"
echo "  - Registry (used by pods, local and remote): ${FULL_IMAGE}"
echo ""

# Extract process schemas from the built image and update environment
echo "=== Updating ${ENV_NAME} Environment ==="
echo ""
echo "Extracting process schemas from image..."

# Create temporary file for the schemas
SCHEMA_FILE=$(mktemp)

# Extract process_schemas.json from the image using docker
if docker run --rm --entrypoint cat nagelfluh-runner:${ENV_TAG} /app/process_schemas.json > "$SCHEMA_FILE" 2>&1; then
    echo "✓ Extracted process schemas from image"

    # Show what we extracted
    PROCESS_COUNT=$(python3 -c "import json; print(len(json.load(open('$SCHEMA_FILE'))))" 2>/dev/null || echo "0")
    echo "  Found $PROCESS_COUNT process type(s)"

    # Update the database
    echo ""
    echo "Updating ${ENV_NAME} environment in database..."

    # FULL_IMAGE was already resolved above (backend/bin/nagelfluh-registry-push) — reused here
    # for the database/schema-extraction step instead of being reconstructed.

    if [ "${DEPLOYMENT:-}" = "production-minikube" ]; then
        # Production mode → run update as a Kubernetes Job against in-cluster PostgreSQL
        echo "  Running database update as kubernetes job..."
        kubectl delete configmap "runner-schemas-${ENV_TAG}" -n nagelfluh --ignore-not-found=true 2>/dev/null
        kubectl create configmap "runner-schemas-${ENV_TAG}" \
            --from-file=process_schemas.json="$SCHEMA_FILE" \
            -n nagelfluh
        kubectl delete job "db-update-${ENV_TAG}" -n nagelfluh --ignore-not-found=true 2>/dev/null
        kubectl apply -f - <<MANIFEST
apiVersion: batch/v1
kind: Job
metadata:
  name: db-update-${ENV_TAG}
  namespace: nagelfluh
spec:
  template:
    spec:
      containers:
      - name: update
        image: nagelfluh-backend:prod
        imagePullPolicy: Never
        command: ["python3", "/app/update_bootstrap_environment.py",
                  "/schemas/process_schemas.json", "${ENV_NAME}", "${FULL_IMAGE}"]
        env:
        - name: DATABASE_URL
          value: "postgresql://nagelfluh:nagelfluhpass@postgres.nagelfluh.svc.cluster.local:5432/nagelfluh"
        volumeMounts:
        - name: schemas
          mountPath: /schemas
      volumes:
      - name: schemas
        configMap:
          name: runner-schemas-${ENV_TAG}
      restartPolicy: Never
  backoffLimit: 0
MANIFEST
        kubectl wait --for=condition=complete "job/db-update-${ENV_TAG}" -n nagelfluh --timeout=60s
        kubectl logs "job/db-update-${ENV_TAG}" -n nagelfluh
        kubectl delete job "db-update-${ENV_TAG}" -n nagelfluh
        kubectl delete configmap "runner-schemas-${ENV_TAG}" -n nagelfluh
        echo ""
        echo "✓ ${ENV_NAME} environment updated successfully"
    elif python3 docker/update_bootstrap_environment.py "$SCHEMA_FILE" "$ENV_NAME" "$FULL_IMAGE"; then
        # No nagelfluh namespace → dev mode with local SQLite database
        echo ""
        echo "✓ ${ENV_NAME} environment updated successfully"
    else
        echo ""
        echo "✗ Failed to update ${ENV_NAME} environment"
        rm "$SCHEMA_FILE"
        exit 1
    fi
else
    echo "⚠ Could not extract process_schemas.json from image"
    echo "  (This is expected if the image doesn't have process schemas yet)"
fi

# Clean up
rm -f "$SCHEMA_FILE"

echo ""
echo "=== ✅ Setup complete! ==="
echo ""
echo "To build for a different environment, run:"
echo "  ./docker/build.sh \"Environment Name\""
echo ""
echo "For production (GCR), build and push with:"
echo "  docker build -f docker/base-runner/Dockerfile -t gcr.io/{project}/nagelfluh-runner:${ENV_TAG} ."
echo "  docker push gcr.io/{project}/nagelfluh-runner:${ENV_TAG}"
echo ""
