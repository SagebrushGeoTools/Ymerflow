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
                                       └─> Kueue → Job → Pod (process execution)
                                       └─> Log streaming via WebSocket
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

# Test runner locally
docker run --rm \
  -e FUNCTION_MODULE=nagelfluh_runner.fake_processes \
  -e FUNCTION_NAME=run_fft \
  -e PROCESS_ID=test \
  -e VERSION=1 \
  -e PARAMETERS_JSON='{}' \
  -e BACKEND_URL=http://host.docker.internal:8000 \
  localhost:5000/nagelfluh-runner:latest
```

## Configuration

### Backend (`backend/config.py`)

- `DATABASE_URL`: SQLite/PostgreSQL connection string
- `DATA_STORAGE_PATH`: File storage path (file://, gs://, s3://)
- `K8S_NAMESPACE`: Kubernetes namespace (default: `nagelfluh-jobs`)
- `JWT_SECRET_KEY`: Authentication secret

### Environment Variables

- `K8S_NAMESPACE`: Override Kubernetes namespace
- `GCP_PROJECT`: GCP project ID (for GCR image tags in migrations)

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

## What's Next

Current implementation includes:
- ✅ K8s process execution
- ✅ Kueue job queuing
- ✅ Real-time log streaming
- ✅ Resource limits and deadlines
- ✅ Usage-based billing

Future enhancements:
- Real environment building (Docker image creation via processes)
- Dataset I/O (fsspec-based read/write to cloud storage)
- MinIO for local blob storage
- Metrics collection (CPU/memory usage tracking)
- Kill button in UI
- GPU support
- Network policies
- Advanced monitoring (Prometheus/Grafana)

## License

[Add license information]

## Contributing

[Add contribution guidelines]
