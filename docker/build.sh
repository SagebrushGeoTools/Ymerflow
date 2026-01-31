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
echo "For production (GCR), build and push with:"
echo "  docker build -f docker/base-runner/Dockerfile -t gcr.io/{project}/nagelfluh-runner:latest ."
echo "  docker push gcr.io/{project}/nagelfluh-runner:latest"
echo ""
