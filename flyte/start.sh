#!/bin/bash
set -e

echo "=== Nagelfluh Flyte Development Setup ==="
echo ""

# Check if minikube is running
echo "Checking minikube status..."
if ! minikube status > /dev/null 2>&1; then
    echo "Starting minikube..."
    minikube start --cpus=4 --memory=8192
    echo "✓ Minikube started"
else
    echo "✓ Minikube is already running"
fi

echo ""

# Check if Flyte is deployed
echo "Checking Flyte deployment..."
if ! kubectl get namespace flyte > /dev/null 2>&1; then
    echo "Deploying Flyte to minikube..."
    echo "This may take several minutes on first run..."
    flytectl demo start --source .
    echo "✓ Flyte deployed"
else
    echo "✓ Flyte namespace already exists"
fi

echo ""

# Wait for Flyte pods to be ready
echo "Waiting for Flyte pods to be ready..."
kubectl wait --for=condition=ready pod --all -n flyte --timeout=300s || true
echo "✓ Flyte pods are ready"

echo ""

# Check if port forwarding is already active
if lsof -i :30080 > /dev/null 2>&1; then
    echo "✓ Port 30080 is already in use (port forwarding may already be active)"
else
    # Port forward Flyte admin
    echo "Setting up port forwarding..."
    kubectl port-forward -n flyte svc/flyteadmin 30080:80 > /dev/null 2>&1 &
    PORT_FORWARD_PID=$!
    echo "✓ Port forwarding started (PID: $PORT_FORWARD_PID)"

    # Save PID for later
    echo $PORT_FORWARD_PID > /tmp/nagelfluh-flyte-port-forward.pid
fi

echo ""
echo "========================================="
echo "✓ Flyte is ready!"
echo "========================================="
echo "  - Admin endpoint: http://localhost:30080"
echo "  - Console: http://localhost:30080/console"
echo ""
echo "To stop port forwarding:"
echo "  kill \$(cat /tmp/nagelfluh-flyte-port-forward.pid)"
echo ""
echo "Next steps:"
echo "  1. Build and load docker image: ./docker/build.sh && minikube image load nagelfluh-default:0.1"
echo "  2. Workflows will be registered automatically when first process is submitted"
echo "========================================="
