# Deployment Guide

This guide covers setting up Nagelfluh for development and production environments.

## Prerequisites

- **Python**: 3.11 or higher
- **Node.js**: 16 or higher
- **Docker**: For building process runner images
- **Minikube**: For local Kubernetes development
- **kubectl**: Kubernetes command-line tool

## Deployment Modes

There are two ways to run Nagelfluh, differing in where the backend, frontend, and database live:

| | Dev | Prod |
|---|---|---|
| Backend & frontend | Host machine | Kubernetes pods (inside Minikube) |
| Database | SQLite on host | PostgreSQL in Kubernetes |
| Process jobs | Kubernetes (Minikube) | Kubernetes (Minikube) |
| Storage | MinIO in Minikube | MinIO in Minikube |
| Start command | `./runall.sh` | `./runall.sh` |

## Configuration

Before running for the first time, create `config.env` from the example:

```bash
cp config.env.example config.env
```

Key settings in `config.env`:

```bash
# development = backend/frontend on host, production-minikube = all in Minikube
DEPLOYMENT=development

# Minikube resources
MINIKUBE_CPUS=4
MINIKUBE_MEMORY=8192

# Production only — public URL clients use to reach the app:
# SERVER_URL=http://192.168.1.100:3000

# Admin credentials for pgAdmin and the Kubernetes dashboard (production-minikube only).
# Used once on first run to create the nagelfluh-admin-secret K8s secret.
# ADMIN_USER=admin
# ADMIN_PASSWORD=password
```

`config.env` is gitignored and never committed.

## Quick Start

### Dev Mode

Set `DEPLOYMENT=development` in `config.env` (the default), then:

```bash
./runall.sh
```

Open **http://localhost:3000**. The script starts Minikube, Kueue, MinIO, and the backend and frontend servers.

### Production-Minikube Mode

Set `DEPLOYMENT=production-minikube` in `config.env`, then:

```bash
./runall.sh
```

This is idempotent — safe to re-run after a reboot or upgrade. It handles Minikube, MinIO, PostgreSQL, image builds, migrations, and the socat port forwarder automatically.

By default the app is exposed on port 3000 of the host machine's primary IP (printed at the end of the script). Clients on the network reach it at `http://<host-ip>:3000`.

| URL | Service |
|-----|---------|
| `http://<host-ip>:3000/` | Main application |
| `http://<host-ip>:3000/pgadmin/` | pgAdmin (PostgreSQL GUI) |
| `http://<host-ip>:3000/headlamp/` | Headlamp (Kubernetes / Kueue dashboard) |

#### After a reboot

```bash
./runall.sh   # re-run; it skips steps already done
```

## Manual Setup

If you prefer to set up components individually or troubleshoot issues:

### 1. Minikube Setup

Start Minikube and install Kueue for job queuing:

```bash
./dev/setup-minikube.sh
```

This script:
- Starts Minikube with CPU/RAM from `MINIKUBE_CPUS`/`MINIKUBE_MEMORY` in `config.env` (defaults: 4 CPUs, 8 GB)
- Creates the `nagelfluh-jobs` namespace
- Installs Kueue v0.9.1 (job queuing system)
- Applies Kueue configuration (local queue, cluster queue, resource flavor)
- Is idempotent - safe to run multiple times

**Verify installation:**

```bash
# Check Minikube status
minikube status

# Check Kueue installation
kubectl get crd | grep kueue

# Check namespace
kubectl get ns nagelfluh-jobs

# Check queues
kubectl get localqueue -n nagelfluh-jobs
kubectl get clusterqueue
```

**If setup fails:**

```bash
# Clean up and start over
./dev/cleanup-minikube.sh
./dev/setup-minikube.sh
```

### 2. MinIO Storage Setup

Install MinIO for S3-compatible object storage:

```bash
./dev/setup-minio.sh
```

This script:
- Deploys MinIO to Minikube (namespace: `minio`)
- Creates a 10GB persistent volume
- Sets up port-forwarding to `localhost:9000`
- Installs MinIO client (`mc`) if not present
- Configures `mc` alias as `myminio`
- Creates ExternalName service in `nagelfluh-jobs` namespace

