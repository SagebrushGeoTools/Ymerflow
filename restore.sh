#!/bin/bash
set -e

cd "$(dirname "$0")"

BACKUP_DIR="${1:-}"
if [ -z "$BACKUP_DIR" ]; then
    echo "Usage: $0 <backup_dir>"
    echo ""
    echo "Available backups:"
    ls -d backup_* 2>/dev/null | sort -r || echo "  (none)"
    exit 1
fi

if [ ! -d "$BACKUP_DIR" ]; then
    echo "Error: backup directory not found: $BACKUP_DIR"
    exit 1
fi

echo "=== Nagelfluh Restore from $BACKUP_DIR ==="
echo ""

# --- PostgreSQL ---
echo "Restoring PostgreSQL..."

# Scale backend to 0 so there are no active DB connections during restore
kubectl scale deployment/backend -n nagelfluh --replicas=0
kubectl wait pod -n nagelfluh -l app=backend --for=delete --timeout=60s 2>/dev/null || true

kubectl exec -i -n nagelfluh statefulset/postgres -- \
    psql -U nagelfluh --single-transaction nagelfluh \
    < "$BACKUP_DIR/postgres.sql"

kubectl scale deployment/backend -n nagelfluh --replicas=1
echo "  ✓ PostgreSQL"

# --- MinIO ---
echo "Restoring MinIO..."

# Scale MinIO to 0 so the PVC is free for the helper pod
kubectl scale deployment/minio -n minio --replicas=0
kubectl wait pod -n minio -l app=minio --for=delete --timeout=60s 2>/dev/null || true

# Spin up a helper pod that mounts the PVC directly
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: minio-restore-helper
  namespace: minio
spec:
  restartPolicy: Never
  containers:
  - name: helper
    image: busybox
    command: ["sleep", "3600"]
    volumeMounts:
    - name: data
      mountPath: /data
  volumes:
  - name: data
    persistentVolumeClaim:
      claimName: minio-pvc
EOF
kubectl wait pod/minio-restore-helper -n minio --for=condition=Ready --timeout=60s

# Clear existing data, then restore
kubectl exec -n minio minio-restore-helper -- sh -c "rm -rf /data && mkdir /data"
kubectl exec -i -n minio minio-restore-helper -- tar xzf - -C /  < "$BACKUP_DIR/minio.tar.gz"

kubectl delete pod minio-restore-helper -n minio --wait=false

kubectl scale deployment/minio -n minio --replicas=1
kubectl rollout status deployment/minio -n minio --timeout=60s
echo "  ✓ MinIO"

echo ""
echo "Done"
