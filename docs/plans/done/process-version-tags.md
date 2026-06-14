# Plan: Process Version Tags

## Overview

Add named, colored tags to process versions. Tags are project-scoped entities; process versions hold a many-to-many relationship to them. The FlowView widget gains a tag-filter bar and per-node tag display with an add-tag control. Filtering is purely client-side and does not affect the global ProcessContext.

---

## Backend

### 1. New DB models (`backend/models/process.py`)

**`ProcessTag`** — project-level tag definition:

| Column | Type | Notes |
|--------|------|-------|
| `id` | String UUID PK | |
| `project_id` | String FK → projects.id CASCADE | indexed |
| `name` | String(100) | not null |
| `color` | String(32) | CSS hex, e.g. `#28a745` |
| `created_at` | DateTime | |

Add `tags = relationship("ProcessTag", ...)` on `Project`.

**`ProcessVersionTag`** — join table (M2M):

| Column | Type | Notes |
|--------|------|-------|
| `process_version_id` | Integer FK → process_versions.id CASCADE | composite PK |
| `tag_id` | String FK → process_tags.id CASCADE | composite PK |
| `added_at` | DateTime | |
| `added_by` | String(255) | username |

Add `tags = relationship("ProcessTag", secondary=ProcessVersionTag, ...)` on `ProcessVersion`.

**New column on `ProcessVersion`**:

| Column | Type | Notes |
|--------|------|-------|
| `tags_history` | JSON | default `[]`; append-only log |

Each history entry (stored verbatim by name+color, not by ID, so it survives tag renames/deletions):
```json
{
  "action": "added" | "removed",
  "at": "<ISO datetime>",
  "by": "<username>",
  "name": "<tag name>",
  "color": "<tag color>"
}
```

### 2. `ProcessVersion.to_dict()` addition

Include current tags from the M2M relationship:
```python
"tags": [{"id": t.id, "name": t.name, "color": t.color} for t in self.tags]
```

Requires `selectinload(ProcessVersion.tags)` wherever versions are queried.

### 3. Alembic migration

Single migration file: `add_process_tags`:
- Create `process_tags` table
- Create `process_version_tags` table
- Add `tags_history` JSON column to `process_versions` (default `[]`)

### 4. New API router (`backend/routers/tags.py`)

Mounted at `/projects/{project_id}/tags` and `/process/{process_id}/versions/{version}/tags`.

| Method | Path | Action |
|--------|------|--------|
| `GET` | `/projects/{project_id}/tags` | List project tags |
| `POST` | `/projects/{project_id}/tags` | Create tag `{name, color}` |
| `PUT` | `/projects/{project_id}/tags/{tag_id}` | Update tag name/color |
| `DELETE` | `/projects/{project_id}/tags/{tag_id}` | Delete tag (cascade removes joins) |
| `POST` | `/process/{process_id}/versions/{version}/tags/{tag_id}` | Add tag to version; appends to `tags_history` |
| `DELETE` | `/process/{process_id}/versions/{version}/tags/{tag_id}` | Remove tag; appends removal to `tags_history` |

All tag mutation endpoints require the caller to be a project member (reuse the existing membership check pattern from `routers/projects.py`).

Register the router in `backend/main.py`.

---

## Frontend

### 5. API functions (`frontend/src/datamodel/api.js`)

Add six new functions following the existing fetch pattern:

```js
getProjectTags(projectId)           // GET /projects/{id}/tags
createProjectTag(projectId, tag)    // POST /projects/{id}/tags
updateProjectTag(projectId, tagId, tag) // PUT /projects/{id}/tags/{tagId}
deleteProjectTag(projectId, tagId)  // DELETE /projects/{id}/tags/{tagId}
addVersionTag(processId, version, tagId)    // POST /process/{id}/versions/{v}/tags/{tagId}
removeVersionTag(processId, version, tagId) // DELETE /process/{id}/versions/{v}/tags/{tagId}
```

### 6. TanStack Query hooks (`frontend/src/datamodel/useQueries.js`)

