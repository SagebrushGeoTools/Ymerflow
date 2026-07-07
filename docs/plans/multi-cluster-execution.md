# Multi-Cluster Process Execution — Plan

## Goal

Support running process jobs across multiple Kubernetes clusters (e.g. a local minikube plus a
GKE cluster), with the cluster for a given job chosen dynamically — per user, per project, or per
job — by a plugin hook, while every cluster can read/write the same project's storage regardless
of where the job lands.

## Depends on

[short-lived-storage-credentials.md](short-lived-storage-credentials.md) Phases 1–2: the
`StorageBackend` model, `Project.storage_backend_id`, and `hooks.run_first` /
sorted-entry-point infrastructure. Multi-cluster execution is only sound once a project's storage
is already resolved independently of any cluster — this plan does not re-litigate that, it assumes
it. It does **not** depend on that plan's Phases 3–4 (short-lived credential minting/refresh) —
this can be built first with `static-key` credentials and short-lived credentials layered in
later without changes to the cluster-selection design below.

## Background — current state

- A single global `k8s_client` singleton ([backend/services/k8s_client.py](../../backend/services/k8s_client.py))
  auto-detects in-cluster vs. local kubeconfig and talks to one namespace
  (`K8S_NAMESPACE` env var, default `nagelfluh-jobs`).
- `job_orchestrator.create_job_manifest()` ([backend/services/job_orchestrator.py](../../backend/services/job_orchestrator.py))
  builds one Job manifest against that one cluster/namespace/registry (`settings.registry_url`).
- `ProcessVersion.run_task()` ([backend/models/process.py:674](../../backend/models/process.py))
  already has `user`, `process`, and `process_version` in scope before job creation, and already
  calls one decision-shaped hook there — `job_pre_run(db, user, process, process_version)` — so the
  precedent for a per-job hook at exactly this point already exists.
- `ProcessVersion` already stores `k8s_namespace` per version alongside `k8s_job_name` — the schema
  already treats "which namespace did this run in" as a per-job fact, not a project-wide one. This
  plan extends that same idea to "which cluster."
- Monitoring (`monitor_job`), log streaming (`LogManager`), and cancel
  (`cancel_process_version_process__process_id__versions__version__cancel_post`) all currently go
  through the one global `k8s_client` — all three need to become cluster-aware.

## Architecture Summary

- **`Cluster`** — a new small config table: `{id, name, kubeconfig, registry_url, registry_auth,
  namespace}`. Same shape/spirit as the `StorageBackend` table in the storage-credentials plan —
  a small set of admin-managed rows, defaulting to "the one row" with zero configuration.
- **`select_cluster(db, user, process, process_version)` hook** — evaluated **per job launch**, in
  `run_task()`, right where `job_pre_run` already runs. Because it receives the same objects
  `job_pre_run` already does, per-user, per-project, per-process-type, and per-resource-request
  routing all fall out of the existing signature with no extra plumbing — e.g. a plugin can read
  `process.type`, `process_version.resource_requests`, or `user`'s tier without any new data being
  threaded through.
- **`k8s_client` becomes a per-cluster registry**, not a singleton — each `Cluster` row gets its
  own lazily-initialized `K8sClient` instance (same lazy-init pattern as today, just keyed by
  cluster id).
- **`ProcessVersion.k8s_cluster_id`** — new column next to the existing `k8s_namespace`, so
  monitoring/logs/cancel look up the right cluster after the fact instead of assuming the global
  singleton.
- **Storage stays exactly as decoupled as the dependency plan leaves it** — a project's
  `StorageBackend` never changes based on which cluster a given job runs on. The only new
  requirement this surfaces is operational, not code: **every cluster that can run a project's jobs
  must have network+DNS reachability to that project's storage endpoint.** For cloud storage
  (GCS/S3) this is free. For self-hosted MinIO, it is not: MinIO is reachable today only as an
  in-cluster `.svc.cluster.local` service, invisible to any other cluster. If a project's data
  lives in a MinIO instance inside cluster A and a job for it is routed to cluster B, MinIO needs a
  stable externally-reachable endpoint (LoadBalancer/Ingress + firewall rules) — an ops task per
  MinIO deployment that this plan calls out but does not automate.

---

## Phase 1 — `Cluster` model + bootstrap migration

### 1.1 Model

**New file: `backend/models/cluster.py`**

