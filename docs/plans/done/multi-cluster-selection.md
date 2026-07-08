# User-Selectable Cluster & Per-Cluster Resource Limits — Plan

## Goal

Change cluster selection from a fully server-side decision (one hook, one winner, decided at job
launch) to a user-facing choice: the `select_clusters` hook now returns the **set** of clusters a
user is *allowed* to run on, the process editor shows those as a sorted dropdown with per-cluster
resource limits, and the user picks one. The choice is made and persisted at process-creation time,
then re-validated server-side on submission.

This also moves per-cluster resource ceilings (max CPU/RAM/runtime) out of a single
default-cluster-only Kueue lookup and makes them genuinely per-cluster.

## Supersedes / modifies

[multi-cluster-execution.md](done/multi-cluster-execution.md) (implemented). That plan is not being
redone — the `Cluster` model, `K8sClientRegistry`, and cluster-aware job creation/monitoring/logs/
cancel from Phases 1, 3, and 4 all stay as-is. Only Phase 2 (the `select_cluster` hook and where/
when cluster choice is decided) changes, plus new columns on `Cluster` and a new frontend surface.

## Depends on

[multi-cluster-execution.md](done/multi-cluster-execution.md) — this plan assumes `Cluster`,
`ProcessVersion.k8s_cluster_id`, `get_cluster_for_process_version()`, and the per-cluster
`K8sClientRegistry` already exist and work.

## Background — current state

(Confirmed by re-reading the implemented code, not just the plan doc.)

- `backend/models/cluster.py` — `Cluster` has `id, name, kubeconfig, registry_url, registry_auth,
  namespace, created_at`. No ordering column, no resource-limit columns, no active/retired flag.
- `backend/hooks.py` exposes three call styles: `hooks.run_first.<name>(default, ...)` (first
  plugin to answer non-`None` wins), `hooks.run.<name>(...)` / `hooks.run_async.<name>(...)`
  (calls **every** registered plugin and concatenates/flattens their non-empty results into one
  list — this is already "collect from all plugins," just not currently used by any
  cluster/storage hook).
- `select_cluster(db, user, process, process_version)` currently runs inside
  `ProcessVersion.run_task()` via `hooks.run_first`, **at job-launch time**, after the
  `Process`/`ProcessVersion` rows already exist. It returns one winning cluster id.
- `frontend/src/widgets/ProcessEditor.jsx` has a resource-request modal (CPU/memory sliders +
  deadline field) bounded by `useResourceLimits()` → `GET /utilities/resource-limits`. There is
  **no cluster-related UI anywhere in the frontend** today.
- `GET /utilities/resource-limits` (`backend/routers/utilities.py`) hardcodes reading Kueue
  `ClusterQueue` quota from the **default cluster only**, via
  `k8s_clients.get(cluster).get_cluster_queue_limits()` — even though that method is already
  per-cluster capable.
- `job_orchestrator.create_job_manifest()` already labels every job with
  `kueue.x-k8s.io/queue-name` and sets `suspend: true`, relying on Kueue's admission controller to
  unsuspend it. **Kueue is therefore already a hard requirement for job submission to work at all**
  on any cluster this system runs jobs on — a cluster without Kueue installed would leave jobs
  suspended forever. This rules out ever needing a "cluster without Kueue" resource-limits code
  path; CPU/RAM limits can always be live-fetched via Kueue per selected cluster.
- There is no admin UI for `Cluster` (or `StorageBackend`) rows — both are DB-access-only today.
  `frontend/src/AdminPage.jsx` / `TabbedPage.jsx` already provide a generic hook-based
  (`admin_tabs`) tab registration system (built for Users), which a future Cluster admin tab would
  reuse — **out of scope for this plan**, tracked as a separate plan (see Open Questions).

## Design decisions (settled in discussion)

- **Hook semantics**: switch from `hooks.run_first` (single winner) to `hooks.run` (collect from
  every registered plugin, union the results) — "allowed by any plugin ⇒ allowed." If **no**
  plugins are registered at all for `select_clusters`, fall back to all active clusters. If
  plugins **are** registered but their union is empty, that's a real "no clusters allowed for this
  user" result — not a fallback case.
