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

# Check if Kueue is installed and working
KUEUE_NEEDS_INSTALL=false
if kubectl get namespace kueue-system &> /dev/null 2>&1; then
    echo ""
    echo "Checking existing Kueue installation..."

    # Check if controller is running properly
    if kubectl get deployment -n kueue-system kueue-controller-manager &> /dev/null 2>&1; then
        READY=$(kubectl get deployment -n kueue-system kueue-controller-manager -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
        READY="${READY:-0}"
        if [ "$READY" -eq "0" ]; then
            echo "⚠ Kueue controller not ready - will reinstall"
            KUEUE_NEEDS_INSTALL=true
        else
            echo "✓ Kueue is installed and running"
        fi
    else
        KUEUE_NEEDS_INSTALL=true
    fi
else
    KUEUE_NEEDS_INSTALL=true
fi

# Clean up and reinstall Kueue if needed
if [ "$KUEUE_NEEDS_INSTALL" = true ]; then
    echo ""
    echo "Installing Kueue..."

    # Clean up any existing installation
    if kubectl get namespace kueue-system &> /dev/null 2>&1; then
        echo "Removing old Kueue installation..."

        # Delete APIService objects that point into kueue-system before deleting
        # the namespace. If left behind they cause API discovery failures that
        # permanently block namespace termination (the backing service is gone but
        # Kubernetes keeps trying to enumerate resources via it). These are
        # recreated by the Kueue manifests on reinstall.
        STALE_APISERVICES=$(kubectl get apiservice \
            -o jsonpath='{range .items[?(@.spec.service.namespace=="kueue-system")]}{.metadata.name}{"\n"}{end}' \
            2>/dev/null || true)
        if [ -n "$STALE_APISERVICES" ]; then
            echo "  Removing APIServices pointing into kueue-system (recreated on install)..."
            echo "$STALE_APISERVICES" | xargs kubectl delete apiservice --ignore-not-found=true
        fi

        kubectl delete namespace kueue-system --timeout=60s || true
        if kubectl get namespace kueue-system &> /dev/null 2>&1; then
            echo "❌ kueue-system namespace could not be deleted"
            echo "   Try: kubectl get namespace kueue-system -o yaml to diagnose finalizers"
            exit 1
        fi
        echo "✓ kueue-system namespace terminated"
    fi

    # Install Kueue (using server-side apply to handle large CRDs)
    echo "Installing Kueue v0.16.4..."
    kubectl apply --server-side -f https://github.com/kubernetes-sigs/kueue/releases/download/v0.16.4/manifests.yaml

    # Wait for CRDs to be established
    echo "Waiting for Kueue CRDs to be registered..."
    for i in {1..30}; do
        if kubectl get crd clusterqueues.kueue.x-k8s.io &> /dev/null 2>&1; then
            echo "✓ Kueue CRDs registered"
            break
        fi
        sleep 2
    done

    # Wait for controller to be ready
    echo "Waiting for Kueue controller to be ready..."
    kubectl wait --for=condition=available --timeout=120s deployment/kueue-controller-manager -n kueue-system || {
        echo "⚠ Warning: Kueue controller not ready yet, will retry config later"
    }

    # Extra wait for webhook to stabilize
    sleep 10
fi

# Create namespace if it doesn't exist
echo ""
echo "Creating nagelfluh-jobs namespace..."
if kubectl get namespace nagelfluh-jobs &> /dev/null 2>&1; then
    echo "✓ Namespace nagelfluh-jobs already exists"
else
    kubectl create namespace nagelfluh-jobs
    echo "✓ Created namespace nagelfluh-jobs"
fi

# Wait for Kueue webhook to actually accept TCP connections before applying config.
# Pod readiness only checks port 8081 (/healthz); the webhook TLS listener on port
# 9443 (exposed as 443 via the service) may not be up yet when the pod turns Ready.
# We use `minikube ssh -- nc` to test the actual endpoint from inside the cluster network.
echo ""
echo "Waiting for Kueue webhook to accept connections..."
for i in {1..80}; do
    WEBHOOK_IP=$(kubectl get endpoints kueue-webhook-service -n kueue-system \
        -o jsonpath='{.subsets[0].addresses[0].ip}' 2>/dev/null || true)
    WEBHOOK_PORT=$(kubectl get endpoints kueue-webhook-service -n kueue-system \
        -o jsonpath='{.subsets[0].ports[0].port}' 2>/dev/null || true)
    if [ -n "${WEBHOOK_IP}" ] && [ -n "${WEBHOOK_PORT}" ] && minikube ssh -- nc -z -w2 "${WEBHOOK_IP}" "${WEBHOOK_PORT}" 2>/dev/null; then
        echo "✓ Kueue webhook accepting connections at ${WEBHOOK_IP}:${WEBHOOK_PORT}"
        break
    fi
    if [ "$i" -eq 80 ]; then
        echo "❌ Kueue webhook did not become ready in time"
        exit 1
    fi
    echo "  Waiting... ($i/80)"
    sleep 5
done

# Compute Kueue quotas from Minikube resources.
# Leave ~1 CPU and ~1 GiB for system pods.
export KUEUE_CPU_QUOTA=$(( ${MINIKUBE_CPUS:-4} - 1 ))
KUEUE_MEMORY_GI=$(( (${MINIKUBE_MEMORY:-8192} / 1024) - 1 ))
[ "$KUEUE_CPU_QUOTA" -lt 1 ] && KUEUE_CPU_QUOTA=1
[ "$KUEUE_MEMORY_GI" -lt 1 ] && KUEUE_MEMORY_GI=1
export KUEUE_MEMORY_QUOTA="${KUEUE_MEMORY_GI}Gi"
echo ""
echo "Kueue quotas derived from Minikube resources: CPU=${KUEUE_CPU_QUOTA} cores, memory=${KUEUE_MEMORY_QUOTA}"

# Expand *.yaml.in templates into *.yaml files.
# kubectl apply ignores .yaml.in files; the generated .yaml files are gitignored.
echo ""
echo "Expanding k8s template files..."
find k8s/ -name "*.yaml.in" | while read -r template; do
    output="${template%.in}"
    envsubst '${KUEUE_CPU_QUOTA} ${KUEUE_MEMORY_QUOTA}' < "$template" > "$output"
    echo "  $template → $output"
done

# Apply Kueue configuration with retry
echo ""
echo "Applying Kueue configuration..."
MAX_RETRIES=3
for attempt in $(seq 1 $MAX_RETRIES); do
    if kubectl apply -f k8s/kueue/ 2>&1; then
        echo "✓ Kueue configuration applied"
        break
    else
        if [ $attempt -lt $MAX_RETRIES ]; then
            echo "⚠ Failed to apply config, retrying in 10 seconds... (attempt $attempt/$MAX_RETRIES)"
            sleep 10
        else
            echo "❌ Failed to apply Kueue configuration after $MAX_RETRIES attempts"
            echo "   You may need to run: ./dev/cleanup-minikube.sh && ./dev/setup-minikube.sh"
            exit 1
        fi
    fi
done

echo ""
echo "=== ✅ Minikube setup complete! ==="
echo ""
echo "Next steps:"
echo "  1. Build Docker image: ./docker/build.sh"
echo "  2. Run migrations: env/bin/python backend/bin/nagelfluh-migrate"
echo "  3. Start backend: ./backend/run.sh"
echo "  4. Start frontend: ./frontend/run.sh"
echo ""

