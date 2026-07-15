# Route storage I/O through the project's StorageBackend, not global `settings.storage_*` — Plan

## Goal

Make every runtime storage read/write path resolve **the project's own `StorageBackend`** (protocol,
endpoint, bucket, credentials) instead of the single global `settings.storage_protocol` /
`storage_endpoint` / `storage_bucket_prefix` / `minio_root_user|password`. Today the *credential*
axis is already per-project (`StorageBackend` + credential strategies + protocol handlers, landed by
[short-lived-storage-credentials-00-overview.md](done/short-lived-storage-credentials-00-overview.md)),
but the *addressing* axis — the storage URL, endpoint, and fsspec kwargs actually used at runtime —
still reads the globals. The two only agree because the bootstrap migrations copied the globals into
the default backend row; **any second backend, or any GCS/S3 backend, silently reads/writes the
wrong place.** This is the concrete bug behind "a job on a GKE cluster with a GCS project writes its
output to the global MinIO URL, which the pod can't even reach" (observed while implementing
[../../plugins/ymerflow-gcp/docs/plans/done/gcp-credential-provisioning-revision.md](../../plugins/ymerflow-gcp/docs/plans/done/gcp-credential-provisioning-revision.md)).

The unifying principle: **the `StorageProtocolHandler` for a project's backend is the single
authority that produces `(storage_base_url, fsspec_kwargs)`.** Every runtime path — job pod env, the
`/files/` proxy, backend-side dataset/upload reads, post-job output scanning, plugin-asset serving —
asks the handler, and the runner passes the handler's `fsspec_kwargs` straight to
`fsspec.open(url, **kwargs)`. `fsspec` already dispatches on the URL scheme (`s3://`, `gs://`,
`az://`, `file://`), so **no protocol-specific code lives in the runner or in any process type** —
only in the handlers.

## Scope

In: `backend/services/storage_service.py`, `backend/services/job_orchestrator.py`,
`backend/services/storage_protocols/*`, `backend/services/storage_credentials.py`,
`docker/base-runner/runner.py` + `storage_credentials_client.py`, and the backend-side read call
sites (`routers/uploads.py`, `routers/datasets.py` incl. the `/files/` proxy,
`models/process.py:_create_outputs`, `services/plugin_registration.py`, `routers/plugins.py`).

Also in: the GCS plugin's provisioning must move to one-bucket-per-project + a per-project
bucket-scoped credential (see decision 2) — required for the access-control boundary, so it is part
of this plan's contract, not deferred.

Out: no new schema (the model already carries `protocol`/`endpoint`/`bucket_prefix`/`config` and
`Project.storage_backend_id`/creds); no admin-UI change; no change to `select_storage` /
`credential_strategy` semantics; **moving a project between backends stays out of scope** (resolved
once at creation, as today).

## Design decisions (settled in discussion)

- **`StorageProtocolHandler` is the addressing authority.** Add two methods to the handler interface
  (`backend/services/storage_protocols/__init__.py`):
  - `storage_base_url(project, backend) -> str` — the `<scheme>://…` root for this project on this
    backend (replaces `get_storage_base_url`/`get_project_bucket_name`).
  - `fsspec_kwargs(backend, credentials) -> dict` — the fsspec kwargs for the given credential set.
    Called with **admin** creds for backend-side I/O and with **project-scoped** creds for the pod
    (see trust boundary below). MinIO → `{"key","secret","client_kwargs":{"endpoint_url",["verify"]}}`;
    GCS → `{"token": <SA-key dict>}`; S3 → `{"key","secret", …}`. No caller ever branches on protocol
    again; `storage_service.py` becomes a thin dispatcher that resolves the backend and calls the
    handler.
- **Trust boundary for credentials (decision 1).** Backend-side I/O uses the **backend's admin
  creds** (`backend.config` admin key/secret / SA key): the backend is trusted code and enforces its
  own access control, so it reads/writes any project's bucket with full creds. The **pod/runner is
  untrusted** and receives **project-scoped creds only** (`Project.storage_access_key/secret_key`,
  i.e. the per-project MinIO user / minted credential) — never the admin creds. The handler's
  `fsspec_kwargs(backend, credentials)` takes the credential set as an argument precisely so the same
  code path serves both, with the caller choosing which creds to pass.
