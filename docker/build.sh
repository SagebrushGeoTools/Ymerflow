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
echo "    Repository: nagelfluh-base-runner:${ENV_TAG}"
echo ""

# Registry-protocol-agnostic build+push: `docker build` runs against the HOST's own Docker
# daemon — never `minikube docker-env` or any other cluster-provider daemon (see
# docs/plans/generic-deployment-orchestration.md, Design decision 2) — then the result is pushed
# through whatever RegistryProtocolHandler the active RegistryBackend resolves to via
# backend/bin/nagelfluh-build-and-push. It prints only the resolved full image reference to
# stdout; the build log and all diagnostics go to stderr.
echo "Building and pushing nagelfluh-base-runner:${ENV_TAG}..."

if [ "${DEPLOYMENT:-}" = "production" ]; then
    # nagelfluh-build-and-push needs a DB connection to look up the active RegistryBackend, but
    # in production mode (all services in-cluster) Postgres is ClusterIP-only (no host-reachable
    # port) — the host can't query it directly. The `backend` Deployment pod can (its DATABASE_URL
    # is already wired up via envFrom), so resolve protocol+config there via --resolve-only, then
    # hand that resolved JSON to a host-side invocation that builds against the host's own Docker
    # daemon (which only the host, not the pod, has access to) and pushes.
    RESOLVED_JSON=$(kubectl exec -n nagelfluh deploy/backend -- python backend/bin/nagelfluh-build-and-push --resolve-only)
    FULL_IMAGE=$(NAGELFLUH_RESOLVED_REGISTRY_JSON="${RESOLVED_JSON}" env/bin/python backend/bin/nagelfluh-build-and-push \
        docker/base-runner/Dockerfile . nagelfluh-base-runner "${ENV_TAG}")
else
    FULL_IMAGE=$(env/bin/python backend/bin/nagelfluh-build-and-push \
        docker/base-runner/Dockerfile . nagelfluh-base-runner "${ENV_TAG}")
fi

echo "✓ Image nagelfluh-base-runner:${ENV_TAG} built and pushed to: ${FULL_IMAGE}"
echo ""

# Extract process schemas from the built image and update environment
echo "=== Updating ${ENV_NAME} Environment ==="
echo ""
echo "Extracting process schemas from image..."

# Create temporary file for the schemas
SCHEMA_FILE=$(mktemp)

# Extract process_schemas.json from the image using docker (local build tag, still present in
# the host's own Docker daemon from the build above)
if docker run --rm --entrypoint cat "nagelfluh-base-runner:${ENV_TAG}" /app/process_schemas.json > "$SCHEMA_FILE" 2>&1; then
    echo "✓ Extracted process schemas from image"

    # Show what we extracted
    PROCESS_COUNT=$(python3 -c "import json; print(len(json.load(open('$SCHEMA_FILE'))))" 2>/dev/null || echo "0")
    echo "  Found $PROCESS_COUNT process type(s)"

    # Update the database
    echo ""
    echo "Updating ${ENV_NAME} environment in database..."

    # FULL_IMAGE was already resolved above (backend/bin/nagelfluh-build-and-push) — reused here
    # for the database/schema-extraction step instead of being reconstructed.

    if [ "${DEPLOYMENT:-}" = "production" ]; then
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
