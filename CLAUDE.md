# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Nagelfluh is a geophysics data processing application with a React frontend and FastAPI backend. The application provides a flexible, drag-and-drop layout system for managing data processing workflows, visualizing results with Plotly charts, and configuring process parameters via JSON Schema forms.

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
- `/process` (POST) - Creates a new process instance
- `/processes` - Lists all created processes
- `/datasets/{process_id}` - Returns mock numeric data for visualization

Process types (e.g., "fft", "inversion") are defined in `PROCESS_TYPES` dictionary with JSON Schema for parameter validation.

### Frontend Structure (`frontend/src/`)

The frontend is built with Create React App and uses several key patterns:

#### 1. Flexout Layout System (`flexout/`)
A custom drag-and-drop layout engine for flexible UI arrangement:
- `LayoutContext.js` - Manages the layout tree structure with built-in widgets (Split, TabSet, Empty)
- `components/Pane.js` - Individual draggable/droppable pane with header controls
- `components/Split.js` - Resizable split container (vertical/horizontal)
- `components/TabSet.js` - Tabbed container for multiple panes
- `Layout.js` - MainLayout and PopoutWrapper components for rendering
- `MenuContext.js` & `MenuBar.js` - Menu system for layout operations

The layout is a recursive tree structure where each node has:
- `id` - Unique identifier
- `widget` - Widget type name (e.g., "FlowView", "PlotView", "VerticalSplit")
- `children` - Array of child nodes (for Split/TabSet widgets)

Panes can be dragged and dropped to rearrange, and each pane has a dropdown to change its widget type.

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
