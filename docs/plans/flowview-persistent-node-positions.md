# FlowView: Persistent Node Positions

## Goal

Store FlowView node positions in the database. On drag-end, save position. When a new process appears without a stored position, auto-layout it sensibly relative to existing positioned nodes, then save that position too.

---

## Backend

### 1. Migration — add `flow_x`, `flow_y` to `processes` table

New Alembic migration adding two nullable `Float` columns to `processes`. Nullable because positions are assigned by the frontend on first render.

### 2. Model — `Process` (`backend/models/process.py`)

- Add `flow_x = Column(Float, nullable=True)` and `flow_y = Column(Float, nullable=True)`.
- Include them in `Process.to_dict()` as `"flow_x"` / `"flow_y"`.

### 3. Router — new `PATCH /process/{process_id}/position` endpoint (`backend/routers/processes.py`)

- Accepts `{ x: float, y: float }` in the body.
- Writes to `process.flow_x` / `process.flow_y`, commits, returns 204.
- Auth: same membership check as `GET /process/{id}`.
- No WebSocket broadcast needed — this is purely a UI state change.

---

## Frontend

### 4. API helper (`frontend/src/datamodel/api.js`)

Add `updateProcessPosition(processId, x, y)` — `PATCH /process/{processId}/position`.

### 5. FlowView — position sourcing (`frontend/src/widgets/FlowView/index.js`)

Change the node position assignment to a three-tier fallback:

```js
const position =
  userPositionedNodes.current[p.id]          // 1. dragged this session
  || (p.flow_x != null && p.flow_y != null
       ? { x: p.flow_x, y: p.flow_y }        // 2. stored in DB
       : null)
  || autoLayout(p, depth, layer);             // 3. compute fresh
```

When the auto-layout path fires (tier 3), call `updateProcessPosition(p.id, pos.x, pos.y)` to persist it immediately.

### 6. FlowView — drag-end save

`handleNodesChangeWithTracking` already detects `change.type === 'position' && change.dragging === false`. After updating `userPositionedNodes.current`, also call `updateProcessPosition(change.id, change.position.x, change.position.y)`.

### 7. FlowView — remove position reset on new process

Currently `newProcessAdded` sets `userPositionedNodes.current = {}`, wiping all in-session positions. Remove this: the new process simply won't be in `userPositionedNodes.current`, so it falls through to tier 2 (DB) or tier 3 (auto-layout). Existing nodes keep their positions.

### 8. Auto-layout for unpositioned nodes (tier 3)

Keep the existing depth/layer algorithm but avoid placing new nodes on top of already-positioned nodes in the same layer. Concretely: within a depth layer, find the maximum `flow_y` among nodes that already have stored positions; place the new node below that. This prevents a newly added node from spawning on top of a manually repositioned one.