**Configure environment variables:**

Create or update `.env` file in project root:

```bash
STORAGE_PROTOCOL=s3
STORAGE_ENDPOINT=http://localhost:9000
STORAGE_BUCKET_PREFIX=nagelfluh-project-
```

**Verify MinIO:**

```bash
# Check MinIO pods
kubectl get pods -n minio

# Test connection
mc admin info myminio

# List buckets (should be empty initially)
mc ls myminio/
```

**Automatic Per-Project Storage:**

When you create a project in the UI, the backend automatically:

1. Creates MinIO bucket: `nagelfluh-project-{project-id}`
2. Creates MinIO user: `project-{project-id}` with generated password
3. Creates IAM policy with scoped permissions:
   - **READ**: `uploads/*` and `processes/*/datasets/*` (all data in project)
   - **WRITE**: `processes/*` (can write process outputs)
   - **LIST**: Bucket listing
4. Attaches policy to user
5. Creates Kubernetes secret: `project-{project-id}-storage` with credentials
6. Process pods automatically receive injected credentials

**No manual bucket or user creation needed!**

**Example IAM policy:**

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
      "Resource": ["arn:aws:s3:::nagelfluh-project-{id}/processes/*"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": ["arn:aws:s3:::nagelfluh-project-{id}"]
    }
  ]
}
```

### 3. Build Docker Images

Build the base runner image that executes processes:

```bash
./docker/build.sh
```

To build and register a **named environment** (after modifying process types in `docker/base-runner/`):

```bash
./docker/build.sh "My Environment Name"
```

`build.sh` reads `DEPLOYMENT` from `config.env` automatically. In prod mode the database update runs as a Kubernetes Job so `build.sh` never needs direct database access. The environment then appears in the UI's environment selector.

This builds the image directly in Minikube's Docker daemon:
- Based on Python 3.11 slim
- Includes process runner script
- Contains fake process implementations (fft, inversion, etc.)
- Includes process type schemas

**Verify build:**

```bash
# Switch to Minikube's Docker daemon
eval $(minikube docker-env)

# List images
docker images | grep nagelfluh

# You should see: nagelfluh-base-runner:latest
```

### 4. Backend Setup

Install Python dependencies and start the backend:

```bash
# Install dependencies (from project root)
pip install -r backend/requirements.txt

# Download MinIO client for bucket management
wget https://dl.min.io/client/mc/release/linux-amd64/mc -O env/bin/minio-client
chmod +x env/bin/minio-client

# Run database migrations (creates tables and default environment)
alembic -c backend/alembic.ini upgrade head

# Start backend server
./backend/run.sh
```

Backend runs on http://localhost:8000

**Verify backend:**

```bash
# Check health endpoint
curl http://localhost:8000/

# Check API docs
open http://localhost:8000/docs

# List process types
curl http://localhost:8000/process-types
```

### 5. Frontend Setup

Install Node.js dependencies and start development server:

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm start
```

Frontend runs on http://localhost:3000

**Verify frontend:**

Open browser to http://localhost:3000 and verify:
- UI loads without errors
- Can see "Select Environment" dropdown
- Console shows no errors

## After Minikube Restart

### Normal Restart (`minikube stop` → `minikube start`)

Everything persists, just restart the port-forward:

```bash
./dev/restart-minio-portforward.sh

# Or manually:
kubectl port-forward -n minio svc/minio 9000:9000 &
```

### Full Reset (`minikube delete`)

All data is lost. Run full setup again:

```bash
./dev/setup-minikube.sh
./dev/setup-minio.sh
./docker/build.sh
alembic -c backend/alembic.ini upgrade head
```

## Production Deployment

### Cloud Storage

#### Google Cloud Storage (GCS)

For production deployments on GCP, use per-project GCS buckets with Workload Identity.

**1. Create GCS bucket per project:**

```bash
PROJECT_ID="abc123"
BUCKET_NAME="nagelfluh-project-${PROJECT_ID}"
GCP_PROJECT="your-gcp-project"
REGION="us-central1"

# Create bucket
gsutil mb -p ${GCP_PROJECT} -l ${REGION} gs://${BUCKET_NAME}

# Enable versioning (optional, for audit trail)
gsutil versioning set on gs://${BUCKET_NAME}
```

