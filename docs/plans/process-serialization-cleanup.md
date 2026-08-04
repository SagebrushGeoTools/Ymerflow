# Cleanup: server-side environment/cluster resolution, ProcessInfo dumps the real object

## Goal

Stop resolving `environment_id`/`cluster_id` → display name on the client. `Process.to_dict()`
and `ProcessVersion.to_dict()` should return the resolved objects (`environment: {id, name}`,
`cluster: {id, name}`) directly, the same way `ProcessInfo.jsx` currently fakes it by joining
against a separately-fetched `useEnvironments()` list. `ProcessInfo` already reads its `process`/
`versionObj` from the exact same `processes` data (`ProcessContext`/`useProcesses`) that
`ProcessEditor` reads — there is no second copy of the data to unify. The only thing that needs to
change in `ProcessInfo` is: stop building a hand-picked `config` object (a field whitelist) and
instead serialize the real, already-server-resolved object to YAML directly. `ProcessEditor` is not
touched except for the two lines that read the now-nested `environment`/`cluster` shape instead of
flat ids.

## Current state (confirmed by reading the code, not the earlier plan docs)

- `Process.to_dict()` (`backend/models/process.py:61-72`) returns flat `environment_id`.
  `ProcessVersion.to_dict()` (`process.py:295-322`) returns flat `cluster_id` (line 320).
- A `Process.environment` relationship **already exists** (`process.py:56`,
  `back_populates="processes"` on `Environment.processes`, `environment.py:21`) but is unused by
  `to_dict()` and never eager-loaded by the routers.
- **No** `ProcessVersion.cluster` relationship exists — `k8s_cluster_id` (`process.py:267`) is a
  bare FK column. The only existing resolution path is the imperative async helper
  `get_cluster_for_process_version(db, process_version)` (`backend/models/cluster.py:72-84`), used
  today only in execution-path code (job orchestration, cancel), never in list serialization.
- `GET /processes` and `GET /process/{id}` (`backend/routers/processes.py:150-153`, `203-206`)
  already eager-load nested collections via chained `selectinload`:
  ```python
  selectinload(Process.versions).selectinload(ProcessVersion.datasets),
  selectinload(Process.versions).selectinload(ProcessVersion.tags),
  ```
  Adding `selectinload(Process.environment)` is a one-line addition to both. Adding cluster
  eager-loading needs the new relationship from Phase 1 first.
- `ProcessInfo.jsx` (`frontend/src/widgets/ProcessInfo.jsx:80-92`) builds a hand-picked `config`
  object (whitelist of field names) and hand-serializes it via a bespoke `toYaml()` (lines 7-35) +
  `renderYamlWithLinks()` (37-57). It resolves `environment` itself via `useEnvironments()` — this
  is the exact client-side join this plan removes. It has no `cluster` field at all today.
- `ProcessEditor.jsx`'s "Resource Configuration" card (`ProcessEditor.jsx:262-281`) shows
  `selectedCluster?.name` resolved from `useAvailableClusters(currentProject, {cpu, memory})`
  (line 62-67) — a **live availability/fitting** query (calls Kueue per cluster,
  `backend/routers/utilities.py:36-39`), not a plain id→name lookup. For an existing, already-saved
  process version this is the wrong source for "what cluster is this actually on": a since-retired
  or no-longer-fitting cluster silently disappears from `clusters`, and `selectedCluster` falls
  through to `clusters[0]` (a different, wrong cluster) or `null` — see `ProcessEditor.jsx:67`.
- Both edit-state syncs read the flat ids directly:
  `ProcessEditor.jsx:110` — `setLocalEnvironment(process.environment_id)`
  `ProcessEditor.jsx:120` — `setClusterId(versionObj.cluster_id ?? null)`
  `SaveModelDialog.jsx:32` — `fullSourceProcess?.environment_id || selectedEnvironment || ''`
- Submit payloads (`ProcessEditor.jsx:165,181,167,183`, `SaveModelDialog.jsx:90`) send flat
  `environment_id`/`cluster_id` to `POST /process`, matching the independent `ProcessCreate`/
  `CloneRequest` Pydantic request models (`processes.py:29,35,274`) — **these are not derived from
  `to_dict()`** and are out of scope; request shape stays flat regardless of what this plan does to
  response shape.
- Legacy rows: `ProcessVersion.k8s_cluster_id` is nullable (predates multi-cluster support).
  `get_cluster_for_process_version()` treats `NULL` as "the bootstrap default cluster, which is
  exactly the single cluster they actually ran on" (`cluster.py:75-78`, `DEFAULT_CLUSTER_ID`
  constant at `cluster.py:8`). Naively eager-loading a `ProcessVersion.cluster` relationship off the
  raw FK would **not** apply this fallback — a legacy row's relationship would just resolve to
  `None`, understating what actually happened.

## Design decisions (settled in discussion)

1. **Replace, don't duplicate.** `to_dict()` drops `environment_id`/`cluster_id` entirely and
   returns only the nested `environment`/`cluster` objects. No flat id kept alongside. Any other
   consumer of these response shapes (MCP tools, `docs/mcp-tools.md`) gets updated in Phase 4.

2. **Legacy NULL cluster → `cluster: null`, no fallback resolution.** `to_dict()` stays
   synchronous and argument-free — no `default_cluster` parameter threaded through it. The frontend
   shows a plain placeholder (e.g. "—") for these old rows. This intentionally diverges from
   `get_cluster_for_process_version()`'s runtime behavior (which resolves NULL to the bootstrap
   default cluster for job execution) — that function is unchanged and keeps doing its own
   fallback for execution; only *display* skips it, since these rows are rare/old (the system was
   single-cluster before multi-cluster support existed).

