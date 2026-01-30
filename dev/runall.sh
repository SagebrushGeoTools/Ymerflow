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

if ! minikube status &> /dev/null; then
    echo "Minikube not running. Starting setup..."
    ./dev/setup-minikube.sh
else
    print_status "Minikube already running"
fi

# Ensure nagelfluh-jobs namespace exists (needed by MinIO and registry)
if ! kubectl get namespace nagelfluh-jobs &> /dev/null 2>&1; then
    echo "Creating nagelfluh-jobs namespace..."
    kubectl create namespace nagelfluh-jobs
    print_status "Created nagelfluh-jobs namespace"
else
    print_status "nagelfluh-jobs namespace exists"
fi

# ==========================================
# Step 2: Python Environment Setup
# ==========================================
print_section "Step 2: Python Environment Setup"

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
pip install -q -r backend/requirements.txt
print_status "Python dependencies installed"

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
alembic -c backend/alembic.ini upgrade head
print_status "Database migrations complete"

# ==========================================
# Step 7: Setup Registry Port-Forward
# ==========================================
print_section "Step 7: Registry Port-Forward"

# First, ensure registry pods are actually running
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

# Give pods a moment to fully initialize
sleep 5

# Kill any existing port-forward on 5000
if pgrep -f "kubectl port-forward.*registry.*5000" > /dev/null; then
    print_warning "Killing existing registry port-forward..."
    pkill -f "kubectl port-forward.*registry.*5000" || true
    sleep 2
fi

# Also check if anything else is using port 5000
if lsof -i :5000 &> /dev/null; then
    print_error "Port 5000 is already in use:"
    lsof -i :5000
    exit 1
fi

# Start port-forward in background
echo "Starting registry port-forward..."
kubectl port-forward -n registry svc/registry 5000:5000 >/dev/null 2>&1 &
REGISTRY_PF_PID=$!

# Give it a moment to start
sleep 3

# Verify the process is still running
if ! kill -0 $REGISTRY_PF_PID 2>/dev/null; then
    print_error "Registry port-forward process died immediately"
    exit 1
fi

# Wait for port-forward to be ready
echo "Waiting for registry to be accessible on localhost:5000..."
for i in {1..30}; do
    if curl -sf http://localhost:5000/v2/ >/dev/null 2>&1; then
        print_status "Registry accessible on localhost:5000 (PID: $REGISTRY_PF_PID)"
        break
    fi
    # Check if process is still alive
    if ! kill -0 $REGISTRY_PF_PID 2>/dev/null; then
        print_error "Registry port-forward process died"
        exit 1
    fi
    if [ $i -eq 30 ]; then
        print_error "Registry port-forward failed to become accessible after 30 seconds"
        echo "Port-forward PID: $REGISTRY_PF_PID (still running: $(kill -0 $REGISTRY_PF_PID 2>/dev/null && echo yes || echo no))"
        echo "Checking registry pods:"
        kubectl get pods -n registry
        kill $REGISTRY_PF_PID 2>/dev/null || true
        exit 1
    fi
    sleep 1
done

# ==========================================
# Step 8: Build Docker Image
# ==========================================
print_section "Step 8: Docker Image Build"

echo "Building Nagelfluh runner image..."
# The docker/build.sh script will use our existing port-forward
./docker/build.sh
print_status "Docker image built and pushed to registry"

# ==========================================
# Step 9: Start Services in Screen
# ==========================================
print_section "Step 9: Starting Services"

# Kill existing screen session
SCREEN_SESSION="nagelfluh-dev"
kill_screen "$SCREEN_SESSION"

# Kill the temporary registry port-forward since we'll run it in screen
kill $REGISTRY_PF_PID 2>/dev/null || true
sleep 1

# Create a new detached screen session with the first window (backend)
echo "Starting services in screen session '$SCREEN_SESSION'..."
screen -dmS "$SCREEN_SESSION" -t backend bash -c "cd '$PROJECT_ROOT' && source env/bin/activate && echo 'Starting backend...' && sleep 2 && uvicorn backend.main:app --reload"

# Add frontend window
screen -S "$SCREEN_SESSION" -X screen -t frontend bash -c "cd '$PROJECT_ROOT/frontend' && echo 'Starting frontend...' && sleep 2 && npm start"

# Add registry port-forward window
screen -S "$SCREEN_SESSION" -X screen -t registry-pf bash -c "echo 'Starting registry port-forward...' && sleep 2 && kubectl port-forward -n registry svc/registry 5000:5000"

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

echo "Services running:"
echo "  Backend:  http://localhost:8000"
echo "  Frontend: http://localhost:3000"
echo "  MinIO:    http://localhost:9000"
echo "  Registry: http://localhost:5000"
echo ""
echo "Screen session: $SCREEN_SESSION"
echo "  Window 0: backend          - FastAPI backend"
echo "  Window 1: frontend         - React frontend"
echo "  Window 2: registry-pf      - Registry port-forward"
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
