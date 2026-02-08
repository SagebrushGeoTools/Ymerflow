# System Architecture

## Overview

Nagelfluh uses a distributed architecture with React frontend, FastAPI backend, and Kubernetes-based process execution:

```
Frontend (React) → Backend (FastAPI) → Kubernetes Cluster
                                       ├─> Kueue → Job → Pod (process execution)
                                       ├─> Log streaming via WebSocket
                                       └─> MinIO (development) / GCS/S3 (production)
                                           └─> Per-project buckets with IAM
```

## Backend Components

### FastAPI Server
- **REST API**: Process creation, dataset retrieval, process type schemas
- **WebSocket endpoints**: Real-time log streaming and state updates
- **Authentication**: JWT-based user authentication
- **Database**: SQLite (development) / PostgreSQL (production) with Alembic migrations

### Kubernetes Client
- Kubernetes API integration for job management
- Creates and monitors Jobs in the `nagelfluh-jobs` namespace
- Handles job lifecycle and cleanup (TTL 1 hour after completion)

### Job Orchestrator
- Creates Kubernetes Job manifests with:
  - Resource limits (CPU, memory, ephemeral storage)
  - Deadline enforcement
  - Kueue annotations for queuing
  - Storage credentials via Kubernetes secrets
  - Environment variables for process configuration

### Log Collector
- Streams pod logs to ProcessLog database table
- Broadcasts logs to connected WebSocket clients
- Real-time updates for process state changes
- Persistent log storage for historical viewing

### Database Schema
- **Users**: Authentication and billing
- **Projects**: Multi-tenant project isolation
- **Processes**: Process definitions with versioning
- **ProcessVersions**: Parameter snapshots, outputs, state
- **ProcessLogs**: Timestamped log entries
- **Datasets**: Dataset metadata and references
- **Uploads**: User-uploaded files
- **Transactions**: Billing history (HOLD, DEBIT, RELEASE)

## Frontend Components

### Flexout Layout System
A custom drag-and-drop layout engine for flexible UI arrangement:
- **LayoutContext**: Manages recursive layout tree structure
- **Built-in widgets**: Split (vertical/horizontal), TabSet, Empty
- **Pane component**: Individual draggable/droppable pane with header controls
- **Popout support**: Detach panes to separate windows
- **MenuContext**: Global menu registration system

Layout tree structure:
```javascript
{
  id: "unique-id",
  widget: "WidgetName",  // e.g., "FlowView", "VerticalSplit"
  children: [...]         // For Split/TabSet widgets
}
```

### State Management

#### ProcessContext
Global state for:
- All processes and their versions
- Active process selection
- Real-time updates via WebSocket
- Process creation and editing

#### API Client
- Centralized API calls to backend (`http://localhost:8000`)
- Process CRUD operations
- Dataset retrieval
- Process type schema fetching

### Core Widgets

#### FlowView
- Visual graph of processes using ReactFlow
- Shows process dependencies (input/output relationships)
- Click to set active process
- Drag to rearrange graph layout

#### ProcessEditor
Dual-mode editor:
- **Create mode** (no active process): Form to create new process
  - Select process type
  - Fill JSON Schema form with parameters
  - Resource configuration (CPU, memory, deadline)
  - Cost estimation
- **Edit mode** (active process): View/edit existing process
  - Create new versions with modified parameters
  - View output datasets

#### ProcessLog
- Real-time log streaming with status badges
- WebSocket connection to backend
- Filterable by process
- Persistent across sessions

#### PlotView
Plotly-based visualization with:
- **Plot elements registry**: Extensible element types (Line, Points, etc.)
- **Unit matching**: Automatic axis assignment based on data units
- **Dynamic trace building**: Loads data from datasets, builds Plotly traces
- **Configuration form**: Add/configure plot elements with dataset selection

#### MapView
Geographic visualization of survey data with interactive features.

### WebSocket Clients
- **Log streaming**: Real-time process logs
- **State updates**: Process state changes (running, completed, failed)
- Automatic reconnection on disconnect
- Multiplexed updates for multiple processes

## Kubernetes Resources

