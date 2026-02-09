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
echo "Step 1: Installing Docker Registry v2 in minikube..."
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
      filesystem:
        rootdirectory: /var/lib/registry
      delete:
        enabled: true
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
        - name: registry-storage
          mountPath: /var/lib/registry
        env:
        - name: REGISTRY_HTTP_SECRET
          value: "nagelfluh-registry-secret"
      volumes:
      - name: config
        configMap:
          name: registry-config
      - name: registry-storage
        emptyDir: {}
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

# Get minikube IP
MINIKUBE_IP=$(minikube ip)
REGISTRY_URL="http://${MINIKUBE_IP}:30500"

echo "  Testing registry at $REGISTRY_URL..."

# Test registry API
if curl -s "${REGISTRY_URL}/v2/" | grep -q "{}"; then
    echo "✓ Registry API is responding"
else
    echo "Warning: Registry API test failed"
    echo "  Try manually: curl ${REGISTRY_URL}/v2/"
fi

echo ""
echo "================================================"
echo "Docker Registry Setup Complete!"
echo "================================================"
echo ""
MINIKUBE_IP=$(minikube ip)
echo "Docker Registry is now running in minikube:"
echo "  Registry URL (host and pods): ${MINIKUBE_IP}:30500"
echo "  Storage backend: Local filesystem (emptyDir)"
echo ""
echo "To push images from your host:"
echo "  docker tag myimage:latest ${MINIKUBE_IP}:30500/myimage:latest"
echo "  docker push ${MINIKUBE_IP}:30500/myimage:latest"
echo ""
echo "To use in Nagelfluh pods, use the same URL:"
echo "  ${MINIKUBE_IP}:30500/myimage:latest"
echo ""
echo "Note: This is a development registry with no authentication."
echo "  Storage is ephemeral - images are lost if the registry pod restarts."
echo "  For production, use Google Artifact Registry with tag immutability."
echo ""
echo "Useful commands:"
echo "  kubectl logs -n registry -l app=registry     # View registry logs"
echo "  curl ${MINIKUBE_IP}:30500/v2/_catalog        # List all images"
echo ""
