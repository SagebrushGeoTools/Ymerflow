#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/images.env"

MINIO_ROOT_USER="${MINIO_ROOT_USER:-minioadmin}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-minioadmin}"

echo "================================================"
echo "Setting up MinIO in Minikube"
echo "================================================"

# Check if minikube is running
if ! minikube status | grep -q "Running"; then
    echo "Error: Minikube is not running. Start it first with: minikube start"
    exit 1
fi

echo ""
echo "Step 1: Creating namespace..."
echo "----------------------------------------"

kubectl apply -f - <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: minio
EOF

echo ""
echo "Step 2: Ensuring self-signed TLS cert for MinIO..."
echo "----------------------------------------"

# Persist the cert under NAGELFLUH_DATA_DIR so it survives `minikube delete`.
# Level A TLS: encrypt only, no server-identity verification, so SANs don't matter.
NAGELFLUH_DATA_DIR="${NAGELFLUH_DATA_DIR:-$HOME/.nagelfluh/data}"
MINIO_CERT_DIR="${NAGELFLUH_DATA_DIR}/certs/minio"
MINIO_CERT_FILE="${MINIO_CERT_DIR}/public.crt"
MINIO_KEY_FILE="${MINIO_CERT_DIR}/private.key"

if [ ! -f "$MINIO_CERT_FILE" ] || [ ! -f "$MINIO_KEY_FILE" ]; then
    echo "  Generating new self-signed cert at ${MINIO_CERT_DIR}..."
    mkdir -p "$MINIO_CERT_DIR"
    openssl req -x509 -nodes -newkey rsa:2048 \
        -keyout "$MINIO_KEY_FILE" -out "$MINIO_CERT_FILE" \
        -days 3650 -subj "/CN=minio" \
        -addext "subjectAltName=DNS:minio,DNS:minio.minio.svc.cluster.local,DNS:localhost,IP:127.0.0.1" \
        2>/dev/null
    chmod 600 "$MINIO_KEY_FILE"
    echo "  ✓ Cert generated"
else
    echo "  ✓ Reusing persisted cert from ${MINIO_CERT_DIR}"
fi

kubectl create secret tls minio-tls \
    --cert="$MINIO_CERT_FILE" --key="$MINIO_KEY_FILE" \
    -n minio \
    --dry-run=client -o yaml | kubectl apply -f -

echo ""
echo "Step 3: Installing MinIO in minikube..."
echo "----------------------------------------"

# Install MinIO using the official manifest. MinIO auto-serves HTTPS on 9000/9001 once a cert is
# mounted at /root/.minio/certs/{public.crt,private.key} — no extra flag/env needed.
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: minio
  namespace: minio
spec:
  replicas: 1
  selector:
    matchLabels:
      app: minio
  template:
    metadata:
      labels:
        app: minio
    spec:
      containers:
      - name: minio
        image: ${MINIO_IMAGE}
        imagePullPolicy: IfNotPresent
        args:
        - server
        - /data
        - --console-address
        - ":9001"
        env:
        - name: MINIO_ROOT_USER
          value: "${MINIO_ROOT_USER}"
        - name: MINIO_ROOT_PASSWORD
          value: "${MINIO_ROOT_PASSWORD}"
        ports:
        - containerPort: 9000
          name: api
        - containerPort: 9001
          name: console
        volumeMounts:
        - name: data
          mountPath: /data
        - name: tls-certs
          mountPath: /root/.minio/certs
          readOnly: true
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: minio-pvc
      - name: tls-certs
        secret:
          secretName: minio-tls
          items:
          - key: tls.crt
            path: public.crt
          - key: tls.key
            path: private.key
---
apiVersion: v1
kind: Service
metadata:
  name: minio
  namespace: minio
spec:
  type: ClusterIP
  ports:
  - port: 9000
    targetPort: 9000
    name: api
  - port: 9001
    targetPort: 9001
    name: console
  selector:
    app: minio
---
apiVersion: v1
kind: Service
metadata:
  name: minio-nagelfluh
  namespace: nagelfluh-jobs
spec:
  type: ExternalName
  externalName: minio.minio.svc.cluster.local
  ports:
  - port: 9000
    targetPort: 9000
    name: api
EOF

echo "✓ MinIO deployed to minikube"

echo ""
echo "Step 4: Waiting for MinIO to be ready..."
echo "----------------------------------------"

# Wait for MinIO to be ready
kubectl wait --for=condition=available --timeout=300s deployment/minio -n minio

echo "✓ MinIO is running"

echo ""
echo "Step 5: Setting up port-forward..."
echo "----------------------------------------"

# Kill any existing port-forward
pkill -f "kubectl port-forward.*minio.*9000" || true
sleep 2

# Start port-forward in background
kubectl port-forward -n minio svc/minio 9000:9000 >/dev/null 2>&1 &
PF_PID=$!
echo "✓ Port-forward started (PID: $PF_PID)"
echo "  MinIO API: https://localhost:9000 (self-signed cert)"
echo "  To stop: kill $PF_PID"

# Wait for port-forward to be ready
echo "  Waiting for port-forward to be ready..."
for i in $(seq 1 30); do
    if nc -z localhost 9000 2>/dev/null; then
        echo "  Port-forward ready."
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo "Warning: port-forward not ready after 30s"
    fi
    sleep 1
done

echo ""
echo "Step 6: Testing connection..."
echo "----------------------------------------"

# Test connection using Python (skip-verify: cert is self-signed, see test-minio.py)
if command -v python3 &> /dev/null; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if python3 "$SCRIPT_DIR/test-minio.py" "https://localhost:9000" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"; then
        echo "✓ Connection test passed"
    else
        echo "Warning: Connection test failed"
        echo "  Port-forward may still be starting up"
        echo "  Try manually: python3 $SCRIPT_DIR/test-minio.py https://localhost:9000 $MINIO_ROOT_USER $MINIO_ROOT_PASSWORD"
    fi
else
    echo "Warning: python3 not found, skipping connection test"
fi

minio-client --insecure alias set minio "https://localhost:9000" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"

echo ""
echo "================================================"
echo "MinIO Setup Complete!"
echo "================================================"
echo ""
echo "MinIO is now running in minikube:"
echo "  API endpoint: https://localhost:9000 (self-signed cert — clients must skip verification)"
echo "  Console: https://localhost:9001"
echo "  Username: $MINIO_ROOT_USER"
echo "  Password: $MINIO_ROOT_PASSWORD"
echo ""
echo "To use in Nagelfluh, update your config.env:"
echo "  STORAGE_PROTOCOL=s3"
echo "  STORAGE_ENDPOINT=https://localhost:9000"
echo "  STORAGE_BUCKET_PREFIX=nagelfluh-project-"
echo "  STORAGE_TLS_SKIP_VERIFY=true"
echo "  MINIO_ROOT_USER=$MINIO_ROOT_USER"
echo "  MINIO_ROOT_PASSWORD=$MINIO_ROOT_PASSWORD"
echo ""
echo "MinIO will automatically create buckets when you create projects."
echo ""
echo "Useful commands:"
echo "  python3 dev/test-minio.py https://localhost:9000 \$MINIO_ROOT_USER \$MINIO_ROOT_PASSWORD  # Test connection"
echo "  kubectl logs -n minio -l app=minio     # View logs"
echo ""
