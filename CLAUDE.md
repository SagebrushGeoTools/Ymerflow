# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Nagelfluh is a geophysics data processing application with a React frontend and FastAPI backend. The application provides a flexible, drag-and-drop layout system for managing data processing workflows, visualizing results with Plotly charts, and configuring process parameters via JSON Schema forms.

## Documentation Structure

Comprehensive documentation is available in the `docs/` directory:

### For Users
- **[User Guide](docs/user-guide.md)** - Complete guide for using the application

### For Developers

**Architecture:**
- **[System Overview](docs/architecture/overview.md)** - Backend/frontend components, data flow, Kubernetes resources
- **[Technology Stack](docs/architecture/technology-stack.md)** - Complete list of technologies, libraries, and tools
- **[Environment](docs/architecture/environment.md)** - Docker images, entrypoints, runner, schema extraction
- **[Process Types](docs/architecture/processes.md)** - Creating custom process types, schemas, registration
- **[Storage](docs/architecture/storage.md)** - Per-project buckets, security model, fsspec usage

**Frontend:**
- **[Query Architecture](docs/frontend/queries.md)** - TanStack Query hooks, centralized invalidation, data fetching patterns
- **[Widget System](docs/frontend/widgets.md)** - Creating widgets, built-in widgets, plot elements
- **[Layout System](docs/frontend/layout.md)** - Flexout drag-and-drop, splits, tabs, popouts
- **[JSON Schema Forms](docs/frontend/forms.md)** - Custom forms, dataset selector, validation

**Operations:**
- **[Deployment Guide](docs/deployment.md)** - Development and production setup, Minikube, MinIO, cloud deployment
- **[Development Guide](docs/development.md)** - Development workflows, testing, debugging, contributing

**IMPORTANT**: When you need to understand how something works, consult the relevant documentation file first rather than duplicating information here.

## Development Workflow - Critical Rules

**Important guidelines when working with this codebase:**

1. **DO NOT start app servers** - Both frontend and backend servers are already running with auto-reload enabled. Changes will be picked up automatically.

2. **Plan before implementing** - Always discuss what changes will be made upfront. Wait for explicit approval before making any code changes, then apply all changes in one go.

3. **DO NOT commit to git** - Never create git commits or push changes. The user will handle version control.

4. **Package installation** - When installing new packages:
   - **npm**: Always use `--save` or `--save-dev` flags. Ask the user for approval first.
   - **Python**: Update `backend/requirements.txt`, then run `pip install -r backend/requirements.txt`

5. **Data access patterns** - When building features that display process data:
   - **Always use TanStack Query hooks** from `datamodel/useQueries.js` - never use manual `fetch()` calls
   - **All cache invalidation** must go through ProcessContext helpers (`invalidateProject`, etc.) - never call `queryClient.invalidateQueries()` directly
   - Start by examining the actual data structure (e.g., console.log the process object)
   - Access data directly from the source: `process.versions[x].outputs` from the processes array
   - See **[Query Architecture](docs/frontend/queries.md)** for complete data fetching patterns

6. **Consult documentation** - Before implementing features:
   - Check relevant docs for architecture patterns
   - Look at existing implementations in the source code
   - Documentation contains links to source files (follow them for implementation details)

## Debugging Hung/Stuck Processes - CRITICAL

**NEVER restart or kill a stuck process without gathering diagnostic information first!**

When a process (especially backend/uvicorn) is hung or unresponsive, this is a critical opportunity to diagnose a potentially recurring production issue. Quick fixes that restart the process destroy valuable forensic evidence.

### Mandatory Diagnostic Steps (BEFORE killing process)

1. **Capture process state:**
   ```bash
   # Get process details
   ps -p <PID> -o pid,ppid,state,wchan,cmd
   cat /proc/<PID>/status
   cat /proc/<PID>/stack  # Kernel stack trace
   ```