- **Hook signature**: `select_clusters(db, user, project_id=None, resource_requests=None)`. No
  `process`/`process_version` — those don't exist yet at dropdown-open time. `project_id` is
  optional (process creation may not have a project chosen yet in some flows). `resource_requests`
  is optional and only passed when known — omitted on first dropdown render, included once the
  frontend has default/current slider values and always included at POST-time validation.
- **Selection timing**: the ProcessEditor fetches allowed clusters + their live limits when it
  opens. The user's pick is sent explicitly in the `POST /process` (and clone/re-run) payload and
  is validated **again** server-side (re-run the hook, re-check limits) before being persisted onto
  `ProcessVersion.k8s_cluster_id`. `run_task()` no longer calls `select_clusters` at all — it just
  reads the already-set `k8s_cluster_id`.
- **CPU/RAM limits**: stay live-fetched via Kueue (`get_cluster_queue_limits()`), generalized to
  whichever cluster is being queried instead of hardcoded to the default cluster. No DB storage —
  Kueue is already required for job admission on every cluster (see Background), so there's no
  "cluster without Kueue" case to design a fallback for.
- **Runtime limit**: `max_runtime_seconds` **is** a new stored column on `Cluster` — unlike CPU/RAM,
  there's no Kubernetes-native concept of a ceiling on job wall-clock duration to query live; it's
  a pure admin policy value. `NULL` = unbounded.