**2. Create service account per process (or reuse per project):**

```bash
PROCESS_ID="process-xyz789"
SA_NAME="nagelfluh-process-${PROCESS_ID}"

gcloud iam service-accounts create ${SA_NAME} \
  --project=${GCP_PROJECT} \
  --display-name="Nagelfluh Process ${PROCESS_ID}"
```

**3. Grant scoped IAM permissions:**

Read access to uploads and datasets:

```bash
gcloud storage buckets add-iam-policy-binding gs://${BUCKET_NAME} \
  --member="serviceAccount:${SA_NAME}@${GCP_PROJECT}.iam.gserviceaccount.com" \
  --role="roles/storage.objectViewer" \
  --condition='expression=resource.name.startsWith("projects/_/buckets/'${BUCKET_NAME}'/objects/uploads/") || resource.name.startsWith("projects/_/buckets/'${BUCKET_NAME}'/objects/processes/"),title=read-access'
```

Write access to process directory only:

```bash
gcloud storage buckets add-iam-policy-binding gs://${BUCKET_NAME} \
  --member="serviceAccount:${SA_NAME}@${GCP_PROJECT}.iam.gserviceaccount.com" \
  --role="roles/storage.objectCreator" \
  --condition='expression=resource.name.startsWith("projects/_/buckets/'${BUCKET_NAME}'/objects/processes/'${PROCESS_ID}'/"),title=write-access'
```

**4. Configure Workload Identity:**

```bash
K8S_SA_NAME="process-${PROCESS_ID}"
K8S_NAMESPACE="nagelfluh-jobs"

# Create k8s service account
kubectl create serviceaccount ${K8S_SA_NAME} -n ${K8S_NAMESPACE}

# Annotate k8s SA with GCP SA
kubectl annotate serviceaccount ${K8S_SA_NAME} \
  -n ${K8S_NAMESPACE} \
  iam.gke.io/gcp-service-account=${SA_NAME}@${GCP_PROJECT}.iam.gserviceaccount.com

# Allow k8s SA to impersonate GCP SA
gcloud iam service-accounts add-iam-policy-binding \
  ${SA_NAME}@${GCP_PROJECT}.iam.gserviceaccount.com \
  --role roles/iam.workloadIdentityUser \
  --member "serviceAccount:${GCP_PROJECT}.svc.id.goog[${K8S_NAMESPACE}/${K8S_SA_NAME}]"
```

**5. Update backend configuration:**

```bash
STORAGE_PROTOCOL=gcs
STORAGE_ENDPOINT=              # Empty for GCS
STORAGE_BUCKET_PREFIX=nagelfluh-project-
```

Pods will automatically use Workload Identity - no explicit credentials needed.

#### AWS S3

For production deployments on AWS, use per-project S3 buckets with IRSA (IAM Roles for Service Accounts).

**1. Create S3 bucket per project:**

```bash
PROJECT_ID="abc123"
BUCKET_NAME="nagelfluh-project-${PROJECT_ID}"
AWS_REGION="us-east-1"

# Create bucket
aws s3 mb s3://${BUCKET_NAME} --region ${AWS_REGION}

# Enable versioning (optional)
aws s3api put-bucket-versioning \
  --bucket ${BUCKET_NAME} \
  --versioning-configuration Status=Enabled
```

**2. Create IAM policy with scoped permissions:**

```bash
POLICY_NAME="nagelfluh-project-${PROJECT_ID}-policy"

cat > /tmp/policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": [
        "arn:aws:s3:::${BUCKET_NAME}/uploads/*",
        "arn:aws:s3:::${BUCKET_NAME}/processes/*/datasets/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": ["arn:aws:s3:::${BUCKET_NAME}/processes/*"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": ["arn:aws:s3:::${BUCKET_NAME}"]
    }
  ]
}
EOF

aws iam create-policy \
  --policy-name ${POLICY_NAME} \
  --policy-document file:///tmp/policy.json
```

**3. Create IAM role with IRSA:**