2. **Get Python stack trace with gdb:**
   ```bash
   # Attach gdb (may need sudo)
   sudo gdb -p <PID>

   # In gdb:
   (gdb) py-bt        # Python backtrace for all threads
   (gdb) thread apply all py-bt   # All threads
   (gdb) py-list      # Show Python source code context
   (gdb) info threads # List all threads and their states
   (gdb) detach       # Detach without killing
   (gdb) quit
   ```

3. **Check file descriptors and network connections:**
   ```bash
   lsof -p <PID>  # All open files/sockets
   lsof -p <PID> | grep -E "ESTABLISHED|CLOSE_WAIT|LISTEN"
   netstat -anp | grep <PID>  # Network connections
   ```

4. **Check system calls (if available without sudo):**
   ```bash
   strace -p <PID> -c  # Summary of syscalls (Ctrl+C after a few seconds)
   strace -p <PID> -e trace=network,file  # Track specific syscall categories
   ```

5. **Check for deadlocks/threading issues:**
   ```bash
   # Using py-spy (if available)
   py-spy dump --pid <PID>
   py-spy top --pid <PID>
   ```

6. **Save all diagnostic output:**
   ```bash
   # Create a diagnostic report file BEFORE killing
   {
     echo "=== Process Status ==="
     ps -p <PID> -o pid,ppid,state,wchan,cmd
     echo -e "\n=== Process Stack ==="
     cat /proc/<PID>/stack
     echo -e "\n=== Open Files ==="
     lsof -p <PID>
     echo -e "\n=== Network Connections ==="
     netstat -anp | grep <PID>
   } > hung_process_diagnostic_$(date +%Y%m%d_%H%M%S).txt
   ```

### After Gathering Diagnostics

**Only after** collecting the above information:
1. Analyze the traces to identify the root cause
2. Document findings in a bug report or issue
3. If a code fix is needed, implement it
4. Add monitoring/logging to catch the issue earlier next time
5. Consider adding timeouts or circuit breakers if applicable

### Common Causes to Look For

- **fsspec/storage blocking**: Check if stuck in S3/MinIO operations
- **Database locks**: Check for long-running queries or deadlocks
- **Async/await issues**: Blocking calls in async functions
- **External API timeouts**: Calls to external services without timeouts
- **Threading deadlocks**: Multiple threads waiting on each other

### Prevention

- Add request timeouts to all external calls (storage, APIs, databases)
- Use async-compatible libraries in async contexts
- Run uvicorn with multiple workers to isolate hung requests
- Add comprehensive logging around potentially blocking operations
- Monitor slow requests and set up alerts

**Remember: Restarting is a temporary fix. Root cause analysis prevents production incidents.**

## Quick Reference

### Key Source Locations

**Backend:**
- API endpoints: `backend/main.py`
- Process types: `docker/base-runner/nagelfluh_processes/` (registered via setuptools entrypoints)
- Database models: `backend/models.py`
- Migrations: `backend/alembic/versions/`

**Frontend:**
- Widgets: `frontend/src/widgets/`
- Layout system: `frontend/src/flexout/`
- Forms: `frontend/src/jsoneditor/`
- Contexts: `frontend/src/ProcessContext.js`, `frontend/src/flexout/LayoutContext.js`
- App setup: `frontend/src/App.js` (widget registration)

### Running the Application

**Quick start (automated):**
```bash
./dev/runall.sh
```

**Manual start:**
```bash
# Backend
./backend/run.sh  # Runs on http://localhost:8000

# Frontend (in separate terminal)
cd frontend && npm start  # Runs on http://localhost:3000
```

See [Deployment Guide](docs/deployment.md) for detailed setup instructions.

## Architecture Quick Reference

### Process Data Structure

```javascript
{
  id: "process-abc-123",
  name: "FFT Analysis",
  type: "fft",
  versions: [
    {
      version: 0,
      parameters: { /* JSON Schema params */ },
      outputs: {
        "output_name": "http://localhost:8000/dataset/xyz-789"
      },
      state: "completed",  // "pending" | "running" | "completed" | "failed"
      logs: [/* log entries */]
    }
  ]
}
```

