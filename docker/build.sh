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

# Same defaults as dev/setup-registry.sh — the registry always requires auth, even if
# config.env doesn't set these.
REGISTRY_USER="${REGISTRY_USER:-nagelfluh}"
REGISTRY_PASSWORD="${REGISTRY_PASSWORD:-nagelfluh}"

echo "=== Building Nagelfluh Runner Image for ${ENV_NAME} Environment ==="
echo "    Docker tag: nagelfluh-runner:${ENV_TAG}"
echo ""

# Check if minikube is running
if ! minikube status &> /dev/null; then
    echo "❌ Error: Minikube is not running. Start it with:"
    echo "   ./dev/setup-minikube.sh"
    exit 1
fi

# Use minikube's docker daemon
echo "Configuring Docker to use minikube's daemon..."
eval $(minikube docker-env)

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

# Always address the registry via its publicly-exposed host:port (config.env
# REGISTRY_PUBLIC_HOST), never minikube's internal IP — a remote cluster's pods pulling this
# image need the exact same address. Defaults to the host's primary LAN IP, same pattern as
# MINIKUBE_APISERVER_IPS. See docs/plans/done/remote-cluster-provisioning-and-registry.md.
REGISTRY_PUBLIC_HOST="${REGISTRY_PUBLIC_HOST:-$(hostname -I | awk '{print $1}')}"
REGISTRY_URL="${REGISTRY_PUBLIC_HOST}:30500"

echo "Registry URL: ${REGISTRY_URL}"
docker tag nagelfluh-runner:${ENV_TAG} ${REGISTRY_URL}/nagelfluh-base-runner:${ENV_TAG}

# Authenticate against the registry (see dev/setup-registry.sh / docs/plans/done/self-signed-tls-minio-registry.md)
echo "${REGISTRY_PASSWORD}" | docker login "${REGISTRY_URL}" -u "${REGISTRY_USER}" --password-stdin

# Push the image
if docker push ${REGISTRY_URL}/nagelfluh-base-runner:${ENV_TAG}; then
    echo "✓ Image pushed to ${REGISTRY_URL}/nagelfluh-base-runner:${ENV_TAG}"
else
    echo "❌ Error: Failed to push image to registry"
    echo ""
    echo "This is likely because minikube's Docker daemon doesn't trust the HTTP registry."
    echo ""
    echo "To fix this, restart minikube with insecure registry support:"
    echo "  minikube stop"
    echo "  minikube delete  # (optional, but recommended for clean state)"
    echo "  ./dev/setup-minikube.sh  # Will configure insecure registries"
    echo "  ./dev/runall.sh  # Re-run full setup"
    echo ""
    exit 1
fi

echo ""
echo "=== ✅ Build complete! ==="
echo ""
echo "The image is now available in:"
echo "  - Minikube's Docker daemon: nagelfluh-runner:${ENV_TAG}"
echo "  - Registry (used by pods, local and remote): ${REGISTRY_URL}/nagelfluh-base-runner:${ENV_TAG}"
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

    # Full image reference for the database (using NodePort IP - same as push URL)
    FULL_IMAGE="${REGISTRY_URL}/nagelfluh-base-runner:${ENV_TAG}"

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
