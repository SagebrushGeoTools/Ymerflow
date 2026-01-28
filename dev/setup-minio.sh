#!/bin/bash
set -e

echo "================================================"
echo "Setting up MinIO in Minikube"
echo "================================================"

# Check if minikube is running
if ! minikube status | grep -q "Running"; then
    echo "Error: Minikube is not running. Start it first with: minikube start"
    exit 1
fi

echo ""
echo "Step 1: Installing MinIO in minikube..."
echo "----------------------------------------"

# Install MinIO using the official manifest
kubectl apply -f - <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: minio
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: minio-pvc
  namespace: minio
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
---
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
        image: minio/minio:latest
        args:
        - server
        - /data
        - --console-address
        - ":9001"
        env:
        - name: MINIO_ROOT_USER
          value: "minioadmin"
        - name: MINIO_ROOT_PASSWORD
          value: "minioadmin"
        ports:
        - containerPort: 9000
          name: api
        - containerPort: 9001
          name: console
        volumeMounts:
        - name: data
          mountPath: /data
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: minio-pvc
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
echo "Step 2: Waiting for MinIO to be ready..."
echo "----------------------------------------"

# Wait for MinIO to be ready
kubectl wait --for=condition=available --timeout=60s deployment/minio -n minio || {
    echo "Warning: MinIO deployment not ready after 60s. Check status with:"
    echo "  kubectl get pods -n minio"
}

echo "✓ MinIO is running"

echo ""
echo "Step 3: Setting up port-forward..."
echo "----------------------------------------"

# Kill any existing port-forward
pkill -f "kubectl port-forward.*minio.*9000" || true
sleep 2

# Start port-forward in background
kubectl port-forward -n minio svc/minio 9000:9000 >/dev/null 2>&1 &
PF_PID=$!
echo "✓ Port-forward started (PID: $PF_PID)"
echo "  MinIO API: http://localhost:9000"
echo "  To stop: kill $PF_PID"

# Wait for port-forward to be ready
echo "  Waiting for port-forward to be ready..."
sleep 5

echo ""
echo "Step 4: Testing connection..."
echo "----------------------------------------"

# Test connection using Python
if command -v python3 &> /dev/null; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if python3 "$SCRIPT_DIR/test-minio.py" localhost:9000 minioadmin minioadmin; then
        echo "✓ Connection test passed"
    else
        echo "Warning: Connection test failed"
        echo "  Port-forward may still be starting up"
        echo "  Try manually: python3 $SCRIPT_DIR/test-minio.py"
    fi
else
    echo "Warning: python3 not found, skipping connection test"
fi

minio-client alias set minio http://localhost:9000 minioadmin minioadmin

echo ""
echo "================================================"
echo "MinIO Setup Complete!"
echo "================================================"
echo ""
echo "MinIO is now running in minikube:"
echo "  API endpoint: http://localhost:9000"
echo "  Console: http://localhost:9001"
echo "  Username: minioadmin"
echo "  Password: minioadmin"
echo ""
echo "To use in Nagelfluh, update your .env file:"
echo "  STORAGE_PROTOCOL=s3"
echo "  STORAGE_ENDPOINT=http://localhost:9000"
echo "  STORAGE_BUCKET_PREFIX=nagelfluh-project-"
echo "  MINIO_ROOT_USER=minioadmin"
echo "  MINIO_ROOT_PASSWORD=minioadmin"
echo ""
echo "MinIO will automatically create buckets when you create projects."
echo ""
echo "Useful commands:"
echo "  python3 dev/test-minio.py              # Test connection"
echo "  kubectl logs -n minio -l app=minio     # View logs"
echo ""