3. **`ProcessEditor`'s Resource Configuration card gets fixed too.** Source the displayed cluster
   name from `versionObj.cluster?.name` (the actual saved value) while unedited, falling back to
   the live `clusters` (`useAvailableClusters`) list only once the user opens the edit modal and is
   actively picking a different cluster. `useAvailableClusters` is otherwise unchanged — still used
   to populate edit-mode options and bound the sliders.

---

## Phase 1 — Backend: resolve environment/cluster server-side

### 1.1 `ProcessVersion.cluster` relationship

**`backend/models/process.py`**, add to `ProcessVersion` relationships (near line 283-285):
```python
cluster = relationship("Cluster", foreign_keys=[k8s_cluster_id], viewonly=True)
```
`viewonly=True` since nothing should mutate cluster assignment through this relationship —
`k8s_cluster_id` stays the column that's actually written.

### 1.2 Eager-load in both process routers

**`backend/routers/processes.py:150-153` and `:203-206`**, add:
```python
selectinload(Process.environment),
selectinload(Process.versions).selectinload(ProcessVersion.cluster),
```
Both are single batched queries added to the existing statement — not per-row, no N+1.

### 1.3 `to_dict()` changes

**`backend/models/process.py`**, `Process.to_dict()` (61-72): replace `"environment_id":
self.environment_id` with `"environment": self.environment.to_dict() if self.environment else
None`.

`ProcessVersion.to_dict()` (295-322): replace `"cluster_id": self.k8s_cluster_id` with
`"cluster": self.cluster.to_dict() if self.cluster else None`. No fallback resolution for legacy
NULL rows — `to_dict()` stays synchronous and argument-free, per decision 2.

### 1.4 Other `to_dict()` call sites

Grep every call site of `Process.to_dict()` / `ProcessVersion.to_dict()` (clone endpoint,
`processes.py:356` builds its own dict already so unaffected; any WebSocket state-push code) to
confirm none of them special-case the flat `environment_id`/`cluster_id` keys in a way that breaks
silently — update any that do.

---

## Phase 2 — Frontend: `ProcessInfo` stops whitelisting fields

**`frontend/src/widgets/ProcessInfo.jsx`**:
- Delete the `useEnvironments()` call and the manual `environment` lookup (lines 61, 81) — the
  resolved `environment`/`cluster` objects now come straight from `process`/`versionObj`, the exact
  same objects `ProcessEditor` already reads from the same `processes` query data.
- Replace the hand-picked `config` object (82-92): instead of listing fields in one-by-one, take
  the real `process` object (excluding `versions`, and excluding pure-UI-layout fields
  `flow_x`/`flow_y`) merged with the found `versionObj`, and serialize *that* to YAML. This becomes
  an **exclude-list** (a fixed, small set of fields that are genuinely not meaningful to show), not
  an include-list — new backend fields appear automatically instead of requiring a frontend change
  to surface them, which is the actual bug being fixed.
- Keep `toYaml()`/`renderYamlWithLinks()` (lines 7-57) as local, private implementation detail of
  this one widget — it's just "how ProcessInfo happens to pretty-print an object," not something any
  other widget needs to import or agree with. No new shared module.

---

## Phase 3 — Frontend: `ProcessEditor` reads the new nested shape

**`frontend/src/widgets/ProcessEditor.jsx`** — only the two edit-state-sync reads need updating to
match the new response shape; the widget's own display/editing logic is unchanged:
- `:110` — `setLocalEnvironment(process.environment_id)` → `setLocalEnvironment(process.environment?.id)`.
- `:120` — `setClusterId(versionObj.cluster_id ?? null)` → `setClusterId(versionObj.cluster?.id ?? null)`.
- Resource Configuration card (262-281): source `Cluster:` display from `versionObj.cluster?.name`
  when unedited, falling back to the live `clusters`/`selectedCluster` lookup once the user is
  actively picking a new one in the edit modal.
- **`useAvailableClusters` stays** — it's still required to populate the edit-modal `<select>`
  options and to bound the CPU/memory/deadline sliders/limits. This plan only removes it as the
  source for **display of the already-saved value**, not as the source of editable options.

**`frontend/src/widgets/AEMModelSimulator/SaveModelDialog.jsx:32`**:
`fullSourceProcess?.environment_id || ...` → `fullSourceProcess?.environment?.id || ...`.

---

## Phase 4 — Docs / MCP

Update `docs/mcp-tools.md` (and any other doc quoting the `environment_id`/`cluster_id` response
shape) to reflect the new nested `environment`/`cluster` objects in process/version responses.

---

## Verification

- `GET /processes` and `GET /process/{id}` return `environment`/`cluster` nested objects, no N+1
  (check query count/logs during a list call with several processes).
- `ProcessInfo` shows cluster name for a process created after multi-cluster support landed.
- `ProcessInfo` shows `cluster: null` (rendered as a plain placeholder) for a pre-multi-cluster
  legacy process version, if one still exists in dev data — not an error, not a crash.
- `ProcessEditor`'s Resource Configuration card shows the correct cluster name for an existing
  process even when that process's cluster is deactivated or no longer resource-fitting (i.e. would
  have disappeared from the old `useAvailableClusters`-only lookup) — this is the regression test
  for the bug that motivated this cleanup.
- Editing still works: opening the resource modal still lists live-fitting clusters and lets you
  reassign; submitting still posts flat `environment_id`/`cluster_id` (request shape, unchanged by
  this plan).
