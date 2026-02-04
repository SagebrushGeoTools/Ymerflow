#!/bin/bash
# Setup script for Nagelfluh on minikube
# Safe to run multiple times - will clean up and reinstall if needed

set -e

cd "$(dirname "$0")/.."

echo "=== Setting up Minikube for Nagelfluh ==="
echo ""

# Check if minikube is running and if it needs insecure registry configuration
NEEDS_RESTART=false

if minikube status --format='{{.Host}}' 2>/dev/null | grep -q '^Running$'; then
    echo "Minikube is running, checking configuration..."

    # Check if insecure registries are configured
    if ! minikube ssh -- cat /etc/docker/daemon.json 2>/dev/null | grep -q "insecure-registries"; then
        echo "⚠ Minikube is not configured for insecure registries (needed for local registry)"
        echo "  Stopping and restarting minikube with correct configuration..."
        NEEDS_RESTART=true
        minikube stop
    else
        echo "✓ Minikube already running with correct configuration"
    fi
else
    echo "Minikube is not running"
    NEEDS_RESTART=true
fi

# Start/restart minikube with insecure registry support
if [ "$NEEDS_RESTART" = true ]; then
    echo "Starting minikube with insecure registry support..."
    minikube start --cpus=4 --memory=8192 \
        --insecure-registry="10.0.0.0/8" \
        --insecure-registry="192.168.0.0/16" \
        --insecure-registry="172.16.0.0/12"
    echo "✓ Minikube started with insecure registry support (allows HTTP registry access)"
fi

# Check if Kueue is installed and working
KUEUE_NEEDS_INSTALL=false
if kubectl get namespace kueue-system &> /dev/null 2>&1; then
    echo ""
    echo "Checking existing Kueue installation..."

    # Check if controller is running properly
    if kubectl get deployment -n kueue-system kueue-controller-manager &> /dev/null 2>&1; then
        READY=$(kubectl get deployment -n kueue-system kueue-controller-manager -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
        if [ "$READY" -eq "0" ]; then
            echo "⚠ Kueue controller not ready - will reinstall"
            KUEUE_NEEDS_INSTALL=true
        else
            echo "✓ Kueue is installed and running"
        fi
    else
        KUEUE_NEEDS_INSTALL=true
    fi
else
    KUEUE_NEEDS_INSTALL=true
fi

# Clean up and reinstall Kueue if needed
if [ "$KUEUE_NEEDS_INSTALL" = true ]; then
    echo ""
    echo "Installing Kueue..."

    # Clean up any existing installation
    if kubectl get namespace kueue-system &> /dev/null 2>&1; then
        echo "Removing old Kueue installation..."
        kubectl delete namespace kueue-system --timeout=60s || true
        sleep 5
    fi

    # Install Kueue (using server-side apply to handle large CRDs)
    echo "Installing Kueue v0.9.1..."
    kubectl apply --server-side -f https://github.com/kubernetes-sigs/kueue/releases/download/v0.9.1/manifests.yaml

    # Wait for CRDs to be established
    echo "Waiting for Kueue CRDs to be registered..."
    for i in {1..30}; do
        if kubectl get crd clusterqueues.kueue.x-k8s.io &> /dev/null 2>&1; then
            echo "✓ Kueue CRDs registered"
            break
        fi
        sleep 2
    done

    # Wait for controller to be ready
    echo "Waiting for Kueue controller to be ready..."
    kubectl wait --for=condition=available --timeout=120s deployment/kueue-controller-manager -n kueue-system || {
        echo "⚠ Warning: Kueue controller not ready yet, will retry config later"
    }

    # Extra wait for webhook to stabilize
    sleep 10
fi

# Create namespace if it doesn't exist
echo ""
echo "Creating nagelfluh-jobs namespace..."
if kubectl get namespace nagelfluh-jobs &> /dev/null 2>&1; then
    echo "✓ Namespace nagelfluh-jobs already exists"
else
    kubectl create namespace nagelfluh-jobs
    echo "✓ Created namespace nagelfluh-jobs"
fi

# Apply Kueue configuration with retry
echo ""
echo "Applying Kueue configuration..."
MAX_RETRIES=3
for attempt in $(seq 1 $MAX_RETRIES); do
    if kubectl apply -f k8s/kueue/ 2>&1; then
        echo "✓ Kueue configuration applied"
        break
    else
        if [ $attempt -lt $MAX_RETRIES ]; then
            echo "⚠ Failed to apply config, retrying in 10 seconds... (attempt $attempt/$MAX_RETRIES)"
            sleep 10
        else
            echo "❌ Failed to apply Kueue configuration after $MAX_RETRIES attempts"
            echo "   You may need to run: ./dev/cleanup-minikube.sh && ./dev/setup-minikube.sh"
            exit 1
        fi
    fi
done

echo ""
echo "=== ✅ Minikube setup complete! ==="
echo ""
echo "Next steps:"
echo "  1. Build Docker image: ./docker/build.sh"
echo "  2. Run migrations: alembic -c backend/alembic.ini upgrade head"
echo "  3. Start backend: ./backend/run.sh"
echo "  4. Start frontend: ./frontend/run.sh"
echo ""

