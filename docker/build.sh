#!/bin/bash
set -e

# Change to project root (parent directory of docker/)
cd "$(dirname "$0")/.."

echo "=== Building Nagelfluh Runner Image ==="
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
echo "Building nagelfluh-runner:latest..."
docker build -f docker/base-runner/Dockerfile -t nagelfluh-runner:latest .

# Verify the image exists
echo ""
echo "Verifying image..."
if docker images nagelfluh-runner:latest | grep -q nagelfluh-runner; then
    echo "✓ Image nagelfluh-runner:latest built successfully"
else
    echo "❌ Error: Image not found after build"
    exit 1
fi

# Tag and push to local registry
echo ""
echo "Pushing to local registry..."

# Get minikube IP for NodePort access
MINIKUBE_IP=$(minikube ip)
REGISTRY_URL="${MINIKUBE_IP}:30500"

echo "Registry URL: ${REGISTRY_URL}"
docker tag nagelfluh-runner:latest ${REGISTRY_URL}/nagelfluh-base-runner:latest

# Push the image
if docker push ${REGISTRY_URL}/nagelfluh-base-runner:latest; then
    echo "✓ Image pushed to ${REGISTRY_URL}/nagelfluh-base-runner:latest"
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

MINIKUBE_IP=$(minikube ip)
echo ""
echo "=== ✅ Build complete! ==="
echo ""
echo "The image is now available in:"
echo "  - Minikube's Docker daemon: nagelfluh-runner:latest"
echo "  - Local registry (NodePort): ${MINIKUBE_IP}:30500/nagelfluh-base-runner:latest"
echo "  - From pods (ClusterIP): registry.nagelfluh-jobs.svc.cluster.local:5000/nagelfluh-base-runner:latest"
echo ""

# Extract process schemas from the built image and update bootstrap environment
echo "=== Updating Bootstrap Environment ==="
echo ""
echo "Extracting process schemas from image..."

# Create temporary file for the schemas
SCHEMA_FILE=$(mktemp)

# Extract process_schemas.json from the image using docker
if docker run --rm nagelfluh-runner:latest cat /app/process_schemas.json > "$SCHEMA_FILE" 2>/dev/null; then
    echo "✓ Extracted process schemas from image"

    # Show what we extracted
    PROCESS_COUNT=$(python3 -c "import json; print(len(json.load(open('$SCHEMA_FILE'))))" 2>/dev/null || echo "0")
    echo "  Found $PROCESS_COUNT process type(s)"

    # Update the database
    echo ""
    echo "Updating bootstrap environment in database..."

    # Run the update script
    if python3 docker/update_bootstrap_environment.py "$SCHEMA_FILE"; then
        echo ""
        echo "✓ Bootstrap environment updated successfully"
    else
        echo ""
        echo "✗ Failed to update bootstrap environment"
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
echo "For production (GCR), build and push with:"
echo "  docker build -f docker/base-runner/Dockerfile -t gcr.io/{project}/nagelfluh-runner:latest ."
echo "  docker push gcr.io/{project}/nagelfluh-runner:latest"
echo ""
