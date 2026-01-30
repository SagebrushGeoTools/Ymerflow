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
docker tag nagelfluh-runner:latest localhost:5000/nagelfluh-base-runner:latest

# Set up port-forward to registry
kubectl port-forward -n registry svc/registry 5000:5000 >/dev/null 2>&1 &
PF_PID=$!
trap "kill $PF_PID 2>/dev/null || true" EXIT
sleep 2

# Push the image
if docker push localhost:5000/nagelfluh-base-runner:latest; then
    echo "✓ Image pushed to registry:5000/nagelfluh-base-runner:latest"
else
    echo "❌ Error: Failed to push image to registry"
    exit 1
fi

# Cleanup port-forward
kill $PF_PID 2>/dev/null || true

echo ""
echo "=== ✅ Build complete! ==="
echo ""
echo "The image is now available in:"
echo "  - Minikube's Docker daemon: nagelfluh-runner:latest"
echo "  - Local registry: registry:5000/nagelfluh-base-runner:latest"
echo ""
echo "For production (GCR), build and push with:"
echo "  docker build -f docker/base-runner/Dockerfile -t gcr.io/{project}/nagelfluh-runner:latest ."
echo "  docker push gcr.io/{project}/nagelfluh-runner:latest"
echo ""