```bash
PROCESS_ID="process-xyz789"
CLUSTER_NAME="nagelfluh-cluster"
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
OIDC_PROVIDER=$(aws eks describe-cluster --name ${CLUSTER_NAME} \
  --query "cluster.identity.oidc.issuer" --output text | sed -e "s/^https:\/\///")

# Create trust policy
cat > /tmp/trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/${OIDC_PROVIDER}"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "${OIDC_PROVIDER}:sub": "system:serviceaccount:nagelfluh-jobs:process-${PROCESS_ID}"
        }
      }
    }
  ]
}
EOF

# Create IAM role
aws iam create-role \
  --role-name nagelfluh-process-${PROCESS_ID} \
  --assume-role-policy-document file:///tmp/trust-policy.json

# Attach policy to role
aws iam attach-role-policy \
  --role-name nagelfluh-process-${PROCESS_ID} \
  --policy-arn arn:aws:iam::${AWS_ACCOUNT_ID}:policy/${POLICY_NAME}
```

**4. Configure Kubernetes service account:**

```bash
kubectl create serviceaccount process-${PROCESS_ID} -n nagelfluh-jobs

kubectl annotate serviceaccount process-${PROCESS_ID} \
  -n nagelfluh-jobs \
  eks.amazonaws.com/role-arn=arn:aws:iam::${AWS_ACCOUNT_ID}:role/nagelfluh-process-${PROCESS_ID}
```

**5. Update backend configuration:**

```bash
STORAGE_PROTOCOL=s3
STORAGE_ENDPOINT=              # Empty for AWS S3
STORAGE_BUCKET_PREFIX=nagelfluh-project-
```

Pods will automatically use IRSA - no explicit credentials needed.

### Kubernetes Cluster

#### GKE (Google Kubernetes Engine)

```bash
# Create cluster
gcloud container clusters create nagelfluh \
  --region=$REGION \
  --num-nodes=3 \
  --machine-type=n1-standard-4 \
  --enable-autoscaling \
  --min-nodes=1 \
  --max-nodes=10 \
  --workload-pool=$GCP_PROJECT.svc.id.goog

# Install Kueue
kubectl apply --server-side -f https://github.com/kubernetes-sigs/kueue/releases/download/v0.9.1/manifests.yaml

# Create namespace and queues
kubectl create namespace nagelfluh-jobs
kubectl apply -f k8s/kueue-config.yaml
```

#### EKS (Amazon Elastic Kubernetes Service)

```bash
# Create cluster
eksctl create cluster \
  --name nagelfluh \
  --region=$REGION \
  --nodegroup-name standard-workers \
  --node-type m5.xlarge \
  --nodes 3 \
  --nodes-min 1 \
  --nodes-max 10

# Install Kueue
kubectl apply --server-side -f https://github.com/kubernetes-sigs/kueue/releases/download/v0.9.1/manifests.yaml

# Create namespace and queues
kubectl create namespace nagelfluh-jobs
kubectl apply -f k8s/kueue-config.yaml
```

### Database

#### PostgreSQL Setup

For production, use PostgreSQL instead of SQLite:

1. **Install PostgreSQL:**

```bash
# GKE using Cloud SQL
gcloud sql instances create nagelfluh-db \
  --tier=db-f1-micro \
  --region=$REGION

gcloud sql databases create nagelfluh \
  --instance=nagelfluh-db

# Create user
gcloud sql users create nagelfluh \
  --instance=nagelfluh-db \
  --password=<secure-password>
```

2. **Update backend configuration:**

```bash
DATABASE_URL=postgresql://nagelfluh:<password>@<db-host>:5432/nagelfluh
```

3. **Run migrations:**

```bash
alembic -c backend/alembic.ini upgrade head
```

### Backend Deployment

#### Docker Image

