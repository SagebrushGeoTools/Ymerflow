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

# Note: MinIO and the registry are published via minikube's docker driver (NodePort),
# not kubectl port-forward, so they stay reachable independent of this script.

echo ""
echo "Services stopped. Kubernetes resources (minikube, MinIO, registry) remain running."
echo ""
echo "To clean up everything (MinIO, registry, Kueue, etc.), run:"
echo "  ./dev/cleanup-all.sh"
echo ""
echo "To stop minikube:"
echo "  minikube stop"
