# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Nagelfluh is a geophysics data processing application with a React frontend and FastAPI backend. The application provides a flexible, drag-and-drop layout system for managing data processing workflows, visualizing results with Plotly charts, and configuring process parameters via JSON Schema forms.

## Development Workflow

**Important guidelines when working with this codebase:**

1. **DO NOT start app servers** - Both frontend and backend servers are already running with auto-reload enabled. Changes will be picked up automatically.

2. **Plan before implementing** - Always discuss what changes will be made upfront. Wait for explicit approval before making any code changes, then apply all changes in one go.

3. **DO NOT commit to git** - Never create git commits or push changes. The user will handle version control.

4. **Package installation** - When installing new npm packages, always use `--save` or `--save-dev` flags. Ask the user for approval before installing any new packages. When installing python packages: update `requirements.txt`, then run `pip install -r requirements.txt`.

## Development Commands

### Backend (FastAPI)
```bash
# Install dependencies
pip install -r requirements.txt

# Run development server
uvicorn backend.main:app --reload
# Or use the provided script:
./run.sh
```

Backend runs on `http://localhost:8000`

### Frontend (React)
```bash
cd frontend

# Install dependencies
npm install

# Run development server
npm start

# Run tests
npm test

# Build for production
npm run build
```

Frontend runs on `http://localhost:3000` in development mode

## Architecture

### Backend Structure (`backend/`)

The backend is a simple FastAPI application (`main.py`) providing:
- `/process-types` - Returns available process types with their JSON Schema definitions
- `/process` (POST) - Creates a new process instance (automatically creates output datasets)
- `/processes` - Lists all created processes
- `/datasets?search=<substring>&completed_only=true` - Search datasets by process or dataset name
- `/dataset/{dataset_id}` - Returns full dataset by ID

**Process types** (e.g., "fft", "inversion") are defined in `PROCESS_TYPES` dictionary with JSON Schema for parameter validation. Schemas can reference other process outputs using:
```python
"input_data": {
    "type": "string",
    "format": "uri",
    "x-format": "dataset",  # Triggers custom dataset selector widget
    "title": "Input Dataset"
}
```

**Dataset structure:**
- Datasets are output artifacts from processes
- Each has: `id`, `mime_type`, `content`, `process_id`, `process_name`, `process_version`, `dataset_name`
- Referenced via URLs: `http://localhost:8000/dataset/{id}`
- Stored in `DATASETS` dict

**Process structure:**
- Processes have an `outputs` dict mapping output names to dataset URLs
- Example: `{"spectrum": "http://localhost:8000/dataset/abc-123"}`
- Input parameters may reference other datasets via URLs

### Frontend Structure (`frontend/src/`)

The frontend is built with Create React App and uses several key patterns:

#### 1. Flexout Layout System (`flexout/`)
A custom drag-and-drop layout engine for flexible UI arrangement:
- `LayoutContext.js` - Manages the layout tree structure with built-in widgets (Split, TabSet, Empty)
- `components/Pane.js` - Individual draggable/droppable pane with header controls
- `components/Split.js` - Resizable split container (vertical/horizontal)
- `components/TabSet.js` - Tabbed container for multiple panes
- `Layout.js` - MainLayout and PopoutWrapper components for rendering
- `MenuContext.js` & `MenuBar.js` - Menu registration system

The layout is a recursive tree structure where each node has:
- `id` - Unique identifier
- `widget` - Widget type name (e.g., "FlowView", "PlotView", "VerticalSplit")
- `children` - Array of child nodes (for Split/TabSet widgets)

Panes can be dragged and dropped to rearrange, and each pane has a dropdown to change its widget type.

Note: Do NOT implement project specific functions hard coded directly
inside `flexout/`. If needed, new registration / hook systems can be
added.

#### 2. Process Management
- `ProcessContext.js` - Global state for processes and active process selection
- `api.js` - API client functions for backend communication (hardcoded to `http://localhost:8000`)

#### 3. Main Widgets
- `FlowView.js` - Displays processes as a ReactFlow graph; clicking a process sets it as active
- `ProcessEditor.js` - Dual-mode editor:
  - When no process is active: form to create new process (select type, fill JSON Schema form)
  - When process is active: form to view/edit existing process parameters
- `PlotView.js` - Plotly-based visualization with:
  - Plot elements registry (Line, Points) with unit matching
  - Dynamic trace building from datasets
  - Form to add new plot elements with dataset selection

Each widget exports a static `title` property used in the UI.

#### 4. Routing
- `/` - Main application with MenuBar and MainLayout
- `/popout/:id` - Popout window for individual panes

#### 5. JSON Schema Form Extensions (`jsoneditor/`)
Custom @rjsf components for enhanced form editing:
- `CustomForm.js` - Wrapper around @rjsf Form with custom fields
- `CustomStringField.js` - Field wrapper that detects `x-format: "dataset"` in schema
- `DatasetSelector.js` - Smart searchable dropdown for selecting process output datasets
  - Debounced search (300ms)
  - Smart grouping: When >4 processes match, shows first dataset + count
  - Click grouped item to refine search
  - Display format: "Process Name / v123 / dataset-name"
  - Stores value as URL: `http://localhost:8000/dataset/{id}`

**Usage:** Import `CustomForm` from `./jsoneditor` instead of `Form` from `@rjsf/core`. Any schema field with `format: "uri"` and `x-format: "dataset"` automatically renders as DatasetSelector.

### Key Dependencies

**Frontend:**
- `reactflow` - Process graph visualization
- `react-plotly.js` - Scientific plotting
- `@rjsf/core` - JSON Schema forms for process parameters
- `react-dnd` - Drag-and-drop layout system
- `react-bootstrap` - UI components
- `react-router-dom` - Routing including popout windows

**Backend:**
- `fastapi` - REST API framework
- `uvicorn` - ASGI server

## Adding New Features

### Adding a New Widget
1. Create component in `frontend/src/` (e.g., `MyWidget.js`)
2. Export a static `title` property: `MyWidget.title = "My Widget"`
3. Register in `App.js` widgets object
4. Widget will appear in pane dropdown automatically

### Adding a Process Type
Add to `PROCESS_TYPES` in `backend/main.py`:
```python
"my_process": {
    "schema": {
        "type": "object",
        "properties": {
            "param1": {"type": "number", "default": 1.0}
        }
    }
}
```

### Adding a Plot Element Type
Add to `PLOT_ELEMENTS` in `frontend/src/PlotView.js` with:
- `x_unit` and `y_unit` for axis matching
- `parameters` schema
- `render` function returning Plotly trace object

### Adding Dataset References to Process Schemas
To allow a process to reference another process's output:
```python
"my_param": {
    "type": "string",
    "format": "uri",
    "x-format": "dataset",
    "title": "Input Data"
}
```
The frontend will automatically render a searchable dataset selector for this field.

### Adding Custom JSON Schema Widgets
1. Create widget component in `frontend/src/jsoneditor/`
2. Add detection logic in `CustomStringField.js` (check schema properties)
3. Export from `jsoneditor/index.js`
4. All forms using `CustomForm` will automatically use the new widget