**Critical**: Access outputs directly via `process.versions[x].outputs` - do not assume they're available elsewhere.

### Query & Invalidation Pattern

**CRITICAL**: All data fetching uses TanStack Query hooks. All invalidation uses ProcessContext helpers.

```javascript
import { useContext } from 'react';
import { ProcessContext } from './ProcessContext';
import { useProcesses, useSearchDatasets, useCreateProcess } from './datamodel/useQueries';

// ✅ Fetch data with hooks
const { data: processes = [] } = useProcesses(projectId);
const { data: datasets = [] } = useSearchDatasets(search, true, projectId);

// ✅ Invalidate through context helpers
const { invalidateProject } = useContext(ProcessContext);
await invalidateProject(projectId);  // Refetches all processes, datasets, outputs

// ❌ NEVER do manual fetch() or queryClient.invalidateQueries()
```

**Three invalidation helpers** (from ProcessContext):
- `invalidateProcess(processId, projectId)` - single process + its outputs
- `invalidateProject(projectId)` - all processes, datasets, and outputs (use this when in doubt)
- `invalidateDatasets()` - datasets only (rarely needed)

**Pattern for mutations**:
```javascript
const createProcess = useCreateProcess();
const newProcess = await createProcess.mutateAsync({ proc, projectId });
await invalidateProject(projectId);  // Required - mutation doesn't auto-invalidate
setActiveProcess({ processId: newProcess.id, version: 1 });
```

See **[Query Architecture](docs/frontend/queries.md)** for complete details.

### Dataset Selection in Forms

To allow a process to reference another process's output in its schema:

```python
"input_data": {
    "type": "string",
    "format": "uri",
    "x-format": "dataset",  # Triggers custom dataset selector widget
    "title": "Input Dataset"
}
```

The frontend automatically renders a searchable `DatasetSelector` for these fields.

### Widget Registration

Widgets are registered in `frontend/src/App.js`:

```javascript
const widgets = {
  FlowView,
  ProcessEditor,
  PlotView,
  // ... add custom widgets here
};
```

See [Widget System](docs/frontend/widgets.md) for creating new widgets.

### Flexout Layout System

The layout is a recursive tree structure where each node has:
- `id` - Unique identifier
- `widget` - Widget type name (e.g., "FlowView", "PlotView", "VerticalSplit")
- `children` - Array of child nodes (for Split/TabSet widgets)

**Important**: Do NOT implement project-specific functions hard coded directly inside `flexout/`. If needed, new registration/hook systems can be added.

See [Layout System](docs/frontend/layout.md) for complete details.

## Common Tasks

### Adding a New Widget

1. Create component in `frontend/src/widgets/` (e.g., `MyWidget.js`)
2. Export a static `title` property: `MyWidget.title = "My Widget"`
3. Register in `frontend/src/App.js` widgets object
4. Widget will appear in pane dropdown automatically

**See:** [Widget System](docs/frontend/widgets.md) for detailed guide and examples.

### Adding a Process Type

Process types are Python classes registered via setuptools entrypoints in the `nagelfluh.process_types` group.

1. Create class with `schema()` and `run()` methods
2. Register in `setup.py` entrypoints
3. Install in Docker image

**See:** [Process Types](docs/architecture/processes.md) for complete guide with examples.

### Adding a Plot Element

Plot elements are defined in `frontend/src/widgets/PlotView/elements/`:

1. Create new element file (e.g., `MyPlot.js`)
2. Export object with `x_unit`, `y_unit`, `parameters`, and `render()`
3. Register in `frontend/src/widgets/PlotView/elements/index.js`

