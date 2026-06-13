# Nagelfluh Geophysics

![](frontend/public/Nagelfluh.jpg)

A geophysics data processing application with a React frontend and FastAPI backend. Provides a flexible, drag-and-drop layout system for managing data processing workflows, visualizing results with Plotly charts, and configuring process parameters via JSON Schema forms.

Processes are executed in Kubernetes containers with resource limits, job queuing (Kueue), and usage-based billing.

| Process graph view | Process editor |
|---|---|
| ![Flow view showing process graph and 3D resistivity curtain](screenshots/ymerflow_ui_screenshot%20(1).png) | ![Process editor with 3D resistivity curtain](screenshots/ymerflow_ui_screenshot.png) |

## Deployment Modes

There are two ways to run Nagelfluh, differing in where the backend, frontend, and database live:

| | Dev | Prod |
|---|---|---|
| Backend & frontend | Host machine | Kubernetes pods (inside Minikube) |
| Database | SQLite on host | PostgreSQL in Kubernetes |
| Process jobs | Kubernetes (Minikube) | Kubernetes (Minikube) |
| Storage | MinIO in Minikube | MinIO in Minikube |
| Start command | `./runall.sh` | `./runall.sh` |

---

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

---

## Dev Mode

```bash
./runall.sh   # DEPLOYMENT=development (default)
```

Open **http://localhost:3000**.

---

## Prod Mode (everything in Minikube)

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

See [Admin Tools](#admin-tools-production-minikube-only) below.

### After a reboot

```bash
./runall.sh   # re-run; it skips steps already done
```

---

## Admin Tools (production-minikube only)

Both tools are proxied by nginx and protected by HTTP basic auth. The same username and password work for both.

### pgAdmin — PostgreSQL GUI

URL: `http://<host-ip>:<port>/pgadmin/`

Login with `<ADMIN_USER>@localhost` / `<ADMIN_PASSWORD>`. The Nagelfluh PostgreSQL server is pre-configured; enter the database password (`nagelfluhpass`) on first connection.

### Headlamp — Kubernetes & Kueue dashboard

URL: `http://<host-ip>:<port>/headlamp/`

Login with `<ADMIN_USER>` / `<ADMIN_PASSWORD>` (nginx auth only — no separate Headlamp login). Shows all cluster resources including Kueue ClusterQueues, LocalQueues, and Workloads.

### Credentials

Set in `config.env` before the first run (defaults: `admin` / `password`):

```bash
ADMIN_USER=admin
ADMIN_PASSWORD=yourpassword
```

Credentials are stored in the `nagelfluh-admin-secret` Kubernetes secret on first run and never overwritten automatically. To rotate:

```bash
kubectl delete secret nagelfluh-admin-secret -n nagelfluh
# Update ADMIN_USER / ADMIN_PASSWORD in config.env, then:
./runall.sh
```

---

## Building a New Runner Environment

After modifying process types in `docker/base-runner/`, rebuild the runner image and register it as a named environment:

```bash
./docker/build.sh "My Environment Name"
```

`build.sh` reads `DEPLOYMENT` from `config.env` automatically. In prod mode the database update runs as a Kubernetes Job so `build.sh` never needs direct database access.

The environment then appears in the UI's environment selector.

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

![AEM inversion comparison — AGF reference (top) vs. Nagelfluh result (bottom)](screenshots/AGF-vs-our-inversion-3.png)

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
