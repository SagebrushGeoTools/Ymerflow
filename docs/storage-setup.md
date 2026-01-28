# Storage Setup Guide

This document explains how to set up per-project bucket storage for Nagelfluh in development (MinIO) and production (GCS/S3).

## Quick Start (Development)

For local development with MinIO, storage is **automatically configured**:

1. Run `./dev/setup-minio.sh` once to install MinIO
2. Update `.env` with MinIO settings (see script output)
3. Create projects in the UI - buckets/credentials are auto-created!

The backend automatically:
- Creates a bucket per project
- Creates a user with IAM policy
- Generates k8s secrets
- Injects credentials into process pods

**No manual bucket or user creation needed!**

## Architecture Overview

Nagelfluh uses **per-project buckets** with the following structure:

```
{bucket-prefix}{project-id}/
├── uploads/{upload_id}/              # User-uploaded files
└── processes/{process_id}/
    └── datasets/{dataset_id}/        # Process outputs
        ├── root.msgpack
        ├── root.geojson
        └── parts/
            ├── part1.msgpack
            └── part1.geojson
```

### Security Model

- **IAM-based access control** (not application-level)
- Each process pod gets credentials with:
  - **READ**: `uploads/*` and `processes/*/datasets/*` (all datasets in project)
  - **WRITE**: `processes/{process_id}/*` (only this process's directory)
- No overwrites possible - processes can only write to their own directory
- No file deletion - write-only access

---

## Development Setup (MinIO)

### Prerequisites

- Minikube running
- kubectl installed

### One-Time MinIO Setup

Run the setup script:

```bash
./dev/setup-minio.sh
```

This will:
1. Deploy MinIO to minikube (namespace: `minio`)
2. Install `mc` client if not present
3. Configure `mc` alias as `myminio`
4. Set up port-forwarding to localhost:9000
5. Create ExternalName service for pod access

### Per-Project Storage (Automatic)

**Storage is automatically configured when you create a project!**

The backend (`backend/services/minio_service.py`) automatically:
1. Creates bucket: `nagelfluh-project-{project-id}`
2. Creates user: `project-{project-id}` with random password
3. Creates IAM policy with read/write restrictions
4. Creates k8s secret with credentials
5. Pods automatically get credentials injected

**No manual intervention needed!**

### Manual Verification (Optional)

To verify storage setup for a project:

```bash
PROJECT_ID="abc123"

# Check bucket exists
mc ls myminio/ | grep "nagelfluh-project-${PROJECT_ID}"

# Check user exists
mc admin user info myminio "project-${PROJECT_ID}"

# Check policy attached
mc admin policy entities myminio "project-${PROJECT_ID}-policy"

# Check k8s secret exists
kubectl get secret "project-${PROJECT_ID}-storage" -n nagelfluh-jobs
```

### MinIO IAM Policy Example

The script creates a policy like this:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": [
        "arn:aws:s3:::nagelfluh-project-abc123/uploads/*",
        "arn:aws:s3:::nagelfluh-project-abc123/processes/*/datasets/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": ["arn:aws:s3:::nagelfluh-project-abc123/processes/*"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": ["arn:aws:s3:::nagelfluh-project-abc123"]
    }
  ]
}
```

---

## Production Setup (GCS)

### Prerequisites

- GCP project with GCS enabled
- GKE cluster with Workload Identity enabled
- `gcloud` CLI installed

### 1. Create GCS Bucket

```bash
PROJECT_ID="abc123"
BUCKET_NAME="nagelfluh-project-${PROJECT_ID}"
GCP_PROJECT="your-gcp-project"

# Create bucket
gsutil mb -p ${GCP_PROJECT} -l us-central1 gs://${BUCKET_NAME}

# Enable versioning (optional, for audit trail)
gsutil versioning set on gs://${BUCKET_NAME}
```

### 2. Create GCP Service Account

For each process (or reuse per project):

```bash
PROCESS_ID="process-xyz789"
SA_NAME="nagelfluh-process-${PROCESS_ID}"

gcloud iam service-accounts create ${SA_NAME} \
  --display-name="Nagelfluh Process ${PROCESS_ID}"
```

### 3. Grant IAM Permissions with Conditions

**Read access to uploads and datasets:**

```bash
gcloud storage buckets add-iam-policy-binding gs://${BUCKET_NAME} \
  --member="serviceAccount:${SA_NAME}@${GCP_PROJECT}.iam.gserviceaccount.com" \
  --role="roles/storage.objectViewer" \
  --condition='expression=resource.name.startsWith("projects/_/buckets/'${BUCKET_NAME}'/objects/uploads/") || resource.name.startsWith("projects/_/buckets/'${BUCKET_NAME}'/objects/processes/"),title=read-access'
