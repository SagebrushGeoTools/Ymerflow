#!/bin/bash
# Setup script for Nagelfluh on minikube
# Safe to run multiple times - will clean up and reinstall if needed

set -e

cd "$(dirname "$0")/.."

echo "=== Setting up Minikube for Nagelfluh ==="
echo ""

# Desired resource limits (override via environment variables)
DESIRED_CPUS=${MINIKUBE_CPUS:-4}
DESIRED_MEMORY=${MINIKUBE_MEMORY:-16384}   # 16 GB — headroom for C++ compilation inside Docker
DESIRED_DISK=${MINIKUBE_DISK_SIZE:-30000}  # 30 GB — room for images + build artifacts

# Host data directory mounted into the Minikube VM so all PVC data (PostgreSQL,
# MinIO, etc.) survives minikube delete. Set NAGELFLUH_DATA_DIR in config.env
# to override the default.
NAGELFLUH_DATA_DIR="${NAGELFLUH_DATA_DIR:-$HOME/.nagelfluh/data}"

# host<:node> specs published on the host. Bare NodePorts map identity; MinIO re-maps its
# in-range NodePorts (30900/30901) back to the friendly 9000/9001 on the host.
MINIKUBE_EXPOSE_PORTS="${MINIKUBE_EXPOSE_PORTS:-30080 30500 9000:30900 9001:30901}"
MINIKUBE_LISTEN_ADDRESS="${MINIKUBE_LISTEN_ADDRESS:-0.0.0.0}"
# LAN IP(s) to add to the apiserver cert SAN. Empty = don't expose the apiserver externally.
MINIKUBE_APISERVER_IPS="${MINIKUBE_APISERVER_IPS:-}"

START_FLAGS=(--listen-address="${MINIKUBE_LISTEN_ADDRESS}")
for spec in $MINIKUBE_EXPOSE_PORTS; do
    case "$spec" in *:*) START_FLAGS+=(--ports="${spec}");; *) START_FLAGS+=(--ports="${spec}:${spec}");; esac
done
for ip in $MINIKUBE_APISERVER_IPS; do START_FLAGS+=(--apiserver-ips="${ip}"); done

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

    # Port publishing (and the apiserver SAN) are fixed at container-creation time, so
    # a missing host port requires a full delete + recreate, not just a stop/start.
    # PVC data survives via the host bind-mount, so this is non-destructive to data.
    for spec in $MINIKUBE_EXPOSE_PORTS; do
        host_port="${spec%%:*}"
        if ! docker port minikube 2>/dev/null | grep -qE "0\.0\.0\.0:${host_port}(\b|$)"; then
            echo "⚠ Host port ${host_port} not published — recreating minikube (data preserved, images rebuild)"
            minikube delete
            NEEDS_RESTART=true
            break
        fi
    done
else
    echo "Minikube is not running"
    NEEDS_RESTART=true
fi

# Check if resource changes are needed.
# Disk changes require delete+recreate (destructive). Memory/CPU can be
# changed with a simple stop+start that preserves all data.
MINIKUBE_CONFIG="$HOME/.minikube/profiles/minikube/config.json"
if [ -f "$MINIKUBE_CONFIG" ] && minikube status --format='{{.Host}}' 2>/dev/null | grep -q '^Running$'; then
    CURRENT_DISK=$(python3 -c "import json; print(json.load(open('$MINIKUBE_CONFIG')).get('DiskSize', 0))" 2>/dev/null || echo "0")
    CURRENT_MEMORY=$(python3 -c "import json; print(json.load(open('$MINIKUBE_CONFIG')).get('Memory', 0))" 2>/dev/null || echo "0")
    if [ "$CURRENT_DISK" -lt "$DESIRED_DISK" ]; then
        echo "⚠ Existing minikube disk size (${CURRENT_DISK}MB) is smaller than required (${DESIRED_DISK}MB)"
        echo ""
        echo "  THIS WILL DESTROY THE ENTIRE MINIKUBE VM — all PostgreSQL, MinIO,"
        echo "  and registry data will be permanently lost!"
        echo ""
        echo -n "  Type CONFIRM to proceed with minikube delete: "
        read -r CONFIRM
        if [ "$CONFIRM" != "CONFIRM" ]; then
            echo "  Aborted."
            exit 1
        fi
        echo "  Deleting and recreating minikube node..."
        minikube delete
        NEEDS_RESTART=true
    elif [ "$CURRENT_MEMORY" -lt "$DESIRED_MEMORY" ]; then
        echo "⚠ Existing minikube memory (${CURRENT_MEMORY}MB) is smaller than required (${DESIRED_MEMORY}MB)"
        echo "  Stopping and restarting with more memory (data will be preserved)..."
        minikube stop
        NEEDS_RESTART=true
    fi
