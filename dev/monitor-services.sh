#!/bin/bash
# Service monitoring and auto-restart script
# This runs in the background and restarts failed services

cd "$(dirname "$0")/.."
PROJECT_ROOT="$(pwd)"

# Color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log_ok() {
    log "${GREEN}✓${NC} $1"
}

log_warn() {
    log "${YELLOW}⚠${NC} $1"
}

log_error() {
    log "${RED}✗${NC} $1"
}

# Function to check and restart MinIO port-forward
check_minio_portforward() {
    if ! pgrep -f "kubectl port-forward.*minio.*9000" > /dev/null; then
        log_warn "MinIO port-forward is down. Restarting..."

        # Check if MinIO pod is still running
        if ! kubectl get pods -n minio -l app=minio 2>/dev/null | grep -q Running; then
            log_error "MinIO pod is not running. Cannot restart port-forward."
            return 1
        fi

        # Restart port-forward
        kubectl port-forward -n minio svc/minio 9000:9000 >/dev/null 2>&1 &
        PF_PID=$!
        sleep 2

        if ps -p $PF_PID > /dev/null; then
            log_ok "MinIO port-forward restarted (PID: $PF_PID)"
        else
            log_error "Failed to restart MinIO port-forward"
        fi
    fi
}

# Function to check if backend is responding
check_backend() {
    if ! curl -sf http://localhost:8000/docs > /dev/null 2>&1; then
        log_warn "Backend not responding on http://localhost:8000"
        # Note: We don't auto-restart the backend as it's in a screen window
        # and may be intentionally stopped or reloading
    fi
}

# Function to check if frontend is responding
check_frontend() {
    if ! curl -sf http://localhost:3000 > /dev/null 2>&1; then
        log_warn "Frontend not responding on http://localhost:3000"
        # Note: We don't auto-restart the frontend as it's in a screen window
        # and may be intentionally stopped or building
    fi
}

# Main monitoring loop
log_ok "Service monitor started"
log "Monitoring MinIO port-forward, backend, and frontend..."
log "Press Ctrl+C to stop monitoring"
echo ""

CHECK_INTERVAL=10  # Check every 10 seconds
MINIO_CHECK_INTERVAL=5  # Check MinIO more frequently (every 5 checks = 50 seconds)
counter=0

while true; do
    counter=$((counter + 1))

    # Always check MinIO port-forward (most fragile)
    if [ $((counter % MINIO_CHECK_INTERVAL)) -eq 0 ]; then
        check_minio_portforward
    fi

    # Occasionally check backend/frontend (less critical, just for awareness)
    if [ $((counter % 30)) -eq 0 ]; then  # Every 5 minutes
        check_backend
        check_frontend
    fi

    sleep $CHECK_INTERVAL
done
