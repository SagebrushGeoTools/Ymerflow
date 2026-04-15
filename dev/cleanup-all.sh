#!/bin/bash
# Comprehensive cleanup script for Nagelfluh development environment
# This script cleans up:
# - Screen sessions
# - Port-forwards (MinIO only; registry uses NodePort)
# - Docker registry
# - MinIO
# - Kueue and Nagelfluh resources
# - Optionally: minikube itself

set -e

cd "$(dirname "$0")/.."

# Color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

print_status() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

echo "=========================================="
echo "Nagelfluh Complete Cleanup"
echo "=========================================="
echo ""

# ==========================================
# Step 1: Stop Screen Sessions
# ==========================================
echo "Step 1: Stopping screen sessions..."
if screen -list | grep -q "nagelfluh-dev"; then
    screen -X -S nagelfluh-dev quit 2>/dev/null || true
    print_status "Screen session stopped"
else
    print_status "No screen session running"
fi

# ==========================================
# Step 2: Kill Port-Forwards
# ==========================================
echo ""
echo "Step 2: Killing port-forwards..."

# MinIO port-forward
if pgrep -f "kubectl port-forward.*minio.*9000" > /dev/null; then
    pkill -f "kubectl port-forward.*minio.*9000" || true
    print_status "MinIO port-forward killed"
else
    print_status "No MinIO port-forward running"
fi

# Any other kubectl port-forwards
if pgrep -f "kubectl port-forward" > /dev/null; then
    print_warning "Other kubectl port-forwards still running:"
    pgrep -f "kubectl port-forward" -a || true
fi

# Check if minikube is running
if ! minikube status &> /dev/null; then
    echo ""
    print_warning "Minikube is not running. Skipping Kubernetes cleanup."
    echo ""
    echo "Cleanup complete!"
    exit 0
fi

# ==========================================
# Step 3: Clean up Docker Registry
# ==========================================
echo ""
echo "Step 3: Cleaning up Docker Registry..."

if kubectl get namespace registry &> /dev/null; then
    kubectl delete namespace registry --timeout=60s 2>/dev/null || true
    print_status "Registry namespace deleted"
else
    print_status "Registry not installed"
fi

# ==========================================
# Step 4: Clean up MinIO
# ==========================================
echo ""
echo "Step 4: Cleaning up MinIO..."

if kubectl get namespace minio &> /dev/null; then
    kubectl delete namespace minio --timeout=60s 2>/dev/null || true
    print_status "MinIO namespace deleted"
else
    print_status "MinIO not installed"
fi

# ==========================================
# Step 5: Clean up Nagelfluh Resources
# ==========================================
echo ""
echo "Step 5: Cleaning up Nagelfluh resources..."

# Delete Kueue config (by name — generated yaml files may not exist after a fresh checkout)
kubectl delete clusterqueue nagelfluh-cluster-queue --ignore-not-found=true 2>&1 | grep -v "not found" || true
kubectl delete resourceflavor default-flavor --ignore-not-found=true 2>&1 | grep -v "not found" || true

# Delete namespace
if kubectl get namespace nagelfluh-jobs &> /dev/null; then
    kubectl delete namespace nagelfluh-jobs --timeout=60s 2>/dev/null || true
    print_status "Nagelfluh namespace deleted"
else
    print_status "Nagelfluh namespace not found"
fi

# ==========================================
# Step 6: Clean up Kueue
# ==========================================
echo ""
echo "Step 6: Cleaning up Kueue..."

if kubectl get namespace kueue-system &> /dev/null; then
    kubectl delete -f https://github.com/kubernetes-sigs/kueue/releases/download/v0.9.1/manifests.yaml --ignore-not-found=true 2>&1 | grep -v "not found" | head -20 || true

    # Force delete namespace if still exists
    if kubectl get namespace kueue-system &> /dev/null; then
        kubectl delete namespace kueue-system --timeout=60s 2>/dev/null || true
    fi
    print_status "Kueue deleted"
else
    print_status "Kueue not installed"
fi

# ==========================================
# Step 7: Optionally Stop Minikube
# ==========================================
echo ""
echo "=========================================="
echo "Cleanup Complete!"
echo "=========================================="
echo ""
echo "Minikube is still running."
echo ""
echo "To also stop minikube, run:"
echo "  minikube stop"
echo ""
echo "To delete minikube completely (WARNING: destroys all data):"
echo "  minikube delete"
echo ""
echo "To start fresh, run:"
echo "  ./dev/runall.sh"
echo ""