New query key:
```js
projectTags: (projectId) => ['projectTags', projectId],
```

New hooks:
- `useProjectTags(projectId)` — query, `staleTime: 30s`
- `useCreateTag(projectId)` — mutation, invalidates `projectTags`
- `useUpdateTag(projectId)` — mutation, invalidates `projectTags`
- `useDeleteTag(projectId)` — mutation, invalidates `projectTags`
- `useAddVersionTag(projectId)` — mutation, on success calls `invalidateProject(projectId)` via ProcessContext (so version.tags refreshes)
- `useRemoveVersionTag(projectId)` — same invalidation

### 7. New shared component: `TagBadge`

`frontend/src/widgets/FlowView/TagBadge.js`

A small pill rendered with the tag's `color` as background:
```jsx
<span style={{ background: tag.color, color: contrastColor(tag.color), ... }}>
  {tag.name}
</span>
```

Include a tiny utility `contrastColor(hex)` that returns black or white based on luminance.

### 8. Tag filter bar: `TagFilterBar`

`frontend/src/widgets/FlowView/TagFilterBar.js`

Props: `{ projectTags, selectedTagIds, onToggle }`

Renders a horizontal row of `TagBadge` buttons above the ReactFlow canvas. Clicking a tag toggles its presence in the active filter set. Active tags show a darker border/outline. If no tags are selected the bar shows a placeholder "Filter by tag…" hint.

### 9. Tag add/remove control in `ProcessNode`

`frontend/src/widgets/FlowView/ProcessNode.js`

Below the existing state badge, add:

1. **Tag chips row** — maps `versionObj.tags` → `<TagBadge>`. Each badge has an `×` remove button (calls `removeVersionTag`).
2. **"+ tag" button** — opens a small inline dropdown listing project tags not yet on this version. Selecting one calls `addVersionTag`. The dropdown also has a "New tag…" entry that opens a small inline form (name + color picker) to create a new tag and immediately apply it.

The dropdown should be a `<div>` with `position: absolute` rendered inside the node card, similar to how Bootstrap dropdowns work. Click-outside closes it.

ProcessNode receives two new props: `projectTags` and `currentProject`. The parent (`FlowView/index.js`) passes these down via the node `data` object.

### 10. Filter logic in `FlowView/index.js`

State addition:
```js
const [selectedFilterTagIds, setSelectedFilterTagIds] = useState(new Set());
```

Also fetch project tags:
```js
const { data: projectTags = [] } = useProjectTags(currentProject);
```

Compute `visibleProcesses` via `useMemo` whenever `processes` or `selectedFilterTagIds` changes. When the filter is empty, `visibleProcesses = processes` (identity — no copy). When active:

```
1. taggedVersions: Map<processId, Set<versionNumber>>
   — versions whose tags superset selectedFilterTagIds (match by tag id)

2. transitiveDeps: Map<processId, Set<versionNumber>>
   — BFS/DFS from all tagged versions along dependency edges
     (dep.source_process_id → dep.source_process_version)
     until no new entries

3. visibleProcesses:
   for each process in processes:
     if process.id in taggedVersions:
       include with versions filtered to taggedVersions[process.id]
     else if process.id in transitiveDeps:
       include with versions filtered to transitiveDeps[process.id]
     else: exclude
```

`visibleProcesses` (not `processes`) is passed to the node/edge building `useEffect`. The `selectedVersions` for newly visible processes default to the latest version in their filtered set. Processes absent from `visibleProcesses` are simply not rendered.

The tag filter bar is rendered as an absolutely-positioned div above the `<ReactFlow>` component, inside the outer wrapper div.

---

## Sequence of implementation steps

1. Backend models + migration
2. Backend router + register in main.py
3. Frontend API functions
4. Frontend query hooks
5. `TagBadge` component
6. `TagFilterBar` component
7. `ProcessNode` tag display + add/remove
8. Filter logic in `FlowView/index.js` + wire `TagFilterBar`

Each step can be reviewed independently. Steps 1–2 are backend-only; steps 3–8 are frontend-only with no further backend changes needed.
