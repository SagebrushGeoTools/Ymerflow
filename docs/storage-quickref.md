# Storage Quick Reference

## Development Setup (One-Time)

```bash
# 1. Install MinIO in minikube
./dev/setup-minio.sh

# 2. Update .env
cat >> .env <<EOF
STORAGE_PROTOCOL=s3
STORAGE_ENDPOINT=http://localhost:9000
STORAGE_BUCKET_PREFIX=nagelfluh-project-
EOF

# 3. Restart backend
./backend/run.sh
```

**Note:** Use `http://localhost:9000` for the backend. Pods get the internal service name injected automatically.

That's it! Storage is now configured.

## After Minikube Restart

### Normal Restart (`minikube stop` → `minikube start`)
✅ MinIO persists (deployment + data)
✅ Buckets and users persist
❌ Port-forward needs restart

```bash
# Easy way: use helper script
./dev/restart-minio-portforward.sh

# Or manually:
kubectl port-forward -n minio svc/minio 9000:9000 &
```

### Full Reset (`minikube delete`)
❌ Everything deleted
❌ All project data lost

```bash
# Run full setup again
./dev/setup-minikube.sh
./dev/setup-minio.sh

# Recreate projects in UI (storage auto-created)
```

## What Happens Automatically

When you create a project in the UI:

1. Backend creates MinIO bucket: `nagelfluh-project-{id}`
2. Backend creates MinIO user: `project-{id}`
3. Backend attaches IAM policy (read uploads/datasets, write processes/{id}/)
4. Backend creates k8s secret: `project-{id}-storage`
5. Process pods get credentials auto-injected

**You don't need to do anything!**

## Common Commands

### Check MinIO Status
```bash
# Check if running
kubectl get pods -n minio

# View logs
kubectl logs -n minio -l app=minio

# Access console
# Open http://localhost:9001 in browser
# Username: minioadmin, Password: minioadmin
```

### Manage Buckets
```bash
# List all buckets
mc ls myminio/

# List bucket contents
mc ls myminio/nagelfluh-project-abc123/

# Tree view
mc tree myminio/nagelfluh-project-abc123/
```

### Manage Users & Policies
```bash
# List users
mc admin user list myminio

# User details
mc admin user info myminio project-abc123

# List policies
mc admin policy list myminio

# Policy details
mc admin policy info myminio project-abc123-policy

# Show which users have a policy
mc admin policy entities myminio project-abc123-policy
```

### Manage K8s Secrets
```bash
# List storage secrets
kubectl get secrets -n nagelfluh-jobs | grep storage

# View secret
kubectl get secret project-abc123-storage -n nagelfluh-jobs -o yaml

# Decode credentials
kubectl get secret project-abc123-storage -n nagelfluh-jobs -o json | \
  jq -r '.data["access-key"]' | base64 -d
```

### Test Storage Access
```bash
# From your machine (using mc)
mc ls myminio/nagelfluh-project-abc123/

# From a pod
kubectl run -it --rm test-storage \
  --image=python:3.11-slim \
  --env="STORAGE_BASE=s3://nagelfluh-project-abc123" \
  --env="STORAGE_ENDPOINT=http://minio-nagelfluh:9000" \
  -- bash -c "
    pip install fsspec s3fs && python3 -c '
    import fsspec, os
    fs = fsspec.filesystem(\"s3\",
      key=\"project-abc123\",
      secret=\"<get-from-secret>\",
      client_kwargs={\"endpoint_url\": os.environ[\"STORAGE_ENDPOINT\"]})
    print(fs.ls(\"nagelfluh-project-abc123\"))
    '
  "
```

## Troubleshooting

### Port-forward not working
```bash
# Easy way: use helper script
./dev/restart-minio-portforward.sh

# Or manually:
pkill -f "kubectl port-forward.*minio"
kubectl port-forward -n minio svc/minio 9000:9000 &
```

### mc can't connect
```bash
# Reconfigure alias
mc alias set myminio http://localhost:9000 minioadmin minioadmin

# Test connection
mc admin info myminio
```

### Project storage failed to create
```bash
# Check backend logs
tail -f backend/logs/*.log | grep -i minio

# Manually create (if needed)
python -c "
from backend.services.minio_service import setup_project_storage
result = setup_project_storage('project-id')
print(result)
"
```

### Pod can't access storage
```bash
# Check secret exists
kubectl get secret project-abc123-storage -n nagelfluh-jobs

# Check pod env vars
kubectl get pod <pod-name> -n nagelfluh-jobs -o yaml | grep -A 10 env:

# Check pod logs
kubectl logs <pod-name> -n nagelfluh-jobs
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│ Frontend (React)                                     │
└────────────────┬────────────────────────────────────┘
                 │ HTTP URLs (e.g., /dataset/123)
                 ▼
┌─────────────────────────────────────────────────────┐
│ Backend (FastAPI)                                    │
│  ├─ Translate HTTP ↔ Storage URLs                   │
│  ├─ Create projects → Setup MinIO storage           │
│  └─ Create pods → Inject STORAGE_BASE env var       │
└────────────────┬────────────────────────────────────┘
                 │ Storage URLs (e.g., s3://bucket/path)
                 ▼
┌─────────────────────────────────────────────────────┐
│ Process Pods                                         │
│  ├─ Read: s3://bucket/processes/*/datasets/*        │
│  └─ Write: s3://bucket/processes/{id}/datasets/*    │
└────────────────┬────────────────────────────────────┘
                 │ S3 API calls (via fsspec)
                 ▼
┌─────────────────────────────────────────────────────┐
│ MinIO (S3-compatible)                                │
│  ├─ Enforce IAM policies                             │
│  ├─ Store files in buckets                           │
│  └─ Return errors if unauthorized                    │
└─────────────────────────────────────────────────────┘
```

## Path Structure

```
s3://nagelfluh-project-{project-id}/
├── uploads/
│   └── {upload-id}/
│       └── filename.csv
└── processes/
    ├── {process-1}/
    │   └── datasets/
    │       ├── {dataset-1}/
    │       │   ├── root.msgpack
    │       │   ├── root.geojson
    │       │   └── parts/
    │       │       ├── part-1.msgpack
    │       │       └── part-1.geojson
    │       └── {dataset-2}/
    │           └── ...
    └── {process-2}/
        └── datasets/
            └── ...
```

## IAM Policy (MinIO)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": [
        "arn:aws:s3:::nagelfluh-project-{id}/uploads/*",
        "arn:aws:s3:::nagelfluh-project-{id}/processes/*/datasets/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": [
        "arn:aws:s3:::nagelfluh-project-{id}/processes/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": ["arn:aws:s3:::nagelfluh-project-{id}"]
    }
  ]
}
```

**What this means:**
- ✅ Can read any upload in the project
- ✅ Can read any dataset in the project (from any process)
- ✅ Can write to its own process directory
- ❌ Cannot write to uploads/ or other processes/
- ❌ Cannot delete files
- ❌ Cannot access other projects' buckets