```python
from sqlalchemy import Column, String, DateTime, JSON
from datetime import datetime
import uuid

from backend.database import Base


class Cluster(Base):
    __tablename__ = "clusters"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    # NULL kubeconfig = auto-detect (in-cluster config or local kubeconfig), matching
    # today's K8sClient._ensure_initialized() behavior exactly.
    kubeconfig = Column(JSON, nullable=True)
    registry_url = Column(String(255), nullable=True)
    registry_auth = Column(String(255), nullable=True)
    namespace = Column(String(255), nullable=False, default="nagelfluh-jobs")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "registry_url": self.registry_url,
            "namespace": self.namespace,
            "created_at": self.created_at.isoformat(),
        }
```

Add to `ProcessVersion` ([backend/models/process.py](../../backend/models/process.py)), next to
the existing `k8s_namespace` column:

```python
k8s_cluster_id = Column(String(36), ForeignKey("clusters.id"), nullable=True)
```

Nullable and left `NULL` on historical rows — unlike `Project.storage_backend_id` in the
dependency plan, there is no need to backfill past process versions; they already ran and are
done. Only newly-launched jobs populate it.

### 1.2 Bootstrap migration

Same pattern as `short-lived-storage-credentials.md` §1.2 and the existing
`3e9d7f5a8c2d_add_bootstrap_environment.py` / `e2f3a4b5c6d7_seed_initial_admin.py` migrations:

```python
"""seed default cluster from config.env"""
from alembic import op
import sqlalchemy as sa
from datetime import datetime
import os

revision = '<new>'
down_revision = '<add_clusters_table>'

DEFAULT_ID = 'default-cluster-00000000-0000-0000-0000-000000000000'


def upgrade() -> None:
    from backend.config import settings
    conn = op.get_bind()

    exists = conn.execute(
        sa.text("SELECT COUNT(*) FROM clusters WHERE id = :id"), {"id": DEFAULT_ID}
    ).scalar()

    if not exists:
        conn.execute(sa.text("""
            INSERT INTO clusters
                (id, name, kubeconfig, registry_url, registry_auth, namespace, created_at)
            VALUES
                (:id, 'Default Cluster', NULL, :registry_url, :registry_auth, :namespace, :created_at)
        """), {
            "id": DEFAULT_ID,
            "registry_url": settings.registry_url,
            "registry_auth": settings.registry_auth,
            # K8S_NAMESPACE is a raw env var read directly in k8s_client.py, NOT a field
            # on backend.config.Settings — read it the same raw way here.
            "namespace": os.getenv("K8S_NAMESPACE", "nagelfluh-jobs"),
            "created_at": datetime.utcnow().isoformat(),
        })


def downgrade() -> None:
    pass
```

`kubeconfig=NULL` preserves today's auto-detect behavior exactly — no existing deployment needs to
supply an actual kubeconfig blob to keep working. Unlike the storage-backend bootstrap migration,
**no backfill of existing rows is needed** here (see 1.1) — the default row exists purely as the
fallback `select_cluster` resolves to for jobs launched after this migration runs.

---

## Phase 2 — `select_cluster` hook

Uses `hooks.run_first` from the dependency plan — no new hook-runner mechanics needed here.

**`backend/models/process.py`**, in `run_task()`, immediately after the existing `job_pre_run`
call (~line 730):

```python
DEFAULT_CLUSTER_ID = 'default-cluster-00000000-0000-0000-0000-000000000000'

cluster_id = hooks.run_first.select_cluster(DEFAULT_CLUSTER_ID, db, user, process, process_version)
process_version.k8s_cluster_id = cluster_id
await db.commit()
```

A plugin can key off any combination of `user` (tier/identity), `process.project_id`,
`process.type`, or `process_version.resource_requests` (e.g. route GPU-requesting jobs to a GKE
node pool with GPUs, everything else to minikube) — all already present in this call's arguments,
no new data threading required. Per `hooks.run_first`'s semantics (established in the dependency
plan), the first plugin (by sorted plugin name) to return non-`None` wins; disagreement between
plugins is not an error, just silently resolved by that ordering.

---

## Phase 3 — Per-cluster K8s client registry

**`backend/services/k8s_client.py`** changes from one module-level `k8s_client = K8sClient()`
singleton to a registry:

