#!/bin/bash
set -e

cd "$(dirname "$0")/base-runner"

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

# Build the image
echo "Building nagelfluh-runner:latest..."
docker build -t nagelfluh-runner:latest .

# Verify the image exists
echo ""
echo "Verifying image..."
if docker images nagelfluh-runner:latest | grep -q nagelfluh-runner; then
    echo "✓ Image nagelfluh-runner:latest built successfully"
else
    echo "❌ Error: Image not found after build"
    exit 1
fi

echo ""
echo "=== ✅ Build complete! ==="
echo ""
echo "The image is now available in minikube's Docker daemon."
echo ""
echo "For production (GCR), build and push with:"
echo "  docker build -t gcr.io/{project}/nagelfluh-runner:latest ."
echo "  docker push gcr.io/{project}/nagelfluh-runner:latest"
echo ""
