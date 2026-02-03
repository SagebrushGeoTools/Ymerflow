# Nagelfluh Geophysics

![](frontend/public/Nagelfluh.jpg)

A geophysics data processing application with a React frontend and FastAPI backend. Provides a flexible, drag-and-drop layout system for managing data processing workflows, visualizing results with Plotly charts, and configuring process parameters via JSON Schema forms.

Processes are executed in Kubernetes containers with resource limits, job queuing (Kueue), and usage-based billing.

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 16+
- Docker
- Minikube (for local development)
- kubectl

### 1. Setup Minikube and Kubernetes

```bash
# Start minikube, create namespace, install Kueue
./dev/setup-minikube.sh
```

This will:
- Start minikube with 4 CPUs and 8GB RAM (if not already running)
- Check if Kueue is properly installed (reinstalls if broken)
- Create the `nagelfluh-jobs` namespace
- Install Kueue (v0.9.1) if needed
- Apply Kueue configuration with retry logic
- Script is idempotent - safe to run multiple times

**If setup fails or gets stuck:**
```bash
# Clean up everything and start over
./dev/cleanup-minikube.sh
./dev/setup-minikube.sh
```

### 1.5. Setup MinIO for Storage (Development)

```bash
# Install and configure MinIO in minikube
./dev/setup-minio.sh
```

This will:
- Deploy MinIO to minikube (namespace: `minio`)
- Create a 10GB persistent volume for storage
- Set up port-forwarding (localhost:9000 → MinIO API)
- Install MinIO client (`mc`) if not present
- Configure `mc` alias as `myminio`
- Create ExternalName service in `nagelfluh-jobs` namespace

**Update `.env` file:**
```bash
STORAGE_PROTOCOL=s3
STORAGE_ENDPOINT=http://localhost:9000
STORAGE_BUCKET_PREFIX=nagelfluh-project-
```

**Note:** Use `http://localhost:9000` for the backend (via port-forward). Pods use the internal service name automatically.

**Buckets and credentials are automatically created when you create projects in the UI. No manual setup needed!**

#### After Restarting Minikube

**Normal restart (`minikube stop` → `minikube start`):**
- MinIO and data persist automatically
- Just restart the port-forward:
  ```bash
  kubectl port-forward -n minio svc/minio 9000:9000 &
  ```

**Full reset (`minikube delete`):**
- Everything is deleted, run full setup again:
  ```bash
  ./dev/setup-minikube.sh
  ./dev/setup-minio.sh
  ```

### 2. Build Base Docker Image

```bash
# Build the base runner image with fake processes
./docker/build.sh
```

This builds the Docker image directly in minikube's Docker daemon:
- Python 3.11 slim base
- Process runner script
- Fake process implementations (fft, inversion, create_environment)
- Script is idempotent - safe to run multiple times

### 3. Setup Backend

```bash
# Install Python dependencies (from project root)
pip install -r backend/requirements.txt
wget https://dl.min.io/client/mc/release/linux-amd64/mc -O env/bin/minio-client

# Run database migrations (creates default Bootstrap environment)
alembic -c backend/alembic.ini upgrade head

# Start the backend server
./backend/run.sh
```

Backend runs on `http://localhost:8000`

### 4. Setup Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start development server
./run.sh
```

Frontend runs on `http://localhost:3000`

## Creating and Running Processes

1. Open `http://localhost:3000` in your browser
2. Select an environment (e.g., "Bootstrap")
3. Choose a process type (e.g., "fft")
4. Enter a process name
5. Configure resources:
   - **CPU**: 0.1 - 8 cores (default: 1 core)
   - **Memory**: 0.5 - 32 GB (default: 2 GB)
   - **Deadline**: 1 - 1440 minutes (default: 60 minutes)
6. See estimated max cost (funds held upfront)
7. Fill in process parameters
8. Click "Submit" to create and run the process

The process will:
- Create a Kubernetes Job in the `nagelfluh-jobs` namespace
- Queue via Kueue if resources unavailable
- Stream logs to the ProcessLog widget in real-time
- Charge actual cost based on runtime on completion
- Release unused held funds

## Monitoring Processes

### In the UI

- **FlowView**: Visual graph of processes and their dependencies
- **ProcessLog**: Real-time log streaming with status badges
- **ProcessEditor**: View/edit parameters, create new versions

### Via kubectl

