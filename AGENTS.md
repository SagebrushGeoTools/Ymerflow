# AGENTS.md

## Widget Schema Discipline

`backend/widget_schemas.json` is a **committed generated file**. It contains the JSON
Schemas for all widget types (including PlotView layer types assembled by gladly at
import time) and is read by the backend to assemble the full workspace JSON Schema
served by the `get_workspace_schema` MCP tool.

**You must regenerate and commit this file whenever you:**
- Add a new widget to `frontend/src/App.js`
- Add or modify a layer type schema in `frontend/src/widgets/PlotView/elements/`
- Change `get_schema()` or `get_default()` on any widget

To regenerate:
1. Ensure the dev server is running (`./runall.sh`)
2. `cd frontend && npm run export-schemas`
3. Commit `backend/widget_schemas.json` alongside your code changes