fi

# Start/restart minikube with insecure registry support and host data mount
if [ "$NEEDS_RESTART" = true ]; then
    echo "Starting minikube with insecure registry support..."
    echo "  Host data directory: ${NAGELFLUH_DATA_DIR}"
    echo "  (mounted at /mnt/nagelfluh-data inside the VM — survives minikube delete)"
    mkdir -p "${NAGELFLUH_DATA_DIR}"
    minikube start \
        --cpus=${DESIRED_CPUS} \
        --memory=${DESIRED_MEMORY} \
        --disk-size=${DESIRED_DISK} \
        --mount \
        --mount-string="${NAGELFLUH_DATA_DIR}:/mnt/nagelfluh-data" \
        --insecure-registry="10.0.0.0/8" \
        --insecure-registry="192.168.0.0/16" \
        --insecure-registry="172.16.0.0/12" \
        "${START_FLAGS[@]}"
    echo "✓ Minikube started with insecure registry support (allows HTTP registry access)"
fi

# Create static PVs and PVCs backed by the host mount. All persistent data
# (PostgreSQL, MinIO, etc.) lives as subdirectories under the mount point
# and survives minikube delete + recreate.
if minikube status --format='{{.Host}}' 2>/dev/null | grep -q '^Running$'; then
    echo ""
    echo "Setting up persistent host storage inside the VM..."
    minikube ssh -- sudo mkdir -p /mnt/nagelfluh-data/postgres /mnt/nagelfluh-data/minio

    # Ensure namespaces exist for PVCs
    kubectl create namespace nagelfluh --dry-run=client -o yaml | kubectl apply -f -
    kubectl create namespace minio --dry-run=client -o yaml | kubectl apply -f -

    kubectl apply -f k8s/storage/

    echo "✓ Host storage ready — PVC data survives minikube delete"
fi

# Namespace, Kueue operator + quotas/queues, backend RBAC, and the registry image-pull secret
# are all provisioned by the shared routine also used by the remote minikube setup script (see
# docs/plans/done/remote-cluster-provisioning-and-registry.md Phase 2/3) — keeps local dev and remote
# clusters provisioned identically instead of hand-duplicated logic.
echo ""
echo "Provisioning Nagelfluh job prerequisites..."
source "$(dirname "$0")/lib/provision-nagelfluh-jobs.sh"
REGISTRY_PUBLIC_HOST="${REGISTRY_PUBLIC_HOST:-$(hostname -I | awk '{print $1}')}" \
MINIKUBE_CPUS="${DESIRED_CPUS}" \
MINIKUBE_MEMORY="${DESIRED_MEMORY}" \
    provision_nagelfluh_jobs

echo ""
echo "=== ✅ Minikube setup complete! ==="
echo ""
echo "Next steps:"
echo "  1. Build Docker image: ./docker/build.sh"
echo "  2. Run migrations: env/bin/python backend/bin/nagelfluh-migrate"
echo "  3. Start backend: ./backend/run.sh"
echo "  4. Start frontend: ./frontend/run.sh"
echo ""

