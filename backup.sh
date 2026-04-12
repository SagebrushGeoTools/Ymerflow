#!/bin/bash
set -e

cd "$(dirname "$0")"

BACKUP_DIR="backup_$(date +%Y%m%d_%H%M%S)"
mkdir "$BACKUP_DIR"

echo "=== Nagelfluh Backup → $BACKUP_DIR ==="
echo ""

echo "Backing up PostgreSQL..."
kubectl exec -n nagelfluh statefulset/postgres -- \
    pg_dump -U nagelfluh --clean --if-exists --no-owner --no-privileges nagelfluh \
    > "$BACKUP_DIR/postgres.sql"
echo "  ✓ $(wc -l < "$BACKUP_DIR/postgres.sql") lines"

echo "Backing up MinIO..."
kubectl exec -n minio deployment/minio -- \
    tar czf - -C / data \
    > "$BACKUP_DIR/minio.tar.gz"
echo "  ✓ $(du -sh "$BACKUP_DIR/minio.tar.gz" | cut -f1)"

echo ""
echo "Done: $BACKUP_DIR"