```

**Write access to process directory only:**

```bash
gcloud storage buckets add-iam-policy-binding gs://${BUCKET_NAME} \
  --member="serviceAccount:${SA_NAME}@${GCP_PROJECT}.iam.gserviceaccount.com" \
  --role="roles/storage.objectCreator" \
  --condition='expression=resource.name.startsWith("projects/_/buckets/'${BUCKET_NAME}'/objects/processes/'${PROCESS_ID}'/"),title=write-access'
```

### 4. Configure Workload Identity

**Bind GCP service account to k8s service account:**

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

### 5. Pod Configuration

The backend automatically configures pods with:

```yaml
spec:
  serviceAccountName: process-xyz789  # k8s SA with Workload Identity binding
  containers:
  - name: process
    env:
    - name: STORAGE_BASE
      value: gs://nagelfluh-project-abc123
    - name: PROJECT_ID
      value: abc123
    - name: PROCESS_ID
      value: process-xyz789
    # No credentials needed - Workload Identity auto-injects
```

---

## Production Setup (AWS S3)

### Prerequisites

- AWS account with S3 enabled
- EKS cluster with IRSA (IAM Roles for Service Accounts) enabled

### 1. Create S3 Bucket

```bash
PROJECT_ID="abc123"
BUCKET_NAME="nagelfluh-project-${PROJECT_ID}"
AWS_REGION="us-east-1"

aws s3 mb s3://${BUCKET_NAME} --region ${AWS_REGION}

# Enable versioning (optional)
aws s3api put-bucket-versioning \
  --bucket ${BUCKET_NAME} \
  --versioning-configuration Status=Enabled
```

### 2. Create IAM Policy

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

### 3. Create IAM Role with IRSA

```bash
PROCESS_ID="process-xyz789"
CLUSTER_NAME="nagelfluh-cluster"
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
OIDC_PROVIDER=$(aws eks describe-cluster --name ${CLUSTER_NAME} --query "cluster.identity.oidc.issuer" --output text | sed -e "s/^https:\/\///")

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

### 4. Configure k8s Service Account

```bash
kubectl create serviceaccount process-${PROCESS_ID} -n nagelfluh-jobs

kubectl annotate serviceaccount process-${PROCESS_ID} \
  -n nagelfluh-jobs \
  eks.amazonaws.com/role-arn=arn:aws:iam::${AWS_ACCOUNT_ID}:role/nagelfluh-process-${PROCESS_ID}
```

---

## Configuration

Update your `.env` file:

**Development (MinIO):**
```bash
STORAGE_PROTOCOL=s3
STORAGE_ENDPOINT=http://minio.nagelfluh.svc.cluster.local:9000
STORAGE_BUCKET_PREFIX=nagelfluh-project-
```

**Production (GCS):**
```bash
STORAGE_PROTOCOL=gcs
STORAGE_ENDPOINT=
STORAGE_BUCKET_PREFIX=nagelfluh-project-
```

**Production (S3):**
```bash
STORAGE_PROTOCOL=s3
STORAGE_ENDPOINT=
STORAGE_BUCKET_PREFIX=nagelfluh-project-
```

---

## Pod Usage

Process pods automatically receive:

```bash
# Environment variables
STORAGE_BASE=s3://nagelfluh-project-abc123  # or gs://...
STORAGE_ENDPOINT=http://minio:9000          # only for MinIO
PROJECT_ID=abc123
PROCESS_ID=process-xyz789

# Credentials (MinIO only, from k8s secret)
AWS_ACCESS_KEY_ID=project-abc123
AWS_SECRET_ACCESS_KEY=***
```

**Pod code:**

```python
import fsspec
import os

base_url = os.environ['STORAGE_BASE']

# Storage kwargs (for MinIO endpoint)
kwargs = {}
if os.environ.get('STORAGE_ENDPOINT'):
    kwargs['client_kwargs'] = {'endpoint_url': os.environ['STORAGE_ENDPOINT']}

# Read dataset
with fsspec.open(f"{base_url}/processes/proc-123/datasets/ds-456/root.msgpack", "rb", **kwargs) as f:
    data = f.read()

# Write output
process_id = os.environ['PROCESS_ID']
output_id = "new-dataset-id"
with fsspec.open(f"{base_url}/processes/{process_id}/datasets/{output_id}/root.msgpack", "wb", **kwargs) as f:
    f.write(result)
```

---

## Troubleshooting

### MinIO Permission Denied

Check policy is attached:
```bash
mc admin policy entities myminio project-abc123-policy
```

Test access:
```bash
mc ls myminio/nagelfluh-project-abc123 --access-key project-abc123 --secret-key ***
```

### GCS Permission Denied

Check IAM bindings:
```bash
gcloud storage buckets get-iam-policy gs://nagelfluh-project-abc123
```

Verify Workload Identity:
```bash
kubectl describe sa process-xyz789 -n nagelfluh-jobs
```

### Pod Can't Access Storage

Check pod logs:
```bash
kubectl logs <pod-name> -n nagelfluh-jobs
```

Verify environment variables:
```bash
kubectl exec <pod-name> -n nagelfluh-jobs -- env | grep STORAGE
```
