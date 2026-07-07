# Short-Lived, Per-Project Storage Credentials — Plan

## Goal

Decouple a project's storage backend (MinIO / GCS / S3) from the single global setting it is
today, and replace the single static, non-expiring credential pair stored on `Project` with a
pluggable per-backend credential strategy that supports short-lived, auto-refreshed credentials.

This plan is **independent of multi-cluster execution** ([multi-cluster-execution.md](multi-cluster-execution.md))
and ships value on the existing single-minikube deployment: today, `Project.storage_access_key` /
`storage_secret_key` are static forever. That is a real security gap regardless of how many
clusters ever run jobs. Multi-cluster execution *depends* on this plan's `StorageBackend` model
(a project's storage must already be resolved independently of where its jobs run), but this plan
does not depend on multi-cluster in any direction.

## Background — current state

- `backend/config.py` has global `storage_protocol` / `storage_endpoint` / `storage_bucket_prefix`
  — every project uses the same backend.
- `Project.storage_access_key` / `storage_secret_key` ([backend/models/project.py](../../backend/models/project.py))
  store one static, non-expiring credential pair per project, provisioned once by
  `setup_project_storage()` ([backend/services/minio_service.py](../../backend/services/minio_service.py))
  and called from `POST /project` ([backend/routers/projects.py:74](../../backend/routers/projects.py)).
- `ProcessVersion.run_task()` ([backend/models/process.py:674](../../backend/models/process.py)) calls
  `ensure_project_k8s_secret()` / `setup_project_storage()` before every job launch, injecting the
  static key pair as `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` env vars into the pod
  (`backend/services/job_orchestrator.py:96-120`).
- `is_minio_enabled()` gates MinIO-specific provisioning; cloud backends (GCS/S3) have no
  equivalent provisioning path today — the assumption baked into the code is "one backend, one
  provisioning strategy, for everyone."

## Architecture Summary

- **`StorageBackend`** — a new small config table describing a storage target and how to obtain
  credentials for it. Analogous in spirit to `Environment` (a docker image + process types):
  a `StorageBackend` is a connection target + a credential strategy.
- **`select_storage(db, user, project)` hook** — resolves which `StorageBackend` a *new* project
  uses. Runs **once**, at project creation, via `hooks.run_first` (see below). Result is persisted
  on `Project.storage_backend_id` — a project's storage never silently moves after creation.
- **Credential strategies** — a small pluggable interface
  (`backend/services/storage_credentials.py`) keyed by `StorageBackend.credential_strategy`:
  - `static-key` (default, matches today's behavior exactly): provision once, store on `Project`,
    never expires, never refreshes.
  - `short-lived` (GCP impersonation / AWS STS `AssumeRole` / MinIO expiring service account):
    mint a scoped, time-boxed credential per job launch, and refresh it on a timer for the life of
    the job.
  Both strategies present the same interface to callers (`mint(project, backend) -> {credentials,
  expires_at}`), so job launch and the runner's refresh loop don't need to know which strategy is
  in play — `expires_at is None` simply means "never refresh."
- **`hooks.run_first(name, default, *args, **kwargs)`** — new addition to `backend/hooks.py`,
  alongside the existing `run` / `run_async`. Returns the first non-`None` result from registered
  plugins (in plugin-name sort order — see below), or `default` if none answer. `select_storage`
  and `select_cluster` ([multi-cluster-execution.md](multi-cluster-execution.md)) both use this;
  none of today's existing hooks change their calling style.
- **Deterministic hook order** — `_load_entry_points` sorts by `ep.dist.name` before returning, so
  `run_first`'s "first" is well-defined and every existing fan-out hook
  (`job_pre_run`, `job_completed`, `user_created`, etc.) becomes deterministic as a side effect.

---

## Phase 1 — `StorageBackend` model + bootstrap migration

### 1.1 Model

**New file: `backend/models/storage_backend.py`**

```python
from sqlalchemy import Column, String, DateTime, JSON
from datetime import datetime
import uuid

from backend.database import Base


class StorageBackend(Base):
    __tablename__ = "storage_backends"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    protocol = Column(String(32), nullable=False)          # s3, gcs, az, file
    endpoint = Column(String(255), nullable=True)           # MinIO URL; empty for real cloud
    bucket_prefix = Column(String(255), nullable=False)
    credential_strategy = Column(String(32), nullable=False, default="static-key")
    # Strategy-specific connection config (e.g. MinIO admin alias, GCP SA email to
    # impersonate, AWS role ARN). Opaque to everything except the strategy implementation.
    config = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "protocol": self.protocol,
            "endpoint": self.endpoint,
            "bucket_prefix": self.bucket_prefix,
            "credential_strategy": self.credential_strategy,
            "created_at": self.created_at.isoformat(),
        }
```

Add `Project.storage_backend_id` (nullable FK, `backend/models/project.py`):

```python
storage_backend_id = Column(String(36), ForeignKey("storage_backends.id"), nullable=True)
storage_backend = relationship("StorageBackend")
```

Nullable because historical rows are backfilled in a second step (1.2), not because it's ever
expected to be unset for a project going forward.

### 1.2 Bootstrap migration

Follows the same pattern as `3e9d7f5a8c2d_add_bootstrap_environment.py` (fixed well-known UUID,
idempotency check) and `e2f3a4b5c6d7_seed_initial_admin.py` (`from backend.config import
settings` read live inside `upgrade()`):

```python
"""seed default storage backend from config.env"""
from alembic import op
import sqlalchemy as sa
from datetime import datetime
import os

revision = '<new>'
down_revision = '<add_storage_backends_table>'

DEFAULT_ID = 'default-storage-backend-00000000-0000-0000-0000-000000000000'


def upgrade() -> None:
    from backend.config import settings
    conn = op.get_bind()

    exists = conn.execute(
        sa.text("SELECT COUNT(*) FROM storage_backends WHERE id = :id"),
        {"id": DEFAULT_ID},
    ).scalar()

    if not exists:
        conn.execute(sa.text("""
            INSERT INTO storage_backends
                (id, name, protocol, endpoint, bucket_prefix, credential_strategy, config, created_at)
            VALUES
                (:id, 'Default Storage Backend', :protocol, :endpoint, :bucket_prefix,
                 'static-key', '{}', :created_at)
        """), {
            "id": DEFAULT_ID,
            "protocol": settings.storage_protocol,
            "endpoint": settings.storage_endpoint,
            "bucket_prefix": settings.storage_bucket_prefix,
            "created_at": datetime.utcnow().isoformat(),
        })

    conn.execute(sa.text("""
        UPDATE projects SET storage_backend_id = :id WHERE storage_backend_id IS NULL
    """), {"id": DEFAULT_ID})


def downgrade() -> None:
    pass  # cannot cleanly undo a backfill
```

This matches `config.env` in every environment because `settings` reads real environment
variables (with `config.env` only as local-dev fallback) — the same values the running backend
already uses today, in dev and in prod-minikube (where the k8s ConfigMap overrides
`STORAGE_ENDPOINT` / `STORAGE_PROTOCOL`).

**Existing projects are backfilled to this row in the same migration** — `storage_backend_id` is a
new FK on a table with live data, unlike per-job fields, so it cannot be left `NULL` for rows that
already have a working bucket.

---

## Phase 2 — `hooks.run_first` + `select_storage`

### 2.1 `backend/hooks.py` additions

```python
def _load_entry_points(name):
    eps = importlib.metadata.entry_points(group='nagelfluh.hooks')
    eps = sorted((ep for ep in eps if ep.name == name), key=lambda ep: ep.dist.name)
    return [ep.load() for ep in eps]


def _run_first(name, default, *args, **kwargs):
    for fn in _load_entry_points(name):
        result = fn(*args, **kwargs)
        if result is not None:
            return result
    return default


class _Hooks:
    run = _Namespace(_run_sync)
    run_async = _AsyncNamespace()
    run_first = _Namespace(_run_first)   # NOTE: run_first's signature is (name, default, *args)
                                          # — the _Namespace.caller forwards default through args
```

`run_first` deliberately does **not** raise on disagreement between plugins — first registered
(now: first by plugin-name sort order) wins, the rest are silently ignored. Document this in the
docstring so a plugin author doesn't assume any other precedence.

### 2.2 `select_storage` hook — call site

**`backend/routers/projects.py`**, in `create_project` (currently line ~74), immediately after the
`Project` row is inserted and before `setup_project_storage` is called:

```python
from backend.hooks import hooks
from backend.models.storage_backend import StorageBackend

DEFAULT_STORAGE_BACKEND_ID = 'default-storage-backend-00000000-0000-0000-0000-000000000000'

backend_id = hooks.run_first.select_storage(DEFAULT_STORAGE_BACKEND_ID, db, user, project)
project.storage_backend_id = backend_id
await db.commit()
```

A plugin implementing this hook receives the same shape of context `job_pre_run` already does
(`db`, the acting `user`, and the object being decided about) — e.g. a billing-tier plugin could
route free-tier users to a shared MinIO backend and paying users to a dedicated GCS bucket.

### 2.3 Provisioning becomes backend-parametrized

`setup_project_storage()` currently assumes MinIO unconditionally. It becomes dispatch on
`project.storage_backend.protocol` / `credential_strategy`, delegating to the strategy interface
in Phase 3 rather than hardcoding MinIO calls. `is_minio_enabled()` becomes one branch of that
dispatch, not a global gate.

---

## Phase 3 — Credential strategies

**New file: `backend/services/storage_credentials.py`**

```python
class CredentialStrategy:
    def provision(self, project, backend) -> dict:
        """Called once, at project creation. Returns credentials to persist on Project
        (or {} if this strategy never persists anything — e.g. always-minted strategies)."""
        raise NotImplementedError

    def mint(self, project, backend) -> dict:
        """Called at every job launch and on every refresh. Returns
        {credentials: {...}, expires_at: datetime | None}. expires_at=None means the
        credential never needs refreshing (e.g. static-key)."""
        raise NotImplementedError


class StaticKeyStrategy(CredentialStrategy):
    """Today's behavior, made explicit. provision() is what setup_project_storage()
    already does; mint() just returns the already-provisioned Project columns."""
    def provision(self, project, backend):
        ...  # existing MinIO bucket/user/policy creation, or cloud SA + key creation

    def mint(self, project, backend):
        return {
            "credentials": {
                "access_key": project.storage_access_key,
                "secret_key": project.storage_secret_key,
            },
            "expires_at": None,
        }


class ShortLivedStrategy(CredentialStrategy):
    """GCP: IAM Credentials API generateAccessToken via impersonation (+ Credential Access
    Boundary to downscope to this project's bucket/prefix). AWS: STS AssumeRole. MinIO:
    expiring service account. Lifetime pegged to the shortest common cap across backends
    actually in use (~1h) for uniform refresh cadence, even where a given backend (MinIO)
    could go longer — see Phase 4."""
    def provision(self, project, backend):
        return {}  # nothing persisted; every mint() call produces a fresh credential

    def mint(self, project, backend):
        ...  # dispatch on backend.protocol: impersonation / AssumeRole / MinIO STS
```

`StorageBackend.credential_strategy` selects which class `setup_project_storage()` and the job
orchestrator instantiate. The **hard ceilings** that shape `ShortLivedStrategy`'s lifetime choice:

| Backend | Mechanism | Hard max lifetime |
|---|---|---|
| GCP | IAM Credentials API `generateAccessToken` (impersonation) | 1h (12h only if org policy `iam.allowServiceAccountCredentialLifetimeExtension` is enabled) |
| AWS | STS `AssumeRole` | 12h, hard ceiling on `MaxSessionDuration`, no override |
| MinIO | expiring service account / native STS | operator-configurable, no external ceiling |

A single non-refreshed credential cannot cover a 36h+ inversion job on GCP or AWS at any lifetime
— this is a product limit, not an engineering gap. Hence Phase 4.

---

## Phase 4 — Runner-side refresh loop

Required for `ShortLivedStrategy` regardless of cluster count or topology (established: token
lifetime is a function of job duration vs. issuer cap, not of where the job runs).

### 4.1 Per-job refresh token

At job launch (`job_orchestrator.create_job_manifest`), alongside the minted storage credential,
generate a random opaque `REFRESH_TOKEN` (e.g. `secrets.token_urlsafe(32)`), store its hash on
`ProcessVersion` (new column `refresh_token_hash`), and inject the plaintext as an env var
(`STORAGE_REFRESH_TOKEN`) into the pod — same delivery mechanism as every other env var already
injected today, no new distribution channel.

This sidesteps validating a Kubernetes ServiceAccount token across cluster boundaries (which would
require the backend to trust each cluster's own OIDC issuer — real complexity once
[multi-cluster-execution.md](multi-cluster-execution.md) lands) in favor of a credential-agnostic
opaque secret that works identically regardless of which cluster the pod is in.

### 4.2 New backend endpoint

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/internal/process/{process_id}/versions/{version}/storage-credentials/refresh` | `STORAGE_REFRESH_TOKEN` header, hash-compared | Re-mints and returns a fresh storage credential for this job |

Backend re-runs `strategy.mint(project, backend)` and returns the new credential + its
`expires_at`. Rate-limited/backed off gracefully — a transient failure here must not fail a 36h
job outright (§4.4).

### 4.3 Runner changes

`docker/base-runner/runner.py` gains a background refresh loop for any process whose storage
context reports a non-`None` `expires_at`:

- Re-fetch a fresh credential at roughly half the remaining lifetime (e.g. ~30 min into a 1h
  token), not just reactively on auth failure — a 36h job must never hit a hard expiry boundary.
- Swap the new credential into the live fsspec filesystem instance. This needs the storage_context
  wrapper to hold a mutable/rebuildable fsspec filesystem rather than one constructed once at
  process start — a real code change to how `nagelfluh_processes`/`aem_processes` obtain their
  filesystem object, since `storage_context` is passed as a plain dict today.
- Retry with backoff on refresh failure; only fail the process if refresh has been failing long
  enough that the *current* credential is actually expired, not on the first transient error.

### 4.4 Failure modes to design for explicitly

- Backend restart mid-job: refresh calls should retry across a backend outage window, not fail
  immediately — a rolling backend restart must not kill a 36h inversion.
- Rate limiting: many long jobs refreshing on similar cadences could produce bursts of IAM/STS
  calls; unlikely to matter at current scale but worth a jittered refresh interval from the start
  rather than retrofitting it later.

---

## Implementation Order

1. **Phase 1** — `StorageBackend` model, `Project.storage_backend_id`, bootstrap migration. Pure
   schema + data migration; no behavior change (everything still resolves to the one bootstrap
   row).
2. **Phase 2** — `hooks.run_first`, sorted entry points, `select_storage` call site. Still no
   behavior change with zero plugins installed — `default` always wins.
3. **Phase 3** — `StaticKeyStrategy` extracted from today's `minio_service.py` code (refactor, not
   a behavior change) + `setup_project_storage()` dispatches on `credential_strategy`.
4. **Phase 4** — `ShortLivedStrategy` + refresh loop. This is the only phase that changes runtime
   behavior for real jobs, and only for `StorageBackend` rows explicitly configured with
   `credential_strategy: short-lived` — the bootstrap row stays `static-key` by default, so nothing
   changes for existing deployments until an admin opts a backend in.

## Open Questions

- **Where does `ShortLivedStrategy.mint()` get the GCP/AWS "minter" identity** (the credential
  allowed to impersonate/assume-role on a project's behalf)? This becomes the single
  highest-value secret in the system — needs to be treated at least as carefully as
  `JWT_SECRET_KEY` today, ideally better (dedicated K8s secret, restricted to the backend pod
  only).
- **Migrating an existing project between `StorageBackend` rows** (e.g. moving a project from
  MinIO to GCS later) is explicitly out of scope here — `select_storage` only resolves at
  creation. A migration tool would be a separate, explicit admin operation.
- **fsspec filesystem hot-swap**: needs a concrete design for how `storage_context` goes from "a
  plain dict of static values" to "something the runner can refresh in place" without breaking
  every existing process type's `run()` signature.
