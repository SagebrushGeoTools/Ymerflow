#!/bin/bash
# Master setup and run script for Nagelfluh development environment
# This script:
# - Sets up minikube, minio, and docker registry
# - Installs dependencies
# - Runs database migrations
# - Builds docker images
# - Starts all services in a single screen session with multiple windows

set -e

cd "$(dirname "$0")/.."
PROJECT_ROOT="$(pwd)"

# Load user config, exporting all variables so child processes (setup scripts, screen windows) inherit them
if [ -f "config.env" ]; then
    set -a
    source config.env
    set +a
fi

echo "=========================================="
echo "Nagelfluh Development Environment Setup"
echo "=========================================="
echo ""

# Color codes for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_section() {
    echo ""
    echo "=========================================="
    echo "$1"
    echo "=========================================="
    echo ""
}

# Function to check if a screen session exists
screen_exists() {
    screen -list | grep -q "\.$1\s"
}

# Function to kill a screen session if it exists
kill_screen() {
    if screen_exists "$1"; then
        print_warning "Killing existing screen session: $1"
        screen -S "$1" -X quit || true
        sleep 1
    fi
}

# ==========================================
# Step 1: Setup Minikube
# ==========================================
print_section "Step 1: Minikube Setup"

# Always run setup to ensure all components (minikube, Kueue, etc.) are properly configured
# The script is idempotent and will skip unnecessary steps if already set up
./dev/setup-minikube.sh

# Ensure namespaces exist (needed by MinIO, registry, and job runner)
kubectl apply -f "${PROJECT_ROOT}/k8s/00-namespaces.yaml"
print_status "Namespaces ready"

# ==========================================
# Step 2: Pre-pull Images
# ==========================================
print_section "Step 2: Pre-pull Images"

./dev/prepull-images.sh
print_status "Images pre-pulled into minikube"

# ==========================================
# Step 3: Python Environment Setup
# ==========================================
print_section "Step 3: Python Environment Setup"

if [ ! -d "env" ]; then
    print_warning "Virtual environment not found. Creating..."
    python3 -m venv env
    print_status "Virtual environment created"
fi

# Activate virtual environment
source env/bin/activate
print_status "Virtual environment activated"

# Install/upgrade backend dependencies
echo "Installing Python dependencies..."
pip install -q --upgrade pip
pip install -q -e "${PROJECT_ROOT}"
print_status "Python dependencies installed"

# Install server-side backend plugins listed in BACKEND_PLUGINS (paths / PyPI names / git URLs).
# Same script the prod backend image uses, so dev and prod install plugins identically.
echo "Installing backend plugins..."
BACKEND_PLUGINS="${BACKEND_PLUGINS:-}" bash "${PROJECT_ROOT}/scripts/install-backend-plugins.sh"
print_status "Backend plugins installed"

# ==========================================
# Step 3: Setup MinIO
# ==========================================
print_section "Step 3: MinIO Setup"

if ! kubectl get pods -n minio -l app=minio 2>/dev/null | grep -q Running; then
    echo "MinIO not running. Starting setup..."
    ./dev/setup-minio.sh
else
    print_status "MinIO already running"
fi

# Ensure MinIO port-forward is running
if ! pgrep -f "kubectl port-forward.*minio.*9000" > /dev/null; then
    print_warning "MinIO port-forward not running. Starting..."
    ./dev/restart-minio-portforward.sh
else
    print_status "MinIO port-forward already running"
fi

# ==========================================
# Step 4: Setup Docker Registry
# ==========================================
print_section "Step 4: Docker Registry Setup"

# Note: Registry no longer requires MinIO - it uses local filesystem storage

if ! kubectl get pods -n registry -l app=registry 2>/dev/null | grep -q Running; then
    echo "Docker Registry not running. Starting setup..."
    ./dev/setup-registry.sh
else
    print_status "Docker Registry already running"
fi

# ==========================================
# Step 5: Frontend Dependencies
# ==========================================
print_section "Step 5: Frontend Dependencies"

cd frontend
if [ ! -d "node_modules" ]; then
    print_warning "node_modules not found. Installing..."
    npm install
    print_status "Frontend dependencies installed"
else
    print_status "Frontend dependencies already installed"
fi
cd "$PROJECT_ROOT"

# ==========================================
# Step 6: Database Migrations
# ==========================================
print_section "Step 6: Database Migrations"

echo "Running database migrations..."
PYTHONPATH=. env/bin/python backend/bin/nagelfluh-migrate
print_status "Database migrations complete"

