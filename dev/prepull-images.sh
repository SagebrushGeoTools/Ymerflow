#!/bin/bash
# Pre-pull all external images into minikube's Docker daemon before deploying pods.
# Running pulls synchronously here means pod startup is instant — no timeout races.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/images.env"

IMAGES=(
    "$MINIO_IMAGE"
    "$REGISTRY_IMAGE"
)

echo "Pre-pulling images into minikube..."
for image in "${IMAGES[@]}"; do
    echo "  Pulling $image..."
    minikube ssh -- docker pull "$image"
done
echo "All images ready."