```dockerfile
# backend/Dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Build and push:

```bash
docker build -t gcr.io/$GCP_PROJECT/nagelfluh-backend:latest backend/
docker push gcr.io/$GCP_PROJECT/nagelfluh-backend:latest
```

#### Kubernetes Deployment

```yaml
# k8s/backend-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nagelfluh-backend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nagelfluh-backend
  template:
    metadata:
      labels:
        app: nagelfluh-backend
    spec:
      containers:
      - name: backend
        image: gcr.io/$GCP_PROJECT/nagelfluh-backend:latest
        ports:
        - containerPort: 8000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: nagelfluh-secrets
              key: database-url
        - name: STORAGE_PROTOCOL
          value: "gcs"
        - name: STORAGE_BUCKET_PREFIX
          value: "nagelfluh-project-"
```

Apply:

```bash
kubectl apply -f k8s/backend-deployment.yaml
kubectl apply -f k8s/backend-service.yaml
```

### Frontend Deployment

#### Build Production Bundle

```bash
cd frontend
npm run build
```

#### Serve with Nginx

```dockerfile
# frontend/Dockerfile
FROM node:16 as build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

Build and deploy:

```bash
docker build -t gcr.io/$GCP_PROJECT/nagelfluh-frontend:latest frontend/
docker push gcr.io/$GCP_PROJECT/nagelfluh-frontend:latest
kubectl apply -f k8s/frontend-deployment.yaml
```

## Admin Tools (production-minikube only)

In production-minikube mode, two web-based admin GUIs are deployed automatically and proxied by the nginx frontend pod.

### Architecture

```
Browser → nginx (frontend pod)
            /pgadmin/  → pgadmin pod (nagelfluh ns, port 80)
            /headlamp/ → headlamp pod (headlamp ns, port 4466)
```

Both paths are protected by nginx HTTP basic auth. The credentials are stored in the `nagelfluh-admin-secret` Kubernetes secret (key: `htpasswd`), which is mounted into the frontend pod at `/etc/nginx/htpasswd/admin.htpasswd`.

### pgAdmin

| | |
|---|---|
| URL | `<SERVER_URL>/pgadmin/` |
| Login | `<ADMIN_USER>@localhost` / `<ADMIN_PASSWORD>` |
| Image | `dpage/pgadmin4:latest` |
| Namespace | `nagelfluh` |

The Nagelfluh PostgreSQL server (`postgres.nagelfluh.svc.cluster.local:5432`) is pre-configured via a mounted `servers.json` ConfigMap. On first connection you will be prompted for the database password (`nagelfluhpass`).

pgAdmin is configured with `SCRIPT_NAME=/pgadmin` so it generates correct URLs when sitting behind the nginx subpath proxy.

### Headlamp (Kubernetes / Kueue dashboard)

| | |
|---|---|
| URL | `<SERVER_URL>/headlamp/` |
| Login | nginx basic auth only — `<ADMIN_USER>` / `<ADMIN_PASSWORD>` |
| Image | `ghcr.io/headlamp-k8s/headlamp:latest` |
| Namespace | `headlamp` |

Headlamp runs in-cluster with a `cluster-admin` ClusterRoleBinding, so it can display all resources including Kueue `ClusterQueue`, `LocalQueue`, and `Workload` objects. It is started with `--base-url /headlamp` for subpath compatibility.

### Credentials

Credentials are read from `config.env` and written into a K8s secret once on first run:

```bash
# config.env
ADMIN_USER=admin        # default
ADMIN_PASSWORD=password # default — change this in production
```

To rotate credentials after the secret has been created:

```bash
kubectl delete secret nagelfluh-admin-secret -n nagelfluh
# Update ADMIN_USER / ADMIN_PASSWORD in config.env, then:
./runall.sh
```

### Kubernetes manifests

| File | Purpose |
|------|---------|
| `k8s/pgadmin/deployment.yaml` | pgAdmin pod |
| `k8s/pgadmin/service.yaml` | ClusterIP service |
| `k8s/pgadmin/servers-configmap.yaml` | Pre-configured PostgreSQL connection |
| `k8s/headlamp/rbac.yaml` | ServiceAccount + ClusterRoleBinding |
| `k8s/headlamp/deployment.yaml` | Headlamp pod |
| `k8s/headlamp/service.yaml` | ClusterIP service |

## Troubleshooting

### Minikube Issues

**Minikube won't start:**

```bash
# Delete and recreate
minikube delete
minikube start --cpus=4 --memory=8192
```