```bash
# Check jobs
kubectl get jobs -n nagelfluh-jobs

# Check pods
kubectl get pods -n nagelfluh-jobs

# Check Kueue workloads
kubectl get workloads -n nagelfluh-jobs

# View job details
kubectl describe job <job-name> -n nagelfluh-jobs

# Stream logs
kubectl logs -f <pod-name> -n nagelfluh-jobs
```

## Billing System

Processes use a **hold/release** billing model:

1. **On creation**: Calculate max cost based on deadline + resource limits
   - Check user balance ≥ max cost
   - Create HOLD transaction (reserves funds)

2. **On completion/failure**: Charge actual usage
   - Calculate actual cost = (CPU cores × runtime × $0.0001) + (Memory GB × runtime × $0.00002)
   - Create DEBIT transaction for actual cost
   - Create RELEASE transaction to free held funds
   - Update user balance

**Example costs:**
- 1 core, 2 GB, 60-minute deadline: ~$0.0024 max (5-second runtime: ~$0.0006 actual)
- 4 cores, 8 GB, 120-minute deadline: ~$0.0384 max

## Architecture

```
Frontend (React) → Backend (FastAPI) → Kubernetes Cluster
                                       ├─> Kueue → Job → Pod (process execution)
                                       ├─> Log streaming via WebSocket
                                       └─> MinIO (development) / GCS/S3 (production)
                                           └─> Per-project buckets with IAM
```

### Storage Architecture

Nagelfluh uses **per-project buckets** with IAM-enforced security:

**Bucket Structure:**
```
s3://nagelfluh-project-{project-id}/
├── uploads/{upload-id}/              # User-uploaded files
└── processes/{process-id}/
    └── datasets/{dataset-id}/        # Process outputs
        ├── root.msgpack
        ├── root.geojson
        └── parts/*.msgpack
```

**Security Model:**
- Each process pod gets credentials with:
  - **READ**: All uploads and datasets in the project
  - **WRITE**: Only to its own process directory
- No overwrites possible - processes write to unique directories
- IAM enforced at storage layer (MinIO/GCS/S3)

**Development (MinIO):**
- S3-compatible storage in minikube
- Automatic bucket/user/policy creation on project creation
- Credentials injected via k8s secrets

**Production (GCS/S3):**
- Cloud storage with Workload Identity (GCS) or IRSA (AWS)
- IAM policies with path-based conditions
- No explicit credentials needed (auto-detected)

**Process Pods:**
```python
import fsspec, os

base = os.environ['STORAGE_BASE']  # s3://nagelfluh-project-abc123
kwargs = {'client_kwargs': {'endpoint_url': os.environ['STORAGE_ENDPOINT']}}  # MinIO only

# Read dataset
with fsspec.open(f"{base}/processes/xyz/datasets/123/root.msgpack", "rb", **kwargs) as f:
    data = f.read()

# Write output
with fsspec.open(f"{base}/processes/{os.environ['PROCESS_ID']}/datasets/456/root.msgpack", "wb", **kwargs) as f:
    f.write(result)
```

### Backend Components

- **FastAPI server**: REST API and WebSocket endpoints
- **K8s client**: Kubernetes API integration
- **Job orchestrator**: Creates K8s Job manifests with Kueue annotations
- **Log collector**: Streams pod logs to ProcessLog table and WebSocket
- **Database**: SQLite (dev) / PostgreSQL (prod) with Alembic migrations

### Frontend Components

- **Flexout layout system**: Drag-and-drop UI with splits, tabs, popouts
- **ProcessContext**: Global state management for processes
- **Widgets**: FlowView, ProcessLog, ProcessEditor, PlotView, MapView
- **WebSocket clients**: Real-time log and state updates

### Kubernetes Resources

- **Namespace**: `nagelfluh-jobs`
- **Kueue queues**: `nagelfluh-queue` (local), `nagelfluh-cluster-queue` (cluster)
- **Resource limits**: CPU, memory, ephemeral storage, deadline
- **Job cleanup**: TTL 1 hour after completion

## Development

### Backend Development

```bash
cd backend

# Run tests (TODO)
pytest

# Create new migration
alembic revision -m "description"

# Apply migrations
alembic upgrade head

# Rollback migration
alembic downgrade -1
```

### Frontend Development

```bash
cd frontend

# Run tests
npm test

# Build for production
npm run build

# Lint
npm run lint
```

### Docker Development

