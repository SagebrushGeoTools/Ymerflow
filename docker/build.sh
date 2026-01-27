#!/bin/bash
set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/.."

echo "Building Docker image: nagelfluh-default:0.1"
docker build -t nagelfluh-default:0.1 -f docker/Dockerfile.base .

echo ""
echo "✓ Docker image built successfully!"
echo "  Tag: nagelfluh-default:0.1"
echo ""

# Check if minikube is running
if ! minikube status &>/dev/null; then
    echo "⚠️  Minikube is not running. Starting minikube..."
    minikube start
fi

echo "Loading image into minikube..."
minikube image load nagelfluh-default:0.1

echo ""
echo "✓ Image loaded into minikube successfully!"
