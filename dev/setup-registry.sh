#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/images.env"

REGISTRY_USER="${REGISTRY_USER:-nagelfluh}"
REGISTRY_PASSWORD="${REGISTRY_PASSWORD:-nagelfluh}"

echo "================================================"
echo "Setting up Docker Registry in Minikube"
echo "================================================"

# Check if minikube is running
if ! minikube status | grep -q "Running"; then
    echo "Error: Minikube is not running. Start it first with: minikube start"
    exit 1
fi

# Generate a bcrypt htpasswd entry for the registry's HTTP basic auth. Registry v2 requires
# bcrypt (the -apr1/MD5 htpasswd form used by nginx elsewhere in this repo is rejected).
generate_bcrypt_htpasswd() {
    local user="$1" pass="$2"
    if command -v htpasswd >/dev/null 2>&1; then
        htpasswd -Bbn "$user" "$pass"
        return
    fi
    local py=""
    for candidate in "${SCRIPT_DIR}/../env/bin/python3" python3; do
        if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c "import bcrypt" >/dev/null 2>&1; then
            py="$candidate"
            break
        fi
    done
    if [ -z "$py" ]; then
        echo "Error: need 'htpasswd' (apache2-utils) or a Python with 'bcrypt' installed" >&2
        echo "  to hash the registry password. Install apache2-utils, or run ./dev/runall.sh" >&2
        echo "  first so env/bin/python3 (which has bcrypt) exists." >&2
        exit 1
    fi
    "$py" -c "
import bcrypt, sys
user, pw = sys.argv[1], sys.argv[2]
print('%s:%s' % (user, bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()))
" "$user" "$pass"
}

echo ""
echo "Step 1: Creating namespace..."
echo "----------------------------------------"

kubectl apply -f - <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: registry
EOF

echo ""
echo "Step 2: Ensuring self-signed TLS cert for the registry..."
echo "----------------------------------------"

# Persist the cert under NAGELFLUH_DATA_DIR so it survives `minikube delete`.
# Level A TLS: encrypt only, no server-identity verification, so SANs don't matter.
NAGELFLUH_DATA_DIR="${NAGELFLUH_DATA_DIR:-$HOME/.nagelfluh/data}"
REGISTRY_CERT_DIR="${NAGELFLUH_DATA_DIR}/certs/registry"
REGISTRY_CERT_FILE="${REGISTRY_CERT_DIR}/tls.crt"
REGISTRY_KEY_FILE="${REGISTRY_CERT_DIR}/tls.key"

if [ ! -f "$REGISTRY_CERT_FILE" ] || [ ! -f "$REGISTRY_KEY_FILE" ]; then
    echo "  Generating new self-signed cert at ${REGISTRY_CERT_DIR}..."
    mkdir -p "$REGISTRY_CERT_DIR"
    MINIKUBE_IP_FOR_CERT="$(minikube ip 2>/dev/null || echo 127.0.0.1)"
    openssl req -x509 -nodes -newkey rsa:2048 \
        -keyout "$REGISTRY_KEY_FILE" -out "$REGISTRY_CERT_FILE" \
        -days 3650 -subj "/CN=registry" \
        -addext "subjectAltName=DNS:registry,DNS:registry.registry.svc.cluster.local,DNS:localhost,IP:127.0.0.1,IP:${MINIKUBE_IP_FOR_CERT}" \
        2>/dev/null
    chmod 600 "$REGISTRY_KEY_FILE"
    echo "  ✓ Cert generated"
else
    echo "  ✓ Reusing persisted cert from ${REGISTRY_CERT_DIR}"
fi

kubectl create secret tls registry-tls \
    --cert="$REGISTRY_CERT_FILE" --key="$REGISTRY_KEY_FILE" \
    -n registry \
    --dry-run=client -o yaml | kubectl apply -f -

echo ""
echo "Step 3: Setting up registry credentials..."
echo "----------------------------------------"

kubectl create secret generic registry-htpasswd \
    --from-literal=htpasswd="$(generate_bcrypt_htpasswd "$REGISTRY_USER" "$REGISTRY_PASSWORD")" \
    -n registry \
    --dry-run=client -o yaml | kubectl apply -f -
echo "  ✓ Registry credentials secret applied"

echo ""
echo "Step 4: Installing Docker Registry v2 in minikube..."
echo "----------------------------------------"

# Install Docker Registry v2 with TLS + HTTP basic auth
kubectl apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: registry-config
  namespace: registry
