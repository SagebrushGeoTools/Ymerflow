#!/bin/bash
# Cleanup script to remove all Nagelfluh resources from minikube
# Safe to run multiple times

cd "$(dirname "$0")/.."

echo "=== Cleaning up Nagelfluh from Minikube ==="
echo ""

# Delete Kueue config
echo "Deleting Kueue configuration..."
kubectl delete -f k8s/kueue/ --ignore-not-found=true 2>&1 | grep -v "not found" || true
echo "✓ Kueue configuration deleted"

# Delete namespace (this will delete all jobs/pods in it)
echo ""
echo "Deleting nagelfluh-jobs namespace..."
if kubectl get namespace nagelfluh-jobs &> /dev/null; then
    kubectl delete namespace nagelfluh-jobs --timeout=60s
    echo "✓ Namespace deleted"
else
    echo "✓ Namespace doesn't exist"
fi

# Delete Kueue entirely
echo ""
echo "Deleting Kueue installation..."
if kubectl get namespace kueue-system &> /dev/null; then
    # Delete the Kueue manifests (try v0.9.1 first, fall back to namespace delete)
    kubectl delete -f https://github.com/kubernetes-sigs/kueue/releases/download/v0.9.1/manifests.yaml --ignore-not-found=true 2>&1 | grep -v "not found" | head -20 || true

    # Force delete namespace if it still exists
    if kubectl get namespace kueue-system &> /dev/null; then
        echo "Force deleting kueue-system namespace..."
        kubectl delete namespace kueue-system --timeout=60s || true
    fi
    echo "✓ Kueue deleted"
else
    echo "✓ Kueue not installed"
fi

echo ""
echo "=== ✅ Cleanup complete! ==="
echo ""
echo "To start fresh, run: ./dev/setup-minikube.sh"
echo ""