```bash
# Rebuild base image
./docker/build.sh

# Test runner locally (pulls from minikube's registry NodePort)
MINIKUBE_IP=$(minikube ip)
docker run --rm \
  -e PROCESS_TYPE=fft \
  -e PROCESS_ID=test \
  -e VERSION=1 \
  -e PROJECT_ID=default-project-00000000-0000-0000-0000-000000000000 \
  -e PARAMETERS_JSON='{}' \
  -e BACKEND_URL=http://host.docker.internal:8000 \
  -e STORAGE_BASE=s3://nagelfluh \
  ${MINIKUBE_IP}:30500/nagelfluh-base-runner:latest
```

### Process Type Development

Process types are implemented as Python classes and registered via setuptools entrypoints.

#### Entrypoint Group

All process types must be registered in the **`nagelfluh.process_types`** entrypoint group.

#### Process Type Class Structure

Each process type class must implement two class methods:

```python
class my_process:
    """Process type description."""

    @classmethod
    def schema(cls):
        """Return JSON Schema for process parameters.

        Returns:
            dict: JSON Schema object defining parameter validation
        """
        return {
            "type": "object",
            "properties": {
                "input_data": {
                    "type": "string",
                    "format": "uri",
                    "x-format": "dataset",  # Shows dataset selector in UI
                    "title": "Input Dataset"
                },
                "parameter1": {
                    "type": "number",
                    "default": 1.0,
                    "title": "Parameter 1"
                }
            },
            "required": ["input_data"]
        }

    @classmethod
    def run(cls, storage_context=None, **kwargs):
        """Execute the process.

        Args:
            storage_context (dict): Storage configuration with keys:
                - process_id (str): Current process ID
                - project_id (str): Project ID
                - storage_base (str): Storage base URL (e.g., s3://nagelfluh-project-abc)
                - storage_kwargs (dict): fsspec kwargs (e.g., endpoint_url for MinIO)
            **kwargs: Process parameters from JSON Schema

        Returns:
            dict: Result with 'status' and optional 'outputs':
                {
                    "status": "success",
                    "outputs": {
                        "output_name": "s3://path/to/dataset"
                    }
                }
        """
        # Your process implementation here
        print(f"Running my_process with params: {kwargs}")

        # Example: Write output dataset
        outputs = {}
        if storage_context:
            dataset_url = write_dataset(
                storage_context['storage_base'],
                storage_context['process_id'],
                storage_context['storage_kwargs']
            )
            outputs['result'] = dataset_url

        return {"status": "success", "outputs": outputs}
```

#### Registering a New Process Type

1. **Create your process class** in a Python package:
   ```python
   # mypackage/processes.py
   class my_custom_process:
       @classmethod
       def schema(cls):
           return {...}

       @classmethod
       def run(cls, storage_context=None, **kwargs):
           return {"status": "success"}
   ```

2. **Register in setup.py**:
   ```python
   from setuptools import setup

   setup(
       name="mypackage",
       version="0.1.0",
       packages=["mypackage"],
       entry_points={
           "nagelfluh.process_types": [
               "my_custom_process=mypackage.processes:my_custom_process",
           ],
       },
   )
   ```

3. **Install in Docker image**:
   ```dockerfile
   COPY mypackage /app/mypackage
   RUN pip install -e /app/mypackage
   ```

#### Schema Generation

When the Docker image is built, all process type schemas are automatically collected and stored at:
- **Location**: `/app/process_schemas.json`
- **Format**: `{"process_type_name": {...schema...}, ...}`
- **Generated by**: `/app/get_schema.py` during Docker build

This allows the backend to read available process types and their schemas without executing process code.

#### Example Process Types

See `docker/base-runner/nagelfluh_processes/fake_processes.py` for reference implementations:
- `fft` - FFT analysis with dataset input
- `inversion` - Inversion with regularization parameters
- `import_data` - Data import with file upload
- `create_environment` - Environment creation

## Configuration

### Backend (`backend/config.py`)