data:
  config.yml: |
    version: 0.1
    log:
      fields:
        service: registry
    storage:
      filesystem:
        rootdirectory: /var/lib/registry
      delete:
        enabled: true
    auth:
      htpasswd:
        realm: nagelfluh-registry
        path: /auth/htpasswd
    http:
      addr: :5000
      tls:
        certificate: /certs/tls.crt
        key: /certs/tls.key
      headers:
        X-Content-Type-Options: [nosniff]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: registry
  namespace: registry
spec:
  replicas: 1
  selector:
    matchLabels:
      app: registry
  template:
    metadata:
      labels:
        app: registry
    spec:
      containers:
      - name: registry
        image: ${REGISTRY_IMAGE}
        imagePullPolicy: IfNotPresent
        ports:
        - containerPort: 5000
          name: http
        volumeMounts:
        - name: config
          mountPath: /etc/docker/registry
          readOnly: true
        - name: registry-storage
          mountPath: /var/lib/registry
        - name: tls-certs
          mountPath: /certs
          readOnly: true
        - name: htpasswd
          mountPath: /auth
          readOnly: true
        env:
        - name: REGISTRY_HTTP_SECRET
          value: "nagelfluh-registry-secret"
      volumes:
      - name: config
        configMap:
          name: registry-config
      - name: registry-storage
        emptyDir: {}
      - name: tls-certs
        secret:
          secretName: registry-tls
      - name: htpasswd
        secret:
          secretName: registry-htpasswd
          items:
          - key: htpasswd
            path: htpasswd
---
apiVersion: v1
kind: Service
metadata:
  name: registry
  namespace: registry
spec:
  type: NodePort
  ports:
  - port: 5000
    targetPort: 5000
    nodePort: 30500
    name: http
  selector:
    app: registry
---
apiVersion: v1
kind: Service
metadata:
  name: registry
  namespace: nagelfluh-jobs
spec:
  type: ExternalName
  externalName: registry.registry.svc.cluster.local
  ports:
  - port: 5000
    targetPort: 5000
    name: http
EOF

echo "✓ Docker Registry v2 deployed to minikube"

echo ""
echo "Step 5: Waiting for Registry to be ready..."
echo "----------------------------------------"

# Wait for Registry to be ready
kubectl wait --for=condition=available --timeout=60s deployment/registry -n registry || {
    echo "Warning: Registry deployment not ready after 60s. Check status with:"
    echo "  kubectl get pods -n registry"
}

echo "✓ Docker Registry is running"

echo ""
echo "Step 6: Testing registry..."
echo "----------------------------------------"

# Wait a bit for registry to initialize
sleep 5

# Get minikube IP
MINIKUBE_IP=$(minikube ip)
REGISTRY_URL="https://${MINIKUBE_IP}:30500"

echo "  Testing registry at $REGISTRY_URL..."

# Test registry API (self-signed cert -> -k; auth required -> -u)
if curl -sk -u "${REGISTRY_USER}:${REGISTRY_PASSWORD}" "${REGISTRY_URL}/v2/" | grep -q "{}"; then
    echo "✓ Registry API is responding"
else
    echo "Warning: Registry API test failed"
    echo "  Try manually: curl -sk -u ${REGISTRY_USER}:${REGISTRY_PASSWORD} ${REGISTRY_URL}/v2/"
fi

echo ""
echo "================================================"
echo "Docker Registry Setup Complete!"
echo "================================================"
echo ""
MINIKUBE_IP=$(minikube ip)
echo "Docker Registry is now running in minikube:"
echo "  Registry URL (host and pods): ${MINIKUBE_IP}:30500 (https, self-signed cert)"
echo "  Auth: ${REGISTRY_USER} / ${REGISTRY_PASSWORD}"
echo "  Storage backend: Local filesystem (emptyDir)"
echo ""
echo "To push images from your host:"
echo "  docker login ${MINIKUBE_IP}:30500 -u ${REGISTRY_USER} -p ${REGISTRY_PASSWORD}"
echo "  docker tag myimage:latest ${MINIKUBE_IP}:30500/myimage:latest"
echo "  docker push ${MINIKUBE_IP}:30500/myimage:latest"
echo ""
echo "To use in Nagelfluh pods, use the same URL:"
echo "  ${MINIKUBE_IP}:30500/myimage:latest"
echo ""
echo "Note: This is a development registry. Storage is ephemeral - images are lost if the"
echo "  registry pod restarts. For production, use Google Artifact Registry with tag immutability."
echo ""
echo "Useful commands:"
echo "  kubectl logs -n registry -l app=registry     # View registry logs"
echo "  curl -sk -u ${REGISTRY_USER}:${REGISTRY_PASSWORD} ${REGISTRY_URL}/v2/_catalog  # List all images"
echo ""