```python
class K8sClientRegistry:
    def __init__(self):
        self._clients = {}  # cluster_id -> K8sClient

    def get(self, cluster: "Cluster") -> K8sClient:
        if cluster.id not in self._clients:
            self._clients[cluster.id] = K8sClient(
                namespace=cluster.namespace,
                kubeconfig=cluster.kubeconfig,
            )
        return self._clients[cluster.id]


k8s_clients = K8sClientRegistry()
```

`K8sClient.__init__` and `_ensure_initialized()` change to accept an optional `kubeconfig` dict —
when `None`, fall back to today's exact auto-detect logic (`load_incluster_config()` then
`load_kube_config()`); when set, load that config explicitly
(`kubernetes_asyncio.config.load_kube_config_from_dict()` or equivalent).

Every call site that references the module-level `k8s_client` singleton today —
`job_orchestrator.py`, `monitor_job`, `LogManager`, the cancel endpoint in `routers/processes.py`,
`routers/utilities.py` — changes to first resolve the relevant `Cluster` row (via
`process_version.k8s_cluster_id`, falling back to the default cluster for any pre-existing rows
where it's `NULL`) and then `k8s_clients.get(cluster)`.

---

## Phase 4 — Routing existing operations through the resolved cluster

Each of these currently assumes the single global `k8s_client`; each needs the same one-line
change — resolve `Cluster` from `process_version.k8s_cluster_id`, then use
`k8s_clients.get(cluster)` in place of the module-level `k8s_client`:

- `job_orchestrator.create_job_manifest()` — also needs `cluster.registry_url` /
  `cluster.registry_auth` instead of `settings.registry_url` / `settings.registry_auth` when
  building the image reference and pull secret.
- `ProcessVersion.monitor_job()` and `_handle_job_completion()` — resume-after-restart logic reads
  `process_version.k8s_namespace` today; add `k8s_cluster_id` to that lookup.
- `LogManager` — log retrieval/streaming needs the right cluster's `K8sClient` to call
  `stream_pod_logs`/`get_pod_logs`.
- Cancel endpoint (`POST /process/{id}/versions/{version}/cancel`,
  `backend/routers/processes.py`) — deletes the K8s Job; must target the cluster the job actually
  ran on.
- `get_cluster_queue_limits()` (Kueue `ClusterQueue` read, used for resource-limit UI) — becomes
  per-cluster; a `select_cluster` plugin that wants to route by "which candidate cluster has
  headroom" would call this for each candidate before deciding.

---

## Implementation Order

1. **Phase 1** — `Cluster` model, `ProcessVersion.k8s_cluster_id`, bootstrap migration. Schema-only;
   no behavior change (nothing reads `k8s_cluster_id` yet).
2. **Phase 3** — `K8sClientRegistry`, `K8sClient` accepting explicit kubeconfig. Still no behavior
   change with one `Cluster` row — the registry always resolves the same client the singleton
   used to be.
3. **Phase 2** — `select_cluster` hook call site, populating `k8s_cluster_id` on every new job.
   Still resolves to the default cluster with zero plugins installed.
4. **Phase 4** — thread `k8s_cluster_id` through job creation, monitoring, logs, and cancel. This
   is the phase that actually makes a second `Cluster` row usable end-to-end; until it's complete,
   adding a second `Cluster` row and a `select_cluster` plugin would create jobs that can't be
   monitored or canceled correctly.

## Open Questions

- **MinIO cross-cluster reachability** is an ops decision, not a code one: does it make sense for
  your deployment to expose an in-cluster MinIO externally at all, or should any project whose jobs
  might run on more than one cluster be steered (via `select_storage`,
  [short-lived-storage-credentials.md](short-lived-storage-credentials.md)) toward cloud storage
  instead? Worth deciding per-deployment rather than in code.
- **Container registry reachability per cluster** — a job's Docker image must be pullable from
  wherever `select_cluster` routes it. `Cluster.registry_url` records where each cluster pulls
  from, but keeping an `Environment`'s image available in every registry a `Cluster` might need it
  from (e.g. mirroring) is an operational process this plan doesn't automate.
- **`select_cluster` failure/health awareness** — should the hook (or a wrapper around it) check
  cluster reachability/health before committing to a choice, or is a failed job launch (with a
  clear error) an acceptable fallback if a plugin routes to an unreachable cluster? Leaning toward
  the latter for a first version — add health-aware routing later if it proves necessary.
- **Admin UI for `Cluster` / `StorageBackend` management** — out of scope for this plan; both
  tables can be managed via direct DB access or a future admin endpoint, whichever is more
  urgent when this is scheduled.
