#!/bin/bash

echo "Restarting MinIO port-forward..."

# Kill existing port-forward
pkill -f "kubectl port-forward.*minio.*9000" || true
sleep 1

# Check if MinIO is running
if ! kubectl get pods -n minio -l app=minio 2>/dev/null | grep -q Running; then
    echo "Error: MinIO is not running in minikube"
    echo "Run: ./dev/setup-minio.sh"
    exit 1
fi

# Start new port-forward in background
kubectl port-forward -n minio svc/minio 9000:9000 >/dev/null 2>&1 &
PF_PID=$!

sleep 2

# Test if it's working
if ps -p $PF_PID > /dev/null; then
    echo "✓ Port-forward started (PID: $PF_PID)"
    echo "  MinIO API: http://localhost:9000"
    echo "  To stop: kill $PF_PID"
else
    echo "✗ Failed to start port-forward"
    exit 1
fi