**See:** [Widget System](docs/frontend/widgets.md#plotview) for plot element structure.

### Working with Storage

All dataset I/O uses `fsspec` for storage abstraction. Processes receive `storage_context` with:
- `storage_base` - Base URL (e.g., `s3://nagelfluh-project-abc123`)
- `storage_kwargs` - Additional fsspec arguments (e.g., MinIO endpoint)
- `process_id` - Current process ID
- `project_id` - Project ID

**See:** [Storage Architecture](docs/architecture/storage.md) for patterns and best practices.

## Development Commands

### Backend
```bash
# Install dependencies
pip install -r backend/requirements.txt

# Run development server (auto-reload)
./backend/run.sh  # or: uvicorn backend.main:app --reload

# Database migrations
alembic -c backend/alembic.ini upgrade head  # Apply migrations
alembic -c backend/alembic.ini revision -m "description"  # Create new migration
```

### Frontend
```bash
cd frontend

# Install dependencies
npm install

# Run development server (auto-reload)
npm start  # or: ./run.sh

# Run tests
npm test

# Build for production
npm run build
```

### Docker (Process Runner)
```bash
# Build process runner image
./docker/build.sh

# Image is built directly in Minikube's Docker daemon
```

**See:** [Development Guide](docs/development.md) for complete workflows, testing, and debugging.

## API Endpoints (Backend)

Key endpoints:
- `GET /process-types` - Available process types with schemas
- `POST /process` - Create new process
- `GET /processes` - List all processes
- `GET /datasets?search=<query>` - Search datasets
- `GET /dataset/{id}` - Get dataset content
- `WS /ws/logs` - Real-time log streaming
- `WS /ws/state` - Real-time state updates

**See:** [System Overview](docs/architecture/overview.md) for complete API documentation.

## Testing

### Frontend Tests
```bash
cd frontend
npm test  # Run Jest tests with watch mode
```

### Backend Tests
```bash
cd backend
pytest  # (TODO: Add tests)
```

**See:** [Development Guide](docs/development.md#testing) for testing strategies.

## Troubleshooting

### Documentation References
- **User issues**: [User Guide - Troubleshooting](docs/user-guide.md#troubleshooting)
- **Development issues**: [Development Guide - Debugging](docs/development.md#debugging)
- **Deployment issues**: [Deployment Guide - Troubleshooting](docs/deployment.md#troubleshooting)
- **Storage issues**: [Development Guide - Storage Debugging](docs/development.md#storage-debugging)

### Quick Checks

**Servers not running?**
```bash
./dev/runall.sh  # Starts everything
```

**Frontend not updating?**
- Check browser console for errors
- Verify `npm start` is running
- Hard refresh: Ctrl+Shift+R

**Backend not responding?**
- Check `./backend/run.sh` is running
- Visit http://localhost:8000/docs to verify
- Check logs in terminal

**Storage permission errors?**
- Verify MinIO is running: `kubectl get pods -n minio`
- Check port-forward: `ps aux | grep "port-forward.*minio"`
- Restart: `./dev/restart-minio-portforward.sh`

## Best Practices

1. **Read the docs first** - Most questions are answered in the documentation
2. **Follow existing patterns** - Look at similar components for reference
3. **Keep it simple** - Don't over-engineer solutions
4. **Data access is direct** - Access `process.versions[x].outputs` directly
5. **Use source links** - Documentation points to source files for implementation details
6. **Test locally** - Verify changes work before asking for review
7. **No expensive backend operations** - The backend should never perform computationally expensive operations itself:
   - Heavy data processing should be done in **process jobs** (Kubernetes pods)
   - Client-side computation should be done in the **frontend** (ideally using GLSL/WebGL for GPU acceleration)
   - The backend is a lightweight coordinator/API server, not a compute engine

## Getting Help

- **Documentation**: Check `docs/` directory for comprehensive guides
- **Source code**: Follow links in documentation to actual implementation
- **PLAN.md**: See planned features and implementation notes
- **GitHub Issues**: For bugs and feature requests (when applicable)