- **Retiring clusters**: soft delete via a new `active` boolean column (default `True`). Retired
  clusters are excluded from the dropdown and from the no-hook-registered fallback list, but the
  row and historical `ProcessVersion.k8s_cluster_id` FK references stay intact. A retired cluster
  may no longer physically exist — code paths that resolve a `Cluster` for a **historical** job
  (log streaming, monitor, cancel) must treat connection failure as an expected, clearly-surfaced
  error with a timeout, not a hang (per CLAUDE.md's hung-process guidance).
- **Ordering**: new `sort_order` integer column on `Cluster`; the dropdown (and the no-hook
  fallback list) is always sorted by it.
- **Backward compatibility for API/MCP clients**: `cluster_id` is optional on `ProcessCreate` (and
  the clone/re-run override). If omitted, the backend auto-selects the first allowed cluster by
  `sort_order` — this keeps existing scripted/MCP callers of `POST /process` working unchanged.

---

## Phase 1 — `Cluster` model changes + migration

### 1.1 New columns

**`backend/models/cluster.py`**:

```python
sort_order = Column(Integer, nullable=False, default=0)
active = Column(Boolean, nullable=False, default=True)
max_runtime_seconds = Column(Integer, nullable=True)  # NULL = unbounded
```

Update `to_dict()` to include `sort_order`, `active`, `max_runtime_seconds` (still omitting
`kubeconfig`/`registry_auth`).

### 1.2 Migration

Single linear chain, one head (`f6a7b8c9d0e1`, confirmed via `alembic heads`) — no branch/merge
concerns, just a normal next migration off the current head.

```python
def upgrade() -> None:
    with op.batch_alter_table('clusters') as batch_op:
        batch_op.add_column(sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'))
        batch_op.add_column(sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.true()))
        batch_op.add_column(sa.Column('max_runtime_seconds', sa.Integer(), nullable=True))
```

The existing bootstrap "Default Cluster" row gets `sort_order=0`, `active=True`,
`max_runtime_seconds=NULL` (unbounded) via the column defaults — no data migration needed.

---

## Phase 2 — `select_clusters` hook + allowed-clusters resolution helper

### 2.1 Hook infrastructure gap

`hooks.run.<name>(...)` (collect-all) has no way to distinguish "zero plugins registered" from
"plugins registered, all returned nothing" — both produce an empty flattened list today. This
distinction matters here (no plugins ⇒ fall back to all active clusters; plugins registered but
unanimous empty ⇒ genuinely no clusters allowed). Add a small helper to `backend/hooks.py`,
e.g. `hooks.any_registered(name)` (checks whether `_load_entry_points(name)` is non-empty), used
only by the resolution helper below — not a change to `run`/`run_first`/`run_async` themselves.

### 2.2 Resolution helper

**`backend/models/cluster.py`**, new function:

```python
async def get_allowed_clusters(db, user, project_id=None, resource_requests=None) -> list[Cluster]:
    if hooks.any_registered("select_clusters"):
        allowed_ids = set(hooks.run.select_clusters(db, user, project_id, resource_requests))
        stmt = select(Cluster).where(Cluster.id.in_(allowed_ids), Cluster.active == True)
    else:
        stmt = select(Cluster).where(Cluster.active == True)
    stmt = stmt.order_by(Cluster.sort_order)
    result = await db.execute(stmt)
    return result.scalars().all()
```

This is the single source of truth used by both the new available-clusters endpoint (Phase 3) and
process-creation validation (Phase 4) — the same logic, called twice (once for display, once for
enforcement), exactly like the client-side/server-side limit enforcement the user specified.

### 2.3 Remove old `select_cluster` call site

**`backend/models/process.py`**, in `run_task()`: delete the `hooks.run_first.select_cluster(...)`
block entirely (lines ~754-766 in the current implementation). `run_task()` now just resolves the
cluster already stored on `process_version.k8s_cluster_id` via the existing
`get_cluster_for_process_version()` helper — no hook call at launch time anymore, since the choice
was already made and validated at creation time (Phase 4).

---

## Phase 3 — Available-clusters endpoint with live per-cluster limits

Replace `GET /utilities/resource-limits` with a combined endpoint, e.g.
`GET /utilities/available-clusters?project_id=<id>&cpu=<n>&memory=<n>&deadline_seconds=<n>`
(query params optional, mirroring the optional `resource_requests` hook argument).

**`backend/routers/utilities.py`**:

```python
@router.get("/utilities/available-clusters")
async def available_clusters(project_id: str | None = None, cpu: str | None = None,
                              memory: str | None = None, deadline_seconds: int | None = None,
                              db=Depends(get_db), user=Depends(get_current_user)):
    resource_requests = {"cpu": cpu, "memory": memory} if cpu or memory else None
    clusters = await get_allowed_clusters(db, user, project_id, resource_requests)
    out = []
    for cluster in clusters:
        limits = await k8s_clients.get(cluster).get_cluster_queue_limits()
        if limits is None:
            limits = {"max_cpu_cores": 8.0, "max_memory_gb": 32.0}  # same fallback as today
        out.append({
            **cluster.to_dict(),
            "max_cpu_cores": limits["max_cpu_cores"],
            "max_memory_gb": limits["max_memory_gb"],
            "max_runtime_seconds": cluster.max_runtime_seconds,
        })
    return out
```

Delete the old `/utilities/resource-limits` route and its hardcoded `DEFAULT_CLUSTER_ID` lookup.

### 3.1 Expose as an MCP tool

MCP tools are generated by `fastapi-mcp` from an explicit tag allowlist
(`include_tags=["Processes", "Datasets", "Environments", "Uploads", "Workspaces"]` in
`backend/main.py`) — routes are opt-in per-tag, not exposed automatically. `utilities_router` is
tagged `"Utilities"`, which is **not** in that allowlist, so nothing under `/utilities` is an MCP
tool today. Since this one endpoint already returns both the allowed-cluster list and each
cluster's live resource limits together (per the design above), give this specific route its own
tag override so only it — not the rest of `utilities_router` — becomes an MCP tool:

```python
@router.get("/utilities/available-clusters", tags=["Processes"])
```

`"Processes"` fits semantically (this is data an MCP client needs before calling
`create_process_process_post`) and is already in `include_tags`, so no change to `main.py` is
needed. Also add an entry for the new tool to `docs/mcp-tools.md` (manually maintained, not
auto-generated).

---

## Phase 4 — Process creation/validation

### 4.1 `ProcessCreate` gets `cluster_id`

**`backend/routers/processes.py`**: add `cluster_id: str | None = None` to `ProcessCreate` and to
the clone/re-run override model.

### 4.2 Validation at `POST /process` (and clone/re-run)

```python
allowed = await get_allowed_clusters(db, user, process.project_id, resource_requests)
if not allowed:
    raise HTTPException(400, "No clusters available to run this process.")
if cluster_id is None:
    cluster = allowed[0]  # first by sort_order — MCP/script clients that omit cluster_id
else:
    cluster = next((c for c in allowed if c.id == cluster_id), None)
    if cluster is None:
        raise HTTPException(400, f"Cluster {cluster_id} is not allowed for this request.")

limits = await k8s_clients.get(cluster).get_cluster_queue_limits() or {"max_cpu_cores": 8.0, "max_memory_gb": 32.0}
# parse resource_requests cpu/memory strings and compare against limits; compare deadline_seconds
# against cluster.max_runtime_seconds (if not NULL); raise HTTPException(400, ...) on violation.

process_version.k8s_cluster_id = cluster.id
```

This mirrors what the client already enforced via sliders — the server re-derives the same allowed
set and limits independently rather than trusting the submitted `cluster_id`/`resource_requests`
blindly, exactly as specified.

---

## Phase 5 — Frontend: cluster dropdown in `ProcessEditor`

- New hook in `frontend/src/datamodel/useQueries.js`: `useAvailableClusters(projectId,
  resourceRequests)` → `GET /utilities/available-clusters`, replacing `useResourceLimits()`.
- `ProcessEditor.jsx`: add a cluster `<select>` to the resource-request modal, listing
  `useAvailableClusters` results in the order returned (already `sort_order`-sorted server-side).
  Default selection = first entry.
- CPU/memory slider max and the deadline input max are driven by the **selected** cluster's
  `max_cpu_cores` / `max_memory_gb` / `max_runtime_seconds` (`null` → no upper bound on the
  deadline input). Switching the cluster dropdown re-clamps any slider value that now exceeds the
  new cluster's limits.
- On submit, include the selected `cluster_id` in the `useCreateProcess` mutation payload (and the
  clone/re-run mutation).

---

## Phase 6 — Graceful handling of retired/unreachable clusters

Audit the call sites that resolve a `Cluster` for an **already-launched** job — `LogManager`,
`ProcessVersion.monitor_job()`/`_handle_job_completion()`, and the cancel endpoint — to confirm each
K8s API call against a resolved cluster has a timeout and surfaces a clear error (e.g. "cluster no
longer reachable") rather than hanging, since `active=False` clusters may have been physically torn
down. This is enforcement of CLAUDE.md's existing timeout/circuit-breaker guidance, applied
specifically to the new retirement case — not new infrastructure.

---

## Implementation Order

1. **Phase 1** — schema only, no behavior change (resolve the alembic head divergence first).
2. **Phase 2** — hook + resolution helper; still resolves to "all active clusters" with zero
   plugins installed, so no behavior change yet for existing single-cluster deployments.
3. **Phase 3** — new endpoint, additive; old `/utilities/resource-limits` can be removed in the
   same change since Phase 5 will stop calling it.
4. **Phase 4** — validation/persistence at creation time. This is the phase that actually changes
   behavior for existing deployments (cluster choice moves from launch-time to creation-time) —
   do this together with Phase 5 so the UI and API contract land atomically.
5. **Phase 5** — frontend dropdown + limit-driven sliders.
6. **Phase 6** — audit pass, can happen any time after Phase 1 lands `active`.

## Open Questions

- **Admin UI for `Cluster` CRUD** (register/retire clusters, edit `sort_order`/`max_runtime_seconds`/
  `registry_url`/`kubeconfig`) is intentionally a **separate plan**, reusing the `admin_tabs` /
  `TabbedPage` pattern from
  [admin-page-and-url-routed-tabs.md](done/admin-page-and-url-routed-tabs.md) (the same gap already
  flagged as out-of-scope in the original multi-cluster-execution plan, for both `Cluster` and
  `StorageBackend`). Until that plan lands, the new `sort_order`/`active`/`max_runtime_seconds`
  columns are managed via direct DB access, same as the rest of the `Cluster` row today.
- **`resource_requests` shape passed to the hook** — the existing `ResourceRequests` Pydantic model
  (`cpu`/`memory`/`ephemeral-storage` strings) is reused as-is; the hook receives it as a plain
  dict, not a new type.