**Kueue installation fails ("metadata.annotations: Too long"):**

```bash
# Fixed in setup scripts using server-side apply
./dev/cleanup-minikube.sh
./dev/setup-minikube.sh
```

### MinIO Issues

**Port-forward not working:**

```bash
# Kill existing port-forwards
pkill -f "kubectl port-forward.*minio"

# Restart
kubectl port-forward -n minio svc/minio 9000:9000 &
```

**MinIO pods not running:**

```bash
# Check logs
kubectl logs -n minio -l app=minio

# Restart deployment
kubectl rollout restart deployment/minio -n minio
```

**Connection refused:**

```bash
# Check if port-forward is running
ps aux | grep "port-forward.*minio"

# Verify MinIO service
kubectl get svc -n minio
```

### Job Not Starting

**Check Kueue workload:**

```bash
kubectl get workloads -n nagelfluh-jobs
kubectl describe workload <workload-name> -n nagelfluh-jobs
```

**Check events:**

```bash
kubectl get events -n nagelfluh-jobs --sort-by='.lastTimestamp'
```

**Check job:**

```bash
kubectl describe job <job-name> -n nagelfluh-jobs
```

### Image Pull Errors

**Verify image exists:**

```bash
eval $(minikube docker-env)
docker images | grep nagelfluh
```

**Rebuild if missing:**

```bash
./docker/build.sh
```

### Backend Connection Issues

**Check Kubernetes connectivity:**

```bash
kubectl cluster-info
kubectl get nodes
```

**Verify kubeconfig:**

```bash
export KUBECONFIG=~/.kube/config
kubectl config current-context
```

### Storage Permission Errors

**Check Kubernetes secret:**

```bash
kubectl get secret project-<project-id>-storage -n nagelfluh-jobs -o yaml
```

**Test storage access:**

```bash
kubectl exec -it <pod-name> -n nagelfluh-jobs -- python3 -c "
import fsspec, os
fs = fsspec.filesystem('s3',
    key=os.environ['AWS_ACCESS_KEY_ID'],
    secret=os.environ['AWS_SECRET_ACCESS_KEY'],
    client_kwargs={'endpoint_url': os.environ.get('STORAGE_ENDPOINT')})
print(fs.ls('nagelfluh-project-<project-id>'))
"
```

**Verify MinIO user/policy:**

```bash
mc admin user info myminio project-<project-id>
mc admin policy entities myminio project-<project-id>-policy
```

### Database Migration Errors

**Check migration status:**

```bash
alembic -c backend/alembic.ini current
alembic -c backend/alembic.ini history
```

**Reset database (DANGER - loses all data):**

```bash
rm backend/nagelfluh.db
alembic -c backend/alembic.ini upgrade head
```

**Rollback migration:**

```bash
alembic -c backend/alembic.ini downgrade -1
```

## Monitoring

### View Logs

**Backend logs:**

```bash
# If running with run.sh
tail -f backend/logs/uvicorn.log

# If in Kubernetes
kubectl logs -f deployment/nagelfluh-backend
```

**Frontend logs:**

```bash
# Development server
# Logs appear in terminal where npm start was run

# Production (nginx)
kubectl logs -f deployment/nagelfluh-frontend
```

**Process pod logs:**

```bash
# Find pod
kubectl get pods -n nagelfluh-jobs

# Stream logs
kubectl logs -f <pod-name> -n nagelfluh-jobs
```

### Resource Usage

**Cluster resources:**

```bash
kubectl top nodes
kubectl top pods -n nagelfluh-jobs
```

**Storage usage:**

```bash
# MinIO
mc du myminio/

# GCS
gsutil du -s gs://nagelfluh-project-*
```

## Cleanup

### Stop All Services

```bash
./dev/stop-all.sh
```

### Clean Up Minikube

```bash
# Remove Nagelfluh resources only
./dev/cleanup-minikube.sh

# Complete cluster deletion
minikube delete
```

### Clean Up Database

```bash
# Remove SQLite database
rm backend/nagelfluh.db

# Recreate tables
alembic -c backend/alembic.ini upgrade head
```
