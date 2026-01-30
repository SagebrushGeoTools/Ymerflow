#!/bin/bash
set -e

echo "================================================"
echo "Setting up Docker Registry in Minikube"
echo "================================================"

# Check if minikube is running
if ! minikube status | grep -q "Running"; then
    echo "Error: Minikube is not running. Start it first with: minikube start"
    exit 1
fi

echo ""
echo "Step 1: Creating MinIO bucket for registry..."
echo "----------------------------------------"

# Create docker-registry bucket using minio-client
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MINIO_CLIENT="$SCRIPT_DIR/../env/bin/minio-client"

if [ ! -f "$MINIO_CLIENT" ]; then
    echo "Error: minio-client not found at $MINIO_CLIENT"
    echo "Please install it first: pip install minio"
    exit 1
fi

# Configure minio-client alias (assumes MinIO is already running and port-forwarded)
"$MINIO_CLIENT" alias set minio http://localhost:9000 minioadmin minioadmin 2>/dev/null || true

# Create bucket
if "$MINIO_CLIENT" ls minio/docker-registry >/dev/null 2>&1; then
    echo "✓ Bucket 'docker-registry' already exists"
else
    "$MINIO_CLIENT" mb minio/docker-registry
    echo "✓ Created bucket 'docker-registry'"
fi

echo ""
echo "Step 2: Installing Docker Registry v2 in minikube..."
echo "----------------------------------------"

# Install Docker Registry v2 with MinIO backend
kubectl apply -f - <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: registry
---
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
      s3:
        accesskey: minioadmin
        secretkey: minioadmin
        region: us-east-1
        regionendpoint: http://minio-nagelfluh.nagelfluh-jobs.svc.cluster.local:9000
        bucket: docker-registry
        secure: false
        v4auth: true
      delete:
        enabled: false
    http:
      addr: :5000
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
        image: registry:2
        ports:
        - containerPort: 5000
          name: http
        volumeMounts:
        - name: config
          mountPath: /etc/docker/registry
          readOnly: true
        env:
        - name: REGISTRY_HTTP_SECRET
          value: "nagelfluh-registry-secret"
      volumes:
      - name: config
        configMap:
          name: registry-config
---
apiVersion: v1
kind: Service
metadata:
  name: registry
  namespace: registry
spec:
  type: ClusterIP
  ports:
  - port: 5000
    targetPort: 5000
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
echo "Step 2: Waiting for Registry to be ready..."
echo "----------------------------------------"

# Wait for Registry to be ready
kubectl wait --for=condition=available --timeout=60s deployment/registry -n registry || {
    echo "Warning: Registry deployment not ready after 60s. Check status with:"
    echo "  kubectl get pods -n registry"
}

echo "✓ Docker Registry is running"

echo ""
echo "Step 3: Testing registry..."
echo "----------------------------------------"

# Wait a bit for registry to initialize
sleep 5

# Test registry via port-forward
echo "  Setting up temporary port-forward for testing..."
kubectl port-forward -n registry svc/registry 5000:5000 >/dev/null 2>&1 &
PF_PID=$!
sleep 3

# Test registry API
if curl -s http://localhost:5000/v2/ | grep -q "{}"; then
    echo "✓ Registry API is responding"
else
    echo "Warning: Registry API test failed"
    echo "  Try manually: curl http://localhost:5000/v2/"
fi

# Cleanup port-forward
kill $PF_PID 2>/dev/null || true

echo ""
echo "================================================"
echo "Docker Registry Setup Complete!"
echo "================================================"
echo ""
echo "Docker Registry is now running in minikube:"
echo "  Internal endpoint: registry.nagelfluh-jobs.svc.cluster.local:5000"
echo "  Storage backend: MinIO (bucket: docker-registry)"
echo ""
echo "To use in Nagelfluh, update your .env file:"
echo "  REGISTRY_URL=registry:5000"
echo "  REGISTRY_AUTH="
echo ""
echo "Note: This is a development registry with no authentication."
echo "For production, use Google Artifact Registry with tag immutability."
echo ""
echo "Useful commands:"
echo "  kubectl logs -n registry -l app=registry     # View registry logs"
echo "  kubectl port-forward -n registry svc/registry 5000:5000  # Access from localhost"
echo ""