- **Pod gets fsspec kwargs as env, not a mounted k8s secret (decision 3).** Replace the static-key
  `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` `secretKeyRef` to `project-{id}-storage` (and the
  `localhost:9000 → in-cluster` string-replace hack) with a single `STORAGE_KWARGS_JSON` env var
  carrying the handler-built, **project-scoped** fsspec kwargs. This is cluster-agnostic — it fixes
  the standing bug that the k8s secret is created on the *backend's own* cluster, not the job's
  *target* cluster (`minio_service.create_k8s_secret` uses the default kubeconfig), so a pod on a
  remote/GKE cluster currently has no secret to mount. The runner writes these to its credentials
  file and hands them to fsspec; the short-lived refresher rewrites the same file (unchanged
  refresh-loop contract, now protocol-general instead of s3-shaped).
- **One bucket per project — every backend, no exceptions (decision 2). This IS the access-control
  boundary.** `handler.storage_base_url(project, backend)` is **`<scheme>://<bucket_prefix><project_id>`**
  for *every* protocol: exactly one bucket per project, whose name embeds `project_id`. The reason is
  security, not just addressing: the untrusted pod is given **project-scoped credentials that grant
  access to that project's bucket and nothing else**, so a compromised or buggy process in one
  project physically cannot reach another project's files. A shared bucket with per-project key
  prefixes would make isolation depend on every policy/prefix being exactly right — a bucket-per-
  project boundary is the hard guarantee. This is MinIO's current convention
  (`f"{bucket_prefix}{project_id}"`, `minio_service.py:151`, with the per-project user's policy
  scoped to that bucket) — **MinIO is unchanged, no MinIO data migration.** The GCS plugin, which
  today hands *every* project one shared bucket **and the shared bucket-admin SA key**, is
  **changed to conform on both axes**: its `provision(project, backend)` must (a) create a per-project
  bucket `<bucket_prefix><project_id>` (globally unique — `project_id` is a uuid), and (b) produce a
  **per-project credential scoped to only that bucket** (a per-project SA with `objectAdmin` bound on
  that one bucket's IAM policy, or a short-lived/minted equivalent) — never the shared admin SA. That
  bucket-scoped credential is what becomes `Project.storage_access_key/secret_key` and is handed to
  the pod. The `/files/<bucket>/<rest>` proxy resolves the owning project by extracting the
  `project_id` embedded in the bucket name → `project → StorageBackend → **backend admin
  fsspec_kwargs**` (backend-side/trusted; the proxy may read across projects because the backend
  enforces access itself). The `/files/` auth model is otherwise unchanged (it already serves without
  per-user auth).
- **`settings.storage_*` become seed-only.** After this change nothing reads `settings.storage_protocol`
  / `storage_endpoint` / `storage_bucket_prefix` / `minio_root_user|password` at *runtime*; they
  remain only as the values the bootstrap migrations seed into the default `StorageBackend` row (and
  as the config an operator sets for that default row). No migration removes them — they are still the
  default backend's source of truth at install time.

## Background — current state (confirmed by reading the code)

Root of the coupling: **`backend/services/storage_service.py`** is stateless module-level functions
that read `settings.*` and take only `project_id`/URL strings — no DB or `StorageBackend` access.

- **Addressing globals.** `get_storage_base_url(project_id)` = `{settings.storage_protocol}://{settings.storage_bucket_prefix}{project_id}`
  (`storage_service.py:37-41`), used for the pod's `STORAGE_BASE` (`job_orchestrator.py:40,50`), the
  post-job output scan (`models/process.py:925`), content hashing (`plugin_registration.py:29`), and
  plugin-asset paths (`plugins.py:295`).
- **Credential/endpoint globals.** `get_fsspec_storage_options()` returns the MinIO **admin root**
  creds + global endpoint (`storage_service.py:13-22`) and is used by 8 backend-side read/write
  sites: `uploads.py:24,156`, `datasets.py:206,265,311`, `process.py:931` (output scan),
  `plugin_registration.py:31`, `plugins.py:300`.
- **Job env.** `create_job_manifest` (`job_orchestrator.py:43-166`) sets `STORAGE_BASE` from the
  global (line 50); `STORAGE_ENDPOINT`/`STORAGE_TLS_SKIP_VERIFY` only inside an
  `if settings.storage_endpoint and settings.storage_protocol=="s3"` branch (115-126) with the
  `localhost:9000 → minio-nagelfluh.nagelfluh-jobs.svc.cluster.local` string-replace (117-123); the
  static-key branch (142-166) is gated on `settings.storage_protocol=="s3"` and injects
  `AWS_ACCESS_KEY_ID/SECRET` via `secretKeyRef` to `project-{project_id}-storage`. **No branch on
  `backend.protocol` anywhere.**
- **Runner.** `runner.py:get_storage_kwargs` (28-55) builds an **s3-shaped** dict
  (`client_kwargs.endpoint_url`, relies on `AWS_*` env); `RefreshableStorageKwargs`
  (`storage_credentials_client.py:70-146`) yields `key`/`secret`/`client_kwargs`. `fsspec` itself is
  protocol-general — only the *kwargs construction* is s3-specific.
- **Provisioning is already per-backend-correct.** `storage_credentials.ensure_ready`
  (`storage_credentials.py:78-118`) loads the project's `StorageBackend`, dispatches on
  `credential_strategy`, and delegates to `get_protocol_handler(backend.protocol)`;
  `MinioProtocolHandler.provision` → `setup_project_storage(project.id, backend.endpoint,
  backend.bucket_prefix, backend.config[...])` creates a bucket `f"{backend.bucket_prefix}{project_id}"`
  (`minio_service.py:151`) and populates `Project.storage_access_key/secret_key`. The **write** side
  already uses `backend.*`; only the **read/dispatch** side uses the globals — that is the entire bug.
- **`/files/` proxy** (`datasets.py:277 get_file`) rebuilds `f"{settings.storage_protocol}://{path}"`
  (line 294) and reads via global admin creds (311) — never resolves a project/backend.
- **No schema gap.** `StorageBackend(protocol, endpoint, bucket_prefix, config)` and
  `Project(storage_backend_id, storage_access_key, storage_secret_key)` already hold everything.
- **Stale legacy:** `backend/services/file_service.py` re-exports storage-service functions and has
  its own `settings.data_base_path`-based variants with no active callers — verify and ignore/remove.

## Phases

### Phase 1 — Handler becomes the addressing authority
Add `storage_base_url(project, backend)` (→ `<scheme>://<bucket_prefix><project_id>`) and
`fsspec_kwargs(backend, credentials)` to `StorageProtocolHandler` (`storage_protocols/__init__.py`)
and implement them in `MinioProtocolHandler`, `GcsProtocolHandler` (`plugins/ymerflow-gcp`), and
`S3ProtocolHandler`. Move the MinIO URL/kwargs logic out of `storage_service.py`/`minio_service.py`
into the handler — MinIO's per-project-bucket layout and per-project bucket-scoped user are
unchanged. **Change the GCS plugin to one bucket per project, with a per-project bucket-scoped
credential**: its `provision(project, backend)` creates `<bucket_prefix><project_id>` and a
per-project credential granting access to only that bucket (per-project SA + `objectAdmin` bound on
that bucket, or minted equivalent) — moving both bucket and credential creation from
StorageBackend-setup time to per-project provisioning (parallel to MinIO's `setup_project_storage`),
replacing today's shared-bucket + shared-admin-SA model. No read-path call site changes yet — pure
handler + provisioning. Verify a new project on each backend provisions its own bucket, that
`Project.storage_access_key/secret_key` is scoped to that bucket only (a cross-project read is
denied), and the handler addresses it.

### Phase 2 — `storage_service.py` becomes backend-aware (backend-side, admin creds)
Turn the module-level functions into thin resolvers that, given a `project` (or `project_id` + db),
load the project's `StorageBackend` and call the handler with **admin** creds. Update the 8
`get_fsspec_storage_options` sites and the 4 `get_storage_base_url` sites (see Background) to pass the
resolved backend. Because these functions gain a db/backend dependency, some currently-sync call
sites become async or take a pre-resolved backend — thread it through (`uploads.py`, `datasets.py`,
`process.py:_create_outputs`, `plugin_registration.py`, `plugins.py`). Verify uploads, dataset reads,
and post-job output scan still work on the default MinIO backend (no behavior change), then against a
second backend row.

### Phase 3 — `/files/` proxy resolves project → backend
The `/files/<bucket>/<rest>` path's first segment is the project's bucket, whose name embeds
`project_id` (`<bucket_prefix><project_id>`) — extract it (parse the trailing uuid / strip the
prefix) to resolve the project. In `get_file`/`get_dataset_part`/`get_dataset_part_geography`
(`datasets.py`) and the upload download (`uploads.py:159`), resolve `bucket → project →
StorageBackend` and read with that backend's admin `fsspec_kwargs`. Verify `/files/` serves a file
from a non-default backend.

### Phase 4 — Job env carries handler-built, project-scoped kwargs
In `create_job_manifest` (`job_orchestrator.py`): set `STORAGE_BASE` from
`handler.storage_base_url(project, backend)`, and add `STORAGE_KWARGS_JSON` =
`handler.fsspec_kwargs(backend, project_scoped_creds)`. Delete the `settings.storage_protocol=="s3"`
branches, the `localhost:9000` string-replace, and the `AWS_*` `secretKeyRef` block. Keep
`CREDENTIAL_STRATEGY` (short-lived still refreshes). Drop the per-project k8s-secret creation
(`minio_service.create_k8s_secret`/`ensure_project_k8s_secret`) from the launch path — it was the
source of the wrong-cluster bug. Verify a static-key MinIO job still runs on the local cluster.

### Phase 5 — Runner passes kwargs through
In `runner.py:get_storage_kwargs`: parse `STORAGE_KWARGS_JSON` and return it verbatim (no
s3-specific construction). Update `RefreshableStorageKwargs` so the short-lived refresher rewrites the
same protocol-general kwargs file (the refresh endpoint returns handler-built kwargs). Rebuild the
runner image. Verify: (a) a MinIO static-key job reads/writes correctly; (b) a MinIO short-lived job
still refreshes; (c) — end-to-end target — a GCS-backed project's job on a remote/GKE cluster
reads/writes the GCS bucket via `gs://` + `{"token": …}` with no runner code change.

### Cleanup
Confirm nothing reads `settings.storage_protocol|endpoint|bucket_prefix|minio_root_*` at runtime
(grep); leave them as seed-only. Remove/settle the stale `file_service.py` shims if unused.

## Implementation Order
1–5 above, in order; each phase verified before the next. Phases 1–2 are refactors with no behavior
change on the default backend; Phase 4–5 are the only ones that change pod/runtime behavior. The
GCS-on-GKE end-to-end is the final acceptance test.

## Open / deferred questions
- **Short-lived + GCS**: the refresh endpoint must return handler-built fsspec kwargs (not s3
  key/secret); confirm the refresher contract generalises cleanly (Phase 5). Short-lived GCS minting
  itself remains the plugin's `mint()`, still stubbed.
- ~~`project_id`-in-path standardisation~~ **RESOLVED (in discussion):** one bucket per project for
  every backend, no exceptions — bucket name is `<bucket_prefix><project_id>`. MinIO already does
  this (unchanged); the GCS plugin is changed to conform (Phase 1). Reverse-lookup extracts the
  `project_id` embedded in the bucket name.
- **Moving a project between backends** stays out of scope (creation-time resolution only), same as
  the credentials plan.
- **Schema migration**: none (no schema change). Confirm the two bootstrap migrations
  (`a6b7c8d9…`, `182d880e84c7…`) still correctly seed the default row from `settings.*`.
- **No MinIO data migration** — MinIO's bucket-per-project layout is unchanged. The only layout
  change is in the GCS plugin (shared bucket → per-project bucket); since GCS-backed projects are new
  (the plugin's runtime path never worked end-to-end before this plan), there is no existing GCS
  project data to move.