### Namespace
- **Name**: `nagelfluh-jobs`
- **Purpose**: Isolated environment for process execution
- **Resources**: Jobs, Pods, Secrets, ConfigMaps

### Kueue Configuration
- **Local queue**: `nagelfluh-queue` (namespace-scoped)
- **Cluster queue**: `nagelfluh-cluster-queue` (cluster-wide resource management)
- **Resource limits**: Enforced CPU, memory, ephemeral storage
- **Job queuing**: Automatic queuing when resources unavailable
- **Admission control**: Jobs admitted based on available quota

### Job Structure
Each process creates a Kubernetes Job with:
- **Name**: `process-{process_id}-v{version}`
- **Labels**: `nagelfluh.app=process`, `process-id={id}`, `version={v}`
- **Annotations**: Kueue queue-name
- **Resource requests/limits**: User-specified CPU/memory
- **Deadline**: `activeDeadlineSeconds` for timeout enforcement
- **Backoff limit**: 0 (no automatic retries)
- **TTL**: 3600 seconds (1 hour cleanup after completion)

### Pod Configuration
- **Image**: `nagelfluh-base-runner:latest` (or environment-specific image)
- **Environment variables**:
  - `PROCESS_TYPE`: Type of process to run
  - `PROCESS_ID`: Unique process identifier
  - `VERSION`: Process version number
  - `PROJECT_ID`: Project identifier for multi-tenancy
  - `PARAMETERS_JSON`: Serialized process parameters
  - `BACKEND_URL`: Backend API endpoint
  - `STORAGE_BASE`: S3/GCS bucket path
  - `STORAGE_ENDPOINT`: MinIO endpoint (development only)
  - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`: From Kubernetes secret
- **Restart policy**: Never (controlled by Kueue)

## Data Flow

### Process Creation
1. User fills form in ProcessEditor
2. Frontend validates parameters against JSON Schema
3. POST to `/process` with:
   - Process type
   - Parameters (may include dataset URLs)
   - Resource requirements
4. Backend:
   - Checks user balance vs. estimated cost
   - Creates HOLD transaction
   - Creates ProcessVersion record
   - Creates Kubernetes Job with Kueue annotations
   - Returns process ID

### Process Execution
1. Kueue admits Job when resources available
2. Kubernetes creates Pod
3. Pod container runs `runner.py`:
   - Loads process type class via entrypoints
   - Deserializes parameters
   - Calls `process_class.run(storage_context, **params)`
   - Writes outputs to storage
   - Reports results to backend
4. Backend:
   - Collects logs from pod
   - Updates ProcessVersion state
   - Creates Dataset records for outputs
   - Calculates actual cost
   - Creates DEBIT and RELEASE transactions

### Dataset Access
1. Frontend requests dataset: GET `/dataset/{id}`
2. Backend:
   - Looks up dataset metadata (storage URL, mime type)
   - Verifies user has access to parent project
   - Fetches data from storage (S3/GCS/MinIO)
   - Returns data with appropriate content-type
3. Frontend consumes dataset (plots, downloads, etc.)

### Real-time Updates
1. Backend monitors pod logs via Kubernetes API
2. New log lines:
   - Stored in ProcessLog table
   - Broadcast to WebSocket clients
3. State changes:
   - ProcessVersion.state updated
   - Broadcast to WebSocket clients
4. Frontend:
   - ProcessLog widget displays logs
   - FlowView updates process node status
   - ProcessEditor shows current state

## Security Model

### Authentication
- JWT tokens for user sessions
- Secrets stored in environment variables
- Per-user database isolation

### Storage Access Control
- Per-project S3/GCS buckets
- IAM policies with path-based conditions
- Process pods get scoped credentials:
  - READ: All uploads and datasets in project
  - WRITE: Only to own process directory
- No cross-project access
- See [Storage Architecture](storage.md) for details

### Network Policies
Future enhancement: Pod network isolation

## Monitoring and Observability

### Current Implementation
- Real-time log streaming to UI
- Process state tracking (pending, running, completed, failed)
- Job events from Kubernetes API

### Future Enhancements
- Prometheus metrics collection
- CPU/memory usage tracking
- Grafana dashboards
- Alert notifications
- Performance profiling
