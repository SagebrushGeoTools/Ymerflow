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
# Step 5b: Bootstrap-provision configured backends
# ==========================================
print_section "Step 5b: Bootstrap Provisioning"

# For each axis (registry/storage/cluster) where an operator opted into a plugin-provided
# protocol via <AXIS>_PROTOCOL/<AXIS>_CONFIG_JSON in config.env (already exported above),
# resolve its handler and call bootstrap(). The enriched {protocol, config} result overrides
# whatever config.env set, since bootstrap() is authoritative (it may have live-provisioned
# something). If no axis is configured this way (the common case), bootstrap-provision prints
# "{}" and nothing changes — fully backward compatible. See docs/plans/registry-backend-hooks.md
# (Design decision 6).
echo "Running bootstrap-provision..."
BOOTSTRAP_JSON=$(PYTHONPATH=. env/bin/python backend/bin/nagelfluh-bootstrap-provision)

# eval runs directly in this shell (not inside a subshell) so the `export` statements it emits
# actually persist into this script's environment, and therefore into Step 6's nagelfluh-migrate
# subprocess. Do NOT wrap this eval in a command substitution — that would run it in a subshell
# and silently discard the exports.
eval "$(python3 -c '
import json, sys, shlex

data = json.loads(sys.argv[1])
axis_map = {
    "registry": ("REGISTRY_PROTOCOL", "REGISTRY_CONFIG_JSON"),
    "storage": ("STORAGE_PROTOCOL", "STORAGE_CONFIG_JSON"),
    "cluster": ("CLUSTER_TYPE", "CLUSTER_CONFIG_JSON"),
}
lines = []
for axis, (protocol_var, config_var) in axis_map.items():
    if axis not in data:
        continue
    entry = data[axis]
    protocol = entry["protocol"]
    config_json = json.dumps(entry["config"])
    lines.append(f"export {protocol_var}={shlex.quote(protocol)}")
    lines.append(f"export {config_var}={shlex.quote(config_json)}")
print("\n".join(lines))
' "${BOOTSTRAP_JSON}")"

# Separately (no exports involved here, just a plain string) determine which axes were
# bootstrap-provisioned, for the status line below.
BOOTSTRAPPED_AXES=$(python3 -c '
import json, sys

data = json.loads(sys.argv[1])
print(",".join(axis for axis in ("registry", "storage", "cluster") if axis in data))
' "${BOOTSTRAP_JSON}")

if [ -n "${BOOTSTRAPPED_AXES}" ]; then
    print_status "Bootstrap-provisioned axes: ${BOOTSTRAPPED_AXES} (enriched config exported for migrations)"
else
    print_status "No axes bootstrap-provisioned (no <AXIS>_PROTOCOL/<AXIS>_CONFIG_JSON set in config.env)"
fi

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

# Test registry accessibility via its publicly-exposed host:port (TLS + basic auth, see
# dev/setup-registry.sh) — the same address docker/build.sh pushes to and every cluster
# (including this one) pulls from. See docs/plans/done/remote-cluster-provisioning-and-registry.md.
REGISTRY_USER="${REGISTRY_USER:-nagelfluh}"
REGISTRY_PASSWORD="${REGISTRY_PASSWORD:-nagelfluh}"
REGISTRY_PUBLIC_HOST="${REGISTRY_PUBLIC_HOST:-$(hostname -I | awk '{print $1}')}"
REGISTRY_URL="https://${REGISTRY_PUBLIC_HOST}:30500"

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

echo "Services running:"
echo "  Backend:  http://localhost:8000"
echo "  Frontend: http://localhost:3000"
echo "  MinIO:    https://localhost:9000 (self-signed cert)"
echo "  Registry: ${REGISTRY_URL} (NodePort, self-signed cert)"
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
echo "To view logs, attach to screen and navigate between windows."
echo ""
