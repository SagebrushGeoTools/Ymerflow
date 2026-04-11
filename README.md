# Nagelfluh Geophysics

![](frontend/public/Nagelfluh.jpg)

A geophysics data processing application with a React frontend and FastAPI backend. Provides a flexible, drag-and-drop layout system for managing data processing workflows, visualizing results with Plotly charts, and configuring process parameters via JSON Schema forms.

Processes are executed in Kubernetes containers with resource limits, job queuing (Kueue), and usage-based billing.

## Deployment Modes

There are two ways to run Nagelfluh, differing in where the backend, frontend, and database live:

| | Dev | Prod |
|---|---|---|
| Backend & frontend | Host machine | Kubernetes pods (inside Minikube) |
| Database | SQLite on host | PostgreSQL in Kubernetes |
| Process jobs | Kubernetes (Minikube) | Kubernetes (Minikube) |
| Storage | MinIO in Minikube | MinIO in Minikube |
| Start command | `./dev/runall.sh` | `./prod/runall-minikube.sh` |

---

## Dev Mode

Run everything with one command:

```bash
./dev/runall.sh
```

Open **http://localhost:3000**.

---

## Prod Mode (everything in Minikube)

### First-time setup

```bash
./prod/runall-minikube.sh
```

This script is idempotent — safe to re-run after a reboot or upgrade. It handles Minikube, MinIO, PostgreSQL, image builds, migrations, and the socat port forwarder automatically.

By default the app is exposed on port 3000 of the host machine's primary IP (printed at the end of the script). Clients on the network reach it at `http://<host-ip>:3000`.

### Site-specific configuration

Before running for the first time, create `prod/config.env` to tell the app what public URL clients will use to reach it:

```bash
cp prod/config.env.example prod/config.env
```

Then edit `prod/config.env`:

```bash
# The full public URL of the API as seen by client browsers.
# The frontend embeds this URL into dataset links, so it must be reachable
# from the end-user's browser — not just from the server itself.
# Examples:
#   Plain IP:  BACKEND_BASE_URL=http://192.168.1.100:3000/api
#   Domain:    BACKEND_BASE_URL=https://nagelfluh.example.com/api
BACKEND_BASE_URL=http://<your-server-ip-or-hostname>:3000/api

# Optional overrides:
# HOST_IP=192.168.1.100   # IP to bind the socat forwarder (default: primary NIC)
# FRONTEND_PORT=80        # Port to expose the app on (default: 3000)
```

`prod/config.env` is gitignored and never committed.

### After a reboot

```bash
./prod/runall-minikube.sh   # re-run; it skips steps already done
```

---

## Building a New Runner Environment

After modifying process types in `docker/base-runner/`, rebuild the runner image and register it as a named environment.

**Dev:**
```bash
./docker/build.sh "My Environment Name"
```

**Prod:**
```bash
PRODUCTION=true ./docker/build.sh "My Environment Name"
```

The environment then appears in the UI's environment selector. In prod, the database update runs as a Kubernetes Job so `build.sh` never needs direct database access.

---

## Using the Application

Once running:

1. Select an environment (e.g., "Bootstrap")
2. Choose a process type (e.g., "fft", "inversion")
3. Configure resources (CPU, memory, deadline)
4. Fill in process parameters
5. Click "Submit" — the process runs in Kubernetes with real-time log streaming

## Documentation

### User Guide
- **[User Guide](docs/user-guide.md)** - Complete guide for using Nagelfluh: interface, processes, datasets, billing, troubleshooting

### Architecture
- **[System Overview](docs/architecture/overview.md)** - Backend/frontend components, data flow, Kubernetes resources
- **[Technology Stack](docs/architecture/technology-stack.md)** - Complete list of technologies, libraries, and tools
- **[Environment](docs/architecture/environment.md)** - Docker images, entrypoints, runner, schema extraction
- **[Process Types](docs/architecture/processes.md)** - Creating custom process types, schemas, registration
- **[Storage](docs/architecture/storage.md)** - Per-project buckets, security model, fsspec usage

### Frontend
- **[Widget System](docs/frontend/widgets.md)** - Creating widgets, built-in widgets, plot elements
- **[Layout System](docs/frontend/layout.md)** - Flexout drag-and-drop, splits, tabs, popouts
- **[JSON Schema Forms](docs/frontend/forms.md)** - Custom forms, dataset selector, validation

### Operations
- **[Deployment Guide](docs/deployment.md)** - Development and production setup, Minikube, MinIO, cloud deployment
- **[Development Guide](docs/development.md)** - Development workflows, testing, debugging, contributing

## Features

### Flexible Layout System
- Drag-and-drop interface with resizable splits and tabs
- Popout windows for multi-monitor workflows
- Persistent layout configuration

### Process Management
- Visual process graph showing dependencies
- Real-time log streaming via WebSocket
- Resource management (CPU, memory, deadlines)
- Usage-based billing with upfront cost estimates

### Data Visualization
- Plotly-based scientific plotting
- Extensible plot element system
- Geographic map visualization
- Unit-aware axis matching

### Kubernetes Integration
- Containerized process execution with resource limits
- Kueue job queuing for cluster efficiency
- Automatic cleanup and retry logic
- Per-project storage isolation with IAM security

### Storage Architecture
- S3/GCS-compatible object storage
- MinIO for local development
- Per-project buckets with scoped credentials
- Automatic bucket provisioning

See [Technology Stack](docs/architecture/technology-stack.md) for detailed information on all technologies and libraries used.

## Using Nagelfluh

Once the application is running, see the **[User Guide](docs/user-guide.md)** for:
- Understanding the interface (FlowView, ProcessEditor, PlotView, etc.)
- Creating and running processes
- Working with datasets
- Monitoring and troubleshooting
- Billing and cost management
- Best practices

## Architecture

Nagelfluh uses a distributed architecture with browser-based UI, FastAPI backend, and Kubernetes for process execution:

```
Frontend (React) → Backend (FastAPI) → Kubernetes Cluster
                                       ├─> Kueue → Job → Pod (process execution)
                                       ├─> Log streaming via WebSocket
                                       └─> MinIO (development) / GCS/S3 (production)
                                           └─> Per-project buckets with IAM
```

See [Architecture Documentation](docs/architecture/overview.md) for complete details.

## What's Next

Current implementation includes:
- ✅ Kubernetes process execution with Kueue
- ✅ Real-time log streaming
- ✅ Resource limits and usage-based billing
- ✅ Per-project bucket storage with IAM security
- ✅ MinIO for local development
- ✅ Drag-and-drop layout system
- ✅ Process graph visualization
- ✅ Scientific plotting with Plotly

Planned enhancements (see `PLAN.md`):
- Forward modelling for AEM data
- 3D visualization (resistivity grids, curtains, terrain)
- Map underlays via WMS/WMTS
- Manual QC editor for data flagging
- Resistivity model simulator
- 3D gridding of flightline data
- High-performance plotting with WebGL

## License

Copyright (c) 2026 Egil Möller

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program in the [LICENSE file](LICENSE). If not, see <https://www.gnu.org/licenses/>.

## Contributing

See [Development Guide](docs/development.md) for development workflows, testing, and contribution guidelines.

For guidance when working with Claude Code, see [CLAUDE.md](CLAUDE.md).
