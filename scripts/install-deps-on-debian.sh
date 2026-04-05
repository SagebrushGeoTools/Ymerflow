#!/bin/bash
# Install all system dependencies required to develop and run Nagelfluh on Debian/Ubuntu.
# Run once on a fresh machine before running ./dev/runall.sh
#
# Installs:
#   - docker.io            (container runtime, used by minikube)
#   - kubectl              (Kubernetes CLI)
#   - minikube             (local Kubernetes cluster)
#   - mc (MinIO Client)    (used by dev/setup-minio.sh)
#   - Node.js + npm        (frontend build)
#   - Python 3 + venv      (backend virtualenv)
#   - screen               (used by dev/runall.sh to multiplex services)
#   - curl, git            (general tooling)

set -e

# Detect OS
. /etc/os-release
echo "Detected OS: $NAME $VERSION_ID"

ARCH=$(dpkg --print-architecture)
echo "Architecture: $ARCH"

# ==========================================
# 1. Core apt packages
# ==========================================
echo ""
echo "=== Installing apt packages ==="

sudo apt-get update
sudo apt-get install -y \
    curl \
    git \
    screen \
    docker.io \
    docker-compose \
    python3 \
    python3-venv \
    python3-pip \
    nodejs \
    npm \
    apt-transport-https \
    ca-certificates \
    gnupg \
    lsb-release

# Add current user to docker group so minikube/docker work without sudo
if ! groups "$USER" | grep -q docker; then
    echo ""
    echo "Adding $USER to docker group..."
    sudo usermod -aG docker "$USER"
    echo "NOTE: You need to log out and back in (or run 'newgrp docker') for group membership to take effect."
fi

# Start and enable docker daemon
sudo systemctl enable --now docker

# ==========================================
# 2. kubectl
# ==========================================
echo ""
echo "=== Installing kubectl ==="

KUBECTL_VERSION=$(curl -sL https://dl.k8s.io/release/stable.txt)
curl -sLO "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${ARCH}/kubectl"
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl
rm kubectl
echo "kubectl $(kubectl version --client --short 2>/dev/null || kubectl version --client) installed"

# ==========================================
# 3. minikube
# ==========================================
echo ""
echo "=== Installing minikube ==="

curl -sLO "https://storage.googleapis.com/minikube/releases/latest/minikube-linux-${ARCH}"
sudo install -o root -g root -m 0755 "minikube-linux-${ARCH}" /usr/local/bin/minikube
rm "minikube-linux-${ARCH}"
echo "minikube $(minikube version --short) installed"

# ==========================================
# 4. mc (MinIO Client)
# ==========================================
echo ""
echo "=== Installing mc (MinIO Client) ==="

MC_ARCH="$ARCH"
if [ "$ARCH" = "amd64" ]; then MC_ARCH="amd64"; fi
if [ "$ARCH" = "arm64" ]; then MC_ARCH="arm64"; fi

curl -sLO "https://dl.min.io/client/mc/release/linux-${MC_ARCH}/mc"
sudo install -o root -g root -m 0755 mc /usr/local/bin/mc
rm mc
echo "mc $(mc --version) installed"

# ==========================================
# 5. Node.js (LTS via NodeSource, if apt version is too old)
# ==========================================
echo ""
echo "=== Checking Node.js version ==="

NODE_MAJOR=$(node --version 2>/dev/null | sed 's/v\([0-9]*\).*/\1/' || echo 0)
if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "Node.js version too old ($NODE_MAJOR), installing LTS via NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi
echo "Node.js $(node --version), npm $(npm --version)"

# ==========================================
# Done
# ==========================================
echo ""
echo "============================================="
echo "All dependencies installed successfully!"
echo "============================================="
echo ""
echo "Next steps:"
echo "  1. If you were just added to the 'docker' group, log out and back in"
echo "     (or run: newgrp docker)"
echo "  2. Run the full dev setup:"
echo "       ./dev/runall.sh"
echo ""
