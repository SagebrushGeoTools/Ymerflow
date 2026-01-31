#!/bin/bash
# Stop all Nagelfluh development services

SCREEN_SESSION="nagelfluh-dev"

echo "Stopping Nagelfluh development services..."

# Kill screen session if it exists
if screen -list | grep -q "\.$SCREEN_SESSION\s"; then
    echo "Stopping screen session: $SCREEN_SESSION"
    screen -X -S "$SCREEN_SESSION" quit
    echo "✓ Screen session stopped"
else
    echo "Screen session '$SCREEN_SESSION' not found"
fi

# Note: MinIO port-forward is kept running for MinIO access from localhost
# The registry uses NodePort and does NOT depend on port-forwarding
# If you want to stop MinIO port-forward too, uncomment the following:
# pkill -f "kubectl port-forward.*minio.*9000" || true
# echo "✓ MinIO port-forward stopped"

echo ""
echo "Services stopped. Kubernetes resources (minikube, MinIO, registry) remain running."
echo ""
echo "To clean up everything (MinIO, registry, Kueue, etc.), run:"
echo "  ./dev/cleanup-all.sh"
echo ""
echo "To stop minikube:"
echo "  minikube stop"