- `DATABASE_URL`: SQLite/PostgreSQL connection string
- `DATA_BASE_PATH`: Legacy file storage path (file://, gs://, s3://)
- `STORAGE_PROTOCOL`: Storage protocol (s3, gcs, az, file)
- `STORAGE_ENDPOINT`: Storage endpoint URL (MinIO URL or empty for cloud)
- `STORAGE_BUCKET_PREFIX`: Prefix for project buckets
- `K8S_NAMESPACE`: Kubernetes namespace (default: `nagelfluh-jobs`)
- `JWT_SECRET_KEY`: Authentication secret

### Environment Variables

- `K8S_NAMESPACE`: Override Kubernetes namespace
- `GCP_PROJECT`: GCP project ID (for GCR image tags in migrations)
- `STORAGE_PROTOCOL`: Override storage protocol
- `STORAGE_ENDPOINT`: Override storage endpoint
- `STORAGE_BUCKET_PREFIX`: Override bucket prefix

## Troubleshooting

### Minikube Issues

```bash
# Clean up Nagelfluh resources and reinstall
./dev/cleanup-minikube.sh
./dev/setup-minikube.sh

# If Kueue is stuck or broken, cleanup will remove it completely

# For complete reset (deletes entire minikube cluster):
minikube delete
./dev/setup-minikube.sh
./dev/setup-minio.sh  # MinIO needs to be reinstalled too!
```

### After Minikube Restart

**If you stopped and started minikube (`minikube stop` → `minikube start`):**
- Everything persists (MinIO, Kueue, data)
- Just restart the port-forward:
  ```bash
  ./dev/restart-minio-portforward.sh

  # Or manually:
  kubectl port-forward -n minio svc/minio 9000:9000 &
  ```

**If you deleted minikube (`minikube delete`):**
- All data is lost
- Run full setup again:
  ```bash
  ./dev/setup-minikube.sh
  ./dev/setup-minio.sh
  ```

### Kueue Installation Fails ("metadata.annotations: Too long")

If you see `The CustomResourceDefinition "workloads.kueue.x-k8s.io" is invalid: metadata.annotations: Too long`:

```bash
# This is fixed in the scripts (uses Kueue v0.9.1 with server-side apply)
# Just clean up and reinstall:
./dev/cleanup-minikube.sh
./dev/setup-minikube.sh
```

### Job Not Starting

```bash
# Check Kueue workload admission
kubectl get workloads -n nagelfluh-jobs

# Check events
kubectl get events -n nagelfluh-jobs --sort-by='.lastTimestamp'

# Describe job
kubectl describe job <job-name> -n nagelfluh-jobs
```

### Image Pull Errors

```bash
# Verify image exists in minikube's Docker daemon
eval $(minikube docker-env)
docker images | grep nagelfluh-runner

# If missing, rebuild
./docker/build.sh
```

### Backend Connection Issues

```bash
# Check K8s client can connect
kubectl cluster-info

# Verify kubeconfig
export KUBECONFIG=~/.kube/config
```

### MinIO Issues

```bash
# Check if MinIO is running
kubectl get pods -n minio

# View MinIO logs
kubectl logs -n minio -l app=minio

# Check port-forward is running
ps aux | grep "port-forward.*minio"

# Restart port-forward
pkill -f "kubectl port-forward.*minio"
kubectl port-forward -n minio svc/minio 9000:9000 &

# Test mc connection
mc admin info myminio

# List project buckets
mc ls myminio/

# Check user/policy for a project
mc admin user info myminio project-<project-id>
mc admin policy entities myminio project-<project-id>-policy
```

### Storage Permission Errors

```bash
# Check pod environment variables
kubectl exec <pod-name> -n nagelfluh-jobs -- env | grep STORAGE

# Check if k8s secret exists
kubectl get secret project-<project-id>-storage -n nagelfluh-jobs

# View secret contents (base64 encoded)
kubectl get secret project-<project-id>-storage -n nagelfluh-jobs -o yaml

# Test storage access from pod
kubectl exec -it <pod-name> -n nagelfluh-jobs -- python3 -c "
import fsspec, os
fs = fsspec.filesystem('s3',
    key=os.environ['AWS_ACCESS_KEY_ID'],
    secret=os.environ['AWS_SECRET_ACCESS_KEY'],
    client_kwargs={'endpoint_url': os.environ['STORAGE_ENDPOINT']})
print(fs.ls('nagelfluh-project-<project-id>'))
"
```

## What's Next

Current implementation includes:
- ✅ K8s process execution
- ✅ Kueue job queuing
- ✅ Real-time log streaming
- ✅ Resource limits and deadlines
- ✅ Usage-based billing
- ✅ Per-project bucket storage with IAM security
- ✅ MinIO for local development
- ✅ fsspec-based dataset I/O
- ✅ Automatic storage provisioning

Future enhancements:
- Real environment building (Docker image creation via processes)
- GCS/S3 production storage
- Metrics collection (CPU/memory usage tracking)
- Kill button in UI
- GPU support
- Network policies
- Advanced monitoring (Prometheus/Grafana)

## License

Copyright (c) 2026 Egil Möller

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program in the [LICENSE file](LICENSE).  If not, see <https://www.gnu.org/licenses/>.


## Contributing

[Add contribution guidelines]