# ==========================================
# Step 7: Verify Registry is Ready
# ==========================================
print_section "Step 7: Registry Verification"

# Ensure registry pods are running
echo "Checking registry deployment status..."
if ! kubectl get deployment -n registry registry &> /dev/null; then
    print_error "Registry deployment not found. Setup may have failed."
    exit 1
fi

echo "Waiting for registry pods to be ready..."
kubectl wait --for=condition=available --timeout=120s deployment/registry -n registry || {
    print_error "Registry deployment not ready"
    echo "Check status with: kubectl get pods -n registry"
    exit 1
}

# Test registry accessibility via NodePort (TLS + basic auth, see dev/setup-registry.sh)
REGISTRY_USER="${REGISTRY_USER:-nagelfluh}"
REGISTRY_PASSWORD="${REGISTRY_PASSWORD:-nagelfluh}"
MINIKUBE_IP=$(minikube ip)
REGISTRY_URL="https://${MINIKUBE_IP}:30500"

echo "Testing registry at ${REGISTRY_URL}..."
for i in {1..10}; do
    if curl -skf -u "${REGISTRY_USER}:${REGISTRY_PASSWORD}" ${REGISTRY_URL}/v2/ >/dev/null 2>&1; then
        print_status "Registry accessible at ${REGISTRY_URL}"
        break
    fi
    if [ $i -eq 10 ]; then
        print_error "Registry not accessible after 10 seconds"
        echo "Check status with: kubectl get pods -n registry"
        exit 1
    fi
    sleep 1
done

# ==========================================
# Step 8: Build Docker Image
# ==========================================
print_section "Step 8: Docker Image Build"

echo "Building Nagelfluh runner image..."
# The docker/build.sh script will use the registry NodePort
./docker/build.sh
print_status "Docker image built and pushed to registry"

# ==========================================
# Step 9: Start Services in Screen
# ==========================================
print_section "Step 9: Starting Services"

# Kill existing screen session
SCREEN_SESSION="nagelfluh-dev"
kill_screen "$SCREEN_SESSION"

# Create a new detached screen session with the first window (backend)
echo "Starting services in screen session '$SCREEN_SESSION'..."
screen -dmS "$SCREEN_SESSION" -t backend bash -c "cd '$PROJECT_ROOT' && echo 'Starting backend...' && sleep 2 && ./backend/run.sh"

# Add frontend window
screen -S "$SCREEN_SESSION" -X screen -t frontend bash -c "cd '$PROJECT_ROOT/frontend' && echo 'Starting frontend...' && sleep 2 && npm start"

# Add service monitor window
screen -S "$SCREEN_SESSION" -X screen -t monitor bash -c "cd '$PROJECT_ROOT' && echo 'Starting service monitor...' && sleep 2 && ./dev/monitor-services.sh"

sleep 3

if screen_exists "$SCREEN_SESSION"; then
    print_status "All services started in screen session '$SCREEN_SESSION'"
else
    print_error "Failed to start screen session"
    exit 1
fi

# ==========================================
# Complete!
# ==========================================
print_section "Setup Complete!"

MINIKUBE_IP=$(minikube ip)

echo "Services running:"
echo "  Backend:  http://localhost:8000"
echo "  Frontend: http://localhost:3000"
echo "  MinIO:    https://localhost:9000 (self-signed cert)"
echo "  Registry: https://${MINIKUBE_IP}:30500 (NodePort, self-signed cert)"
echo ""
echo "Screen session: $SCREEN_SESSION"
echo "  Window 0: backend          - FastAPI backend"
echo "  Window 1: frontend         - React frontend"
echo "  Window 2: monitor          - Service monitor (auto-restarts)"
echo ""
echo "Useful commands:"
echo "  screen -r $SCREEN_SESSION              # Attach to session"
echo "  Ctrl+A, then N                         # Next window"
echo "  Ctrl+A, then P                         # Previous window"
echo "  Ctrl+A, then 0/1/2                     # Switch to window 0/1/2"
echo "  Ctrl+A, then \"                          # List all windows"
echo "  Ctrl+A, then D                         # Detach from session"
echo "  screen -X -S $SCREEN_SESSION quit      # Stop all services"
echo ""
echo "Port-forwards running in background:"
echo "  MinIO:    PID $(pgrep -f 'kubectl port-forward.*minio.*9000' || echo 'NOT RUNNING')"
echo ""
echo "To view logs, attach to screen and navigate between windows."
echo ""
