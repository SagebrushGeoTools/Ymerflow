# Short-Lived, Per-Project Storage Credentials — Overview

This plan is split into subplans, one per implementation phase. Read this overview first, then
implement the subplans **in order** — each phase depends on the previous one:

1. [short-lived-storage-credentials-01-storage-backend-model.md](short-lived-storage-credentials-01-storage-backend-model.md) — `StorageBackend` model + bootstrap migration
2. [short-lived-storage-credentials-02-hooks-run-first-select-storage.md](short-lived-storage-credentials-02-hooks-run-first-select-storage.md) — `hooks.run_first` + `select_storage`
3. [short-lived-storage-credentials-03-credential-strategies.md](short-lived-storage-credentials-03-credential-strategies.md) — Credential strategies (depends on [backend-installable-package.md](backend-installable-package.md))
4. [short-lived-storage-credentials-04-runner-refresh-loop.md](short-lived-storage-credentials-04-runner-refresh-loop.md) — Runner-side refresh loop

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
- **Protocol handlers** — `credential_strategy` picks *how* a credential is obtained (once vs.
  minted-and-refreshed); it says nothing about *which cloud API* to call. That second axis
  (`StorageBackend.protocol`: `minio` / `gcs` / `s3` / ...) is resolved separately, via a
  `storage_protocol_handlers` fan-out hook (Phase 3.1) rather than an `if protocol == ...:` chain
  inside each strategy. Both `StaticKeyStrategy` and `ShortLivedStrategy` look up a
  `StorageProtocolHandler` for `backend.protocol` and delegate to it — neither strategy class
  contains any protocol-specific code. This keeps the two axes (strategy × protocol) independently
  extensible: a plugin can add a new protocol without touching `storage_credentials.py`, and a new
  strategy (should one ever be needed) doesn't have to re-implement per-protocol logic. Core's own
  `minio` / `gcs` / `s3` handlers register through this same hook rather than a private dict, which
  requires the backend to be a pip-installed package with its own `nagelfluh.hooks` entry points —
  see [backend-installable-package.md](backend-installable-package.md) (a prerequisite of Phase 3).
- **`hooks.run_first(name, default, *args, **kwargs)`** — new addition to `backend/hooks.py`,
  alongside the existing `run` / `run_async`. Returns the first non-`None` result from registered
  plugins (in plugin-name sort order — see below), or `default` if none answer. `select_storage`
  and `select_cluster` ([multi-cluster-execution.md](multi-cluster-execution.md)) both use this;
  none of today's existing hooks change their calling style.
- **Deterministic hook order** — `_load_entry_points` sorts by `ep.dist.name` before returning, so
  `run_first`'s "first" is well-defined and every existing fan-out hook
  (`job_pre_run`, `job_completed`, `user_created`, etc.) becomes deterministic as a side effect.

## Implementation Order

1. **Phase 1** ([...01-storage-backend-model.md](short-lived-storage-credentials-01-storage-backend-model.md)) —
   `StorageBackend` model, `Project.storage_backend_id`, bootstrap migration. Pure schema + data
   migration; no behavior change (everything still resolves to the one bootstrap row).
2. **Phase 2** ([...02-hooks-run-first-select-storage.md](short-lived-storage-credentials-02-hooks-run-first-select-storage.md)) —
   `hooks.run_first`, sorted entry points, `select_storage` call site. Still no behavior change
   with zero plugins installed — `default` always wins.
3. **Phase 3** ([...03-credential-strategies.md](short-lived-storage-credentials-03-credential-strategies.md)) —
   **depends on [backend-installable-package.md](backend-installable-package.md)** (the backend
   must already be a pip-installed package registering its own `nagelfluh.hooks` entry points, so
   core protocol handlers can register through the fan-out hook instead of a private dict).
   `storage_protocol_handlers` hook + registry, `MinioProtocolHandler` extracted from today's
   `minio_service.py` code (refactor, not a behavior change), stub `GcsProtocolHandler` /
   `S3ProtocolHandler`, `StaticKeyStrategy` / `ShortLivedStrategy` delegating to the registry.
   `setup_project_storage()` dispatches on `credential_strategy` only; protocol dispatch is fully
   inside the registry, not duplicated at either call site.
4. **Phase 4** ([...04-runner-refresh-loop.md](short-lived-storage-credentials-04-runner-refresh-loop.md)) —
   `ShortLivedStrategy` + refresh loop. This is the only phase that changes runtime behavior for
   real jobs, and only for `StorageBackend` rows explicitly configured with
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
