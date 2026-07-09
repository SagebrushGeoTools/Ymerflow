# Storage Admin UI — Plan

## Goal

Give admins a way to create, edit, and retire `StorageBackend` rows from the Admin page instead of
direct DB access — the exact gap [cluster-admin-ui.md](done/cluster-admin-ui.md) flagged as "a
parallel admin-UI gap, tracked separately" once it landed. Scope is CRUD on the `StorageBackend`
table, a pluggable "how do we connect to this storage backend" mechanism mirroring
`cluster_provider_forms`/`ClusterProvider`, **plus** a prerequisite fix: today no `StorageBackend`
protocol is actually parametrized by its own row's fields (see Background) — an admin UI would be
cosmetic without that fix, since a second MinIO backend an admin creates would silently behave
identically to the first.

It does not touch `select_storage`'s resolution algorithm (still `hooks.run_first` falling back to
one hardcoded default ID — see Open Questions), job launch, or credential minting itself (`mint()`
for `short-lived` stays unimplemented for every protocol, per
[short-lived-storage-credentials-00-overview.md](done/short-lived-storage-credentials-00-overview.md)'s
own Phase 4, not yet built).

## Supersedes / modifies

Nothing landed — this is new surface area for the API/UI. It changes
`MinioProtocolHandler.provision()`/`test_connection()` and `backend/services/minio_service.py` to
read from a `StorageBackend` row instead of global `settings` (Phase 2), and adds two columns to
`StorageBackend` (Phase 1). It does not change `StaticKeyStrategy`/`ShortLivedStrategy`
(`backend/services/storage_credentials.py`) or the `storage_protocol_handlers` registry mechanism
itself — both already exist and already fit this plan's needs unchanged.

## Background — current state

(Confirmed by reading the implemented code, not just the plans.)

- `backend/models/storage_backend.py` — `StorageBackend` has `id, name, protocol, endpoint,
  bucket_prefix, credential_strategy, config, created_at`. `protocol` (`minio`/`gcs`/`s3`) and
  `config` (opaque JSON) are already structurally identical in shape to `Cluster.cluster_type`/
  `provider_config` — same "discriminator + opaque per-type blob, hidden from `to_dict()`"
  convention. Unlike `Cluster`, `StorageBackend` has **no `sort_order` or `active` column** (no
  retire concept), and has a **second, independent discriminator axis** `credential_strategy`
  (`static-key`/`short-lived`) that `Cluster` has no equivalent of.
- **No route anywhere lists, creates, updates, or retires a `StorageBackend` row.** Exhaustive grep
  of `backend/routers/*.py` confirms zero `/admin/storage*` (or any other) CRUD surface — this is
  genuinely greenfield, unlike clusters where `backend/routers/admin.py` and
  `frontend/src/ClustersAdminPanel.jsx` already exist as a direct template to mirror (see below).
  The only route referencing `StorageBackend` at all is `backend/routers/internal.py` (reads it to
  resolve a project's endpoint/protocol for job-facing needs).
- **The registry/dispatch mechanism this plan needs already exists and needs no changes**:
  `backend/services/storage_protocols/__init__.py` — `StorageProtocolHandler` base class
  (`provision(project, backend)`, `mint(project, backend)`), discovered via the
  `storage_protocol_handlers` fan-out hook (`nagelfluh.hooks` entry-point group, registered in
  `setup.py`), exactly parallel to `cluster_provider_handlers`/`get_cluster_provider`. Core
  registers its own `minio`/`gcs`/`s3` handlers through the identical hook a plugin would use — "no
  core precedence" is already established practice here, same as for clusters and process types.
  `backend/services/storage_credentials.py` — `CredentialStrategy` base class
  (`StaticKeyStrategy`/`ShortLivedStrategy`), keyed by `StorageBackend.credential_strategy`,
  delegates to whichever protocol handler `backend.protocol` resolves to. Neither axis's dispatch
  code branches on the other — already exactly the shape this plan's admin UI needs to expose two
  independent selectors for.
- **Only `minio` is functional today, and only partially.** `MinioProtocolHandler.provision()`
  (`backend/services/storage_protocols/minio.py`) calls `setup_project_storage(project.id)`
  (`backend/services/minio_service.py:150`), which reads `settings.storage_endpoint`,
  `settings.storage_bucket_prefix`, `settings.minio_root_user`, `settings.minio_root_password` —
  **global config, not `backend.endpoint`/`backend.bucket_prefix`/`backend.config`.** The `mc`
  admin-CLI calls (`_create_minio_user`/`_create_minio_policy`/`_attach_policy_to_user`,
  `minio_service.py:39-92`) target a hardcoded alias `"minio"`, pre-configured once via the
  `MC_HOST_minio` env var at deploy time (`prod/runall-minikube.sh:133`) or `mc alias set` in dev
  (`dev/setup-minio.sh:158`) — outside the application entirely. **This means creating a second
  `minio`-protocol `StorageBackend` row today would list/CRUD fine but silently provision against
  the exact same global endpoint as every other backend** — the row's own `endpoint`/
  `bucket_prefix`/`config` would be inert. `MinioProtocolHandler.mint()` (for `short-lived`) is an
  unimplemented stub. `GcsProtocolHandler`/`S3ProtocolHandler` are pure `NotImplementedError` stubs
  for both `provision()` and `mint()` — no real GCS/AWS code exists at all yet.
  `_create_minio_user`/`_create_minio_policy`/`_attach_policy_to_user` already accept an `alias`
  parameter (default `"minio"`) — the per-backend-alias plumbing this plan needs is mostly already
  there, just never given a non-default value.
- **This codebase has the exact precedent for everything this plan needs to build**, because
  `cluster-admin-ui.md` built it first for the parallel `Cluster` resource:
  - `backend/auth_deps.py` — `require_admin` dependency, already extracted and shared.
  - `backend/routers/admin.py` — already exists (currently cluster-only): `_cluster_admin_dict()`,
    `_test_and_apply_connection()`, `_apply_generic_fields()`, `GET/POST /admin/clusters`,
    `PATCH /admin/clusters/{id}`, `POST /admin/clusters/test-connection`. This plan adds a parallel
    set of `_storage_backend_admin_dict()`/`_test_and_apply_storage_connection()`/
    `_apply_storage_generic_fields()` functions and `/admin/storage-backends*` routes to the same
    file — not a new router (parity with how both `/admin/users` and `/admin/clusters` already
    share `admin.py`).
  - `frontend/src/clusterProviders/{SameAsBackendClusterForm,KubeconfigClusterForm}.jsx` +
    `registerHook('cluster_provider_forms', ...)` in `frontend/src/App.jsx` — this plan adds
    `frontend/src/storageProviders/{MinioStorageForm,GcsStorageForm,S3StorageForm}.jsx` +
    `registerHook('storage_protocol_forms', ...)`.
  - `frontend/src/ClustersAdminPanel.jsx` (table + modal, `configTouched` flag so unrelated edits
    don't wipe/retest connection config) — this plan adds `frontend/src/StorageBackendsAdminPanel.jsx`
    following the identical structure.
  - `frontend/src/AdminPage.jsx`'s `builtinTabs` array — this plan adds one more entry.
  - `frontend/src/datamodel/api.js` (`listAdminClusters`/`createAdminCluster`/`updateAdminCluster`/
    `testAdminClusterConnection`) and `frontend/src/datamodel/useAuthQueries.js`
    (`useAdminClusters`/`useCreateAdminCluster`/`useUpdateAdminCluster`/
    `useTestAdminClusterConnection`) — this plan adds the parallel `*AdminStorageBackend*`
    functions/hooks to the same two files.
- `select_storage` (`backend/routers/projects.py`) is a different hook shape from `select_clusters`:
  `hooks.run_first(DEFAULT_STORAGE_BACKEND_ID, db, auth.user, proj)` returns a single chosen ID
  (falling back to one hardcoded UUID constant, currently defined ad hoc in `projects.py` rather
  than colocated in the model the way `Cluster.DEFAULT_CLUSTER_ID` is), vs. clusters'
  `get_allowed_clusters()` returning a filtered *set*. No plugin registers `select_storage` in this
  repo today, so it always resolves to the hardcoded default. This plan does not change that
  algorithm (see Open Questions) — `active`/`sort_order` (Phase 1) are added for admin-table parity
  with `Cluster` and future extensibility, not because `select_storage` consults them yet.

## Design decisions (settled in discussion)

- **This plan fixes MinIO to be genuinely per-backend-parametrized, not just CRUD-visible.**
  `StorageBackend.config` for `protocol='minio'` becomes `{"admin_access_key": ...,
  "admin_secret_key": ...}` — the MinIO root/admin credentials for *that specific endpoint*
  (parallel to how `provider_config.kubeconfig` holds a cluster's connection secret). Provisioning
  and connection-testing use `backend.endpoint`/`backend.bucket_prefix`/`backend.config` exclusively;
  no fallback to `settings.storage_endpoint`/`minio_root_user`/`minio_root_password` remains
  anywhere in the dispatch path (Phase 2). This includes the bootstrap default row itself — its
  `config` gets backfilled from the current global settings values in the same migration that
  removes the code's reliance on those globals, so **all** MinIO backends, including the original
  one, go through the identical per-backend path. No special-cased "the default row still reads
  settings" carve-out — same "core has no special precedence" principle already used for the
  protocol-handler registry itself.
- **All three protocols (`minio`, `gcs`, `s3`) are selectable in the admin UI now.** `gcs`/`s3`
  cleanly fail `test_connection`/provisioning with a clear "not implemented" error — same precedent
  as a bad kubeconfig failing cleanly for clusters, and keeps the registered-form mechanism visibly
  extensible (a future GCS implementation is "swap the stub for real code + write a
  `GcsStorageForm`," no registry change). `GcsStorageForm`/`S3StorageForm` are placeholder
  components (mirroring `SameAsBackendClusterForm`'s style) stating support isn't implemented yet
  and that Test Connection will fail — not empty/hidden, since the field values (whatever an admin
  types) should still be preserved for whenever real implementations land, matching the
  no-cross-type-carryover-but-still-a-real-form precedent from clusters.
- **`credential_strategy` (`static-key`/`short-lived`) is exposed as a second, independent selector
  now**, even though `short-lived` is unimplemented for every protocol (`mint()` raises
  `NotImplementedError` everywhere). This means an admin can create a backend that passes Test
  Connection (which validates protocol reachability only, not minting) but fails at actual job
  launch — an accepted, explicit trade-off. To reduce (not eliminate) that confusion, the frontend
  shows a static warning banner in the form whenever `short-lived` is selected: "Short-lived
  credential minting is not implemented for any protocol yet — jobs launched against a backend
  using this strategy will fail." This is a client-side UX hint only; `test_connection`
  deliberately stays scoped to protocol reachability (see below), not credential-strategy
  correctness — extending it to dry-run `mint()` would require threading a "dry run" concept
  through every future protocol's minting code for a strategy that isn't implemented yet, which is
  premature.
- **`sort_order` + `active` added to `StorageBackend`, mirroring `Cluster` exactly.** "Retire" =
  `PATCH` with `{"active": false}`; no DELETE route. Retired backends stay listed (visually
  distinguished) so historical `Project.storage_backend_id` references stay resolvable and a
  backend can be reactivated. Table sorted by `sort_order`, matching the `Cluster` admin table.
- **`select_storage`'s default resolution now honors `active`/`sort_order`.** A new project's
  storage backend is chosen as the **first active backend ordered by `sort_order`**, replacing the
  hardcoded-default-UUID fallback (Phase 1.3). This is the storage analog of `get_allowed_clusters()`
  filtering clusters by `active` and ordering by `sort_order` — retiring a backend genuinely removes
  it from new-project selection, and `sort_order` controls which active backend new projects land
  on. The `select_storage` *hook* is unchanged in shape (still `hooks.run_first` — a plugin can
  still override the pick per-user/per-project); only the *default* the hook falls back to changes
  from a constant ID to the computed first-active-by-sort_order id. If no active backend exists,
  project creation fails with a clear error rather than silently assigning a retired one — a project
  with no storage backend is a real misconfiguration, not a state to paper over.
- **`StorageProtocolHandler` gains a `test_connection(backend) -> None` method**, mirroring
  `ClusterProvider.test_connection()`. Unlike clusters (where one generic implementation — build a
  kubeconfig, list namespaces — covers both `same-as-backend` and `kubeconfig`), storage protocols
  are too different from each other for a shared default: **no default implementation in the base
  class**, each handler must implement it explicitly (`NotImplementedError` in the base is a hard
  error, not a silent no-op, if a future protocol forgets to override it). `test_connection`
  validates connectivity/credentials only — no bucket/user/policy creation, since it must be safe to
  call repeatedly while an admin is still filling out the create form, before any project exists to
  provision for. `MinioProtocolHandler.test_connection()` builds a per-backend `Minio` SDK client
  from `backend.endpoint`/`backend.config` and calls `list_buckets()` (same check the existing
  module-level `minio_service.test_connection()` does today, just parametrized instead of
  global-settings-based — that module-level function and `get_minio_client()`/`is_minio_enabled()`
  become dead code once this lands, since nothing outside `minio_service.py` itself calls them
  today; confirmed by grep). `GcsProtocolHandler.test_connection()`/`S3ProtocolHandler.test_connection()`
  raise the same clear "not implemented" error their `provision()` stubs already do.
  Both the "Test Connection" button (client-triggered) and the `POST`/`PATCH` admin routes
  themselves (server-side, authoritative) call it — server never trusts the client tested it — same
  rule as clusters.
- **Secrets never round-trip to the browser.** List/get responses omit `config` entirely, replaced
  with `has_config` (boolean). Every per-protocol form component's initial value is empty on edit
  (write-only), with a "(currently set)" hint driven by `has_config`. **Switching `protocol` on an
  edit always requires re-entering connection config from scratch** — no cross-protocol config
  carryover — mechanically via the same `configTouched` flag pattern `ClustersAdminPanel.jsx`
  already uses (only send `protocol`+`config` in the PATCH body if the admin actually interacted
  with the protocol form; leaving it untouched skips re-running `test_connection` too, so an admin
  editing only `sort_order` doesn't fail because storage is momentarily unreachable).
- **New routes added to the existing `backend/routers/admin.py`, not a new router file** — it
  already exists and already holds the identical cluster-admin pattern; splitting storage into its
  own file would just duplicate the `require_admin`/dict-shape conventions for no benefit. Not added
  to the MCP `include_tags` allowlist, matching `/admin/clusters` and `/admin/users` — storage
  backend administration (admin credential entry, connection testing) is deliberately UI-only.

---

## Phase 1 — `StorageBackend` schema: `sort_order` + `active`

### 1.1 Model changes

**`backend/models/storage_backend.py`**:

```python
sort_order = Column(Integer, nullable=False, default=0)
active = Column(Boolean, nullable=False, default=True)
```

`to_dict()` adds `"sort_order": self.sort_order, "active": self.active` — not sensitive, safe in
the base dict (parallel to `Cluster.to_dict()`).

Also add, colocated with the model (parity with `Cluster.DEFAULT_CLUSTER_ID`):

```python
DEFAULT_STORAGE_BACKEND_ID = 'default-storage-backend-00000000-0000-0000-0000-000000000000'
```

`backend/routers/projects.py` drops its local copy of this constant and imports it from
`backend.models.storage_backend` instead — same value, single source of truth. The constant is
still used by the seed migration (fixed UUID for the bootstrap row) but is **no longer** the runtime
resolution fallback (see 1.3).

### 1.2 Migration

One migration, off the current head (`5ebf42871eb0` at time of writing — verify with
`alembic -c backend/alembic.ini heads` before creating, since other work may land first):

```python
"""add sort_order, active to storage_backends"""
revision = 'bc173d62da23'   # generated via python3 -c "import uuid; print(uuid.uuid4().hex[:12])"
down_revision = '5ebf42871eb0'  # verify at implementation time

def upgrade() -> None:
    with op.batch_alter_table('storage_backends') as batch_op:
        batch_op.add_column(sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'))
        batch_op.add_column(sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.true()))

def downgrade() -> None:
    with op.batch_alter_table('storage_backends') as batch_op:
        batch_op.drop_column('active')
        batch_op.drop_column('sort_order')
```

Directly mirrors `b707a57376f7_add_cluster_selection_columns.py`. The existing bootstrap "Default
Storage Backend" row gets `sort_order=0, active=True` — behaviorally identical to today (still the
only backend, still what every project resolves to).

**Verify the generated revision id is still unique before committing**: `grep -rn "revision =
'bc173d62da23'" --include=*.py .` (per `CLAUDE.md` migration rule) — confirmed unique against the
current tree as of this plan's writing, but re-check at implementation time since other migrations
may have landed in between.

### 1.3 `select_storage` default resolution — first active backend by `sort_order`

New module-level helper in `backend/models/storage_backend.py`, the storage analog of
`get_allowed_clusters()`:

```python
from sqlalchemy import select

async def get_default_storage_backend_id(db) -> str:
    """The storage backend a new project is assigned by default: the first active backend
    ordered by sort_order. Raises if none are active — a project cannot be created without a
    storage backend to provision against."""
    stmt = select(StorageBackend).where(StorageBackend.active == True).order_by(StorageBackend.sort_order)
    result = await db.execute(stmt)
    backend = result.scalars().first()
    if backend is None:
        raise RuntimeError("No active storage backend configured — cannot create a project")
    return backend.id
```

**`backend/routers/projects.py`** `create_project` changes from passing the constant as the
`run_first` default to computing it:

```python
proj.storage_backend_id = hooks.run_first.select_storage(
    await get_default_storage_backend_id(db), db, auth.user, proj
)
```

`run_first`'s semantics are unchanged: a registered `select_storage` plugin's non-None result still
wins; only the fallback default changes from the hardcoded UUID to the first-active-by-sort_order
id. The bootstrap row (`sort_order=0`, `active=True`, seeded with the well-known UUID) remains the
default in a fresh install exactly as before — but now that's because it's the first active row by
sort_order, not because its id is hardcoded into the resolution path. Retiring it (or giving another
backend a lower `sort_order`) changes what new projects get, as intended.

---

## Phase 2 — Backend: MinIO becomes genuinely per-backend-parametrized

This is the prerequisite fix without which Phase 3's admin UI would let admins create backends that
silently do nothing different from the default one.

### 2.1 Data migration: backfill the bootstrap row's `config`

Second migration, immediately after Phase 1's:

```python
"""backfill admin credentials into default storage backend config"""
revision = '090d358a2f80'
down_revision = 'bc173d62da23'

DEFAULT_ID = 'default-storage-backend-00000000-0000-0000-0000-000000000000'

def upgrade() -> None:
    from backend.config import settings
    conn = op.get_bind()
    conn.execute(sa.text("""
        UPDATE storage_backends SET config = :config
        WHERE id = :id AND (config IS NULL OR config = '{}')
    """), {
        "id": DEFAULT_ID,
        "config": json.dumps({
            "admin_access_key": settings.minio_root_user,
            "admin_secret_key": settings.minio_root_password,
        }),
    })

def downgrade() -> None:
    pass  # cannot cleanly undo — config may have been legitimately edited since
```

Follows the same "read live `settings` inside `upgrade()`" pattern as
`a6b7c8d9e0f1_seed_default_storage_backend.py`. The `config IS NULL OR config = '{}'` guard makes
this idempotent and avoids clobbering a `config` an admin may have already set via the new UI
between Phase 1 landing and this migration running in a given environment — though in practice
these two migrations land together.

This migration must run **before** 2.2's code change reaches production — verify order in
Implementation Order below.

### 2.2 `minio_service.py` — parametrize instead of reading `settings`

`get_minio_client()` is replaced by a parametrized version:

```python
def get_minio_client_for_backend(endpoint: str, admin_access_key: str, admin_secret_key: str) -> Minio:
    parsed = urlparse(endpoint)
    return Minio(
        parsed.netloc or parsed.path,
        access_key=admin_access_key,
        secret_key=admin_secret_key,
        secure=parsed.scheme == "https",
    )
```

A new helper ensures the `mc` CLI alias exists for a given backend before any `_create_minio_user`/
`_create_minio_policy`/`_attach_policy_to_user` call (these already accept an `alias` param —
just never given a non-default value until now):

```python
def _ensure_mc_alias(alias: str, endpoint: str, admin_access_key: str, admin_secret_key: str) -> None:
    """mc alias set is an idempotent upsert — safe to call before every operation."""
    _run_mc(["alias", "set", alias, endpoint, admin_access_key, admin_secret_key])
```

`setup_project_storage()` gains explicit params instead of reading `settings`:

```python
def setup_project_storage(
    project_id: str, endpoint: str, bucket_prefix: str,
    admin_access_key: str, admin_secret_key: str,
    k8s_namespace: str = "nagelfluh-jobs",
) -> dict:
    alias = f"backend-{hashlib.sha1(endpoint.encode()).hexdigest()[:12]}"
    _ensure_mc_alias(alias, endpoint, admin_access_key, admin_secret_key)
    client = get_minio_client_for_backend(endpoint, admin_access_key, admin_secret_key)
    bucket_name = f"{bucket_prefix}{project_id}"
    ...  # same bucket/user/policy/k8s-secret steps as today, passing alias= through to
         # _create_minio_user/_create_minio_policy/_attach_policy_to_user
```

`alias` is derived from `endpoint` (not `backend.id`) so two `StorageBackend` rows that happen to
point at the same physical MinIO endpoint share one `mc` alias rather than needlessly creating two
— harmless either way, but avoids alias churn if an admin duplicates a backend row.

`is_minio_enabled()`, the old settings-based `get_minio_client()`, and the module-level
`test_connection()` are deleted — confirmed by grep that nothing outside `minio_service.py` calls
them, and once `MinioProtocolHandler` stops calling `setup_project_storage(project.id)` with no
other args, nothing constructs the "is MinIO even configured" question globally anymore (a
`StorageBackend` row with `protocol='minio'` existing *is* the configuration).

`create_k8s_secret`/`ensure_project_k8s_secret` are unchanged — the k8s secret's namespace is a
project/job-launch concern, not a storage-backend-connection concern (orthogonal axis, same
reasoning `Cluster.registry_url` being independent of `cluster_type` used).

`cleanup_project_storage()` is **deleted**. It is dead code — grep confirms zero call sites anywhere
in the repo, and its own docstring says "(for testing)". It reads `is_minio_enabled()` and
`settings.storage_bucket_prefix` (both removed by this phase), so leaving it would be dead code
referencing deleted symbols. No replacement is added — nothing invokes bucket cleanup today; if a
real "delete a project's storage" operation is ever needed it belongs in a `StorageProtocolHandler`
method (per-backend), designed then, not resurrected from this global-settings helper.

### 2.3 `MinioProtocolHandler` — call with per-backend params, add `test_connection`

**`backend/services/storage_protocols/minio.py`**:

```python
from backend.services.storage_protocols import StorageProtocolHandler
from backend.services.minio_service import setup_project_storage, get_minio_client_for_backend


class MinioProtocolHandler(StorageProtocolHandler):
    def provision(self, project, backend) -> dict:
        return setup_project_storage(
            project.id, backend.endpoint, backend.bucket_prefix,
            backend.config["admin_access_key"], backend.config["admin_secret_key"],
        )

    def mint(self, project, backend) -> dict:
        raise NotImplementedError(
            "MinIO short-lived credential minting (expiring service account / native STS) "
            "is not implemented yet"
        )

    async def test_connection(self, backend) -> None:
        client = get_minio_client_for_backend(
            backend.endpoint, backend.config["admin_access_key"], backend.config["admin_secret_key"]
        )
        await asyncio.to_thread(lambda: list(client.list_buckets()))
```

`provision()`/`test_connection()` both raise a plain `KeyError`/`TypeError` if `backend.config` is
missing `admin_access_key`/`admin_secret_key` — caught by the admin route's existing generic
`except Exception` and surfaced as a 400 with a clear message (same pattern as a malformed
kubeconfig), no special-casing needed.

### 2.4 `StorageProtocolHandler` base class + `gcs.py`/`s3.py` stubs

**`backend/services/storage_protocols/__init__.py`**: add the abstract method to the base class:

```python
class StorageProtocolHandler:
    def provision(self, project, backend) -> dict:
        raise NotImplementedError

    def mint(self, project, backend) -> dict:
        raise NotImplementedError

    async def test_connection(self, backend) -> None:
        """Validate connectivity/credentials only — no side effects, safe to call
        repeatedly from the admin UI before any project exists to provision for.
        No default implementation: protocols are too different from each other for a
        shared check (unlike ClusterProvider, where one generic k8s-list-namespaces
        check covers every cluster type)."""
        raise NotImplementedError
```

**`gcs.py`/`s3.py`**: add `async def test_connection(self, backend) -> None: raise
NotImplementedError("GCS storage support is not implemented yet")` (and the AWS-S3 equivalent) —
same message style as their existing `provision()`/`mint()` stubs.

---

## Phase 3 — Backend: admin routes

### 3.1 `backend/routers/admin.py` — add storage backend routes alongside cluster routes

```python
from backend.models.storage_backend import StorageBackend
from backend.services.storage_protocols import get_protocol_handler


def _storage_backend_admin_dict(backend: StorageBackend) -> Dict:
    d = backend.to_dict()
    d["has_config"] = bool(backend.config)
    return d


async def _test_and_apply_storage_connection(backend: StorageBackend, body: Dict) -> None:
    if "protocol" in body or "config" in body:
        protocol = body.get("protocol", backend.protocol)
        config = body.get("config") or {}
        try:
            handler = get_protocol_handler(protocol)
            await handler.test_connection(_TestBackend(backend.endpoint, config))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Connection test failed: {e}")
        backend.protocol = protocol
        backend.config = config


def _apply_storage_generic_fields(backend: StorageBackend, body: Dict) -> None:
    if "name" in body:
        name = (body.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="name is required")
        backend.name = name
    if "endpoint" in body:
        backend.endpoint = body.get("endpoint") or None
    if "bucket_prefix" in body:
        prefix = (body.get("bucket_prefix") or "").strip()
        if not prefix:
            raise HTTPException(status_code=400, detail="bucket_prefix is required")
        backend.bucket_prefix = prefix
    if "credential_strategy" in body:
        if body["credential_strategy"] not in ("static-key", "short-lived"):
            raise HTTPException(status_code=400, detail="invalid credential_strategy")
        backend.credential_strategy = body["credential_strategy"]
    if "sort_order" in body:
        try:
            backend.sort_order = int(body["sort_order"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="sort_order must be an integer")
    if "active" in body:
        if not isinstance(body["active"], bool):
            raise HTTPException(status_code=400, detail="active must be a boolean")
        backend.active = body["active"]


@router.get("/admin/storage-backends")
async def admin_list_storage_backends(auth=Depends(require_admin), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(StorageBackend).order_by(StorageBackend.sort_order))
    return [_storage_backend_admin_dict(b) for b in result.scalars().all()]


@router.post("/admin/storage-backends")
async def admin_create_storage_backend(body: Dict, auth=Depends(require_admin), db: AsyncSession = Depends(get_db)):
    if not (body.get("name") or "").strip():
        raise HTTPException(status_code=400, detail="name is required")
    if not (body.get("bucket_prefix") or "").strip():
        raise HTTPException(status_code=400, detail="bucket_prefix is required")
    backend = StorageBackend(
        name=body["name"].strip(), bucket_prefix=body["bucket_prefix"].strip(),
        protocol=body.get("protocol", "minio"),
        credential_strategy=body.get("credential_strategy", "static-key"),
    )
    _apply_storage_generic_fields(backend, body)
    await _test_and_apply_storage_connection(backend, body)
    db.add(backend)
    await db.commit()
    return _storage_backend_admin_dict(backend)


@router.patch("/admin/storage-backends/{backend_id}")
async def admin_update_storage_backend(backend_id: str, body: Dict, auth=Depends(require_admin), db: AsyncSession = Depends(get_db)):
    backend = await db.get(StorageBackend, backend_id)
    if backend is None:
        raise HTTPException(status_code=404, detail="Storage backend not found")
    _apply_storage_generic_fields(backend, body)
    await _test_and_apply_storage_connection(backend, body)
    await db.commit()
    return _storage_backend_admin_dict(backend)


@router.post("/admin/storage-backends/test-connection")
async def admin_test_storage_backend_connection(body: Dict, auth=Depends(require_admin)):
    protocol = body.get("protocol")
    if not protocol:
        raise HTTPException(status_code=400, detail="protocol is required")
    try:
        handler = get_protocol_handler(protocol)
        await handler.test_connection(_TestBackend(body.get("endpoint"), body.get("config") or {}))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Connection test failed: {e}")
    return {"ok": True}
```

`endpoint` needs to be set on the backend *before* `_test_and_apply_storage_connection` runs (order
matters, unlike clusters where connection config is entirely self-contained in `provider_config`) —
`_apply_storage_generic_fields` runs first in both create and update. `_TestBackend` is a tiny
namedtuple/dataclass (`endpoint`, `config`) used so `test_connection(backend)` has a consistent
`.endpoint`/`.config` shape whether called against a real ORM row (update path) or a not-yet-created
one (create/standalone-test-button path) — avoids constructing a throwaway unsaved `StorageBackend`
ORM instance just to pass two fields around.

No DELETE route — retiring only, same as clusters (Design decisions).

### 3.2 Register — already registered

`admin_router` is already included in `main.py` (from the cluster admin work); no change needed
here, just the new routes living in the same file.

---

## Phase 4 — Frontend: pluggable per-protocol connection forms

### 4.1 Form components

New `frontend/src/storageProviders/MinioStorageForm.jsx`:

```jsx
export default function MinioStorageForm({ value, onChange, hasExisting }) {
  return (
    <>
      <Form.Group>
        <Form.Label>Admin Access Key</Form.Label>
        <Form.Control
          placeholder={hasExisting ? '(unchanged — enter to replace)' : ''}
          value={value.admin_access_key || ''}
          onChange={e => onChange({ ...value, admin_access_key: e.target.value })}
        />
      </Form.Group>
      <Form.Group>
        <Form.Label>Admin Secret Key</Form.Label>
        <Form.Control
          type="password"
          placeholder={hasExisting ? '(unchanged — enter to replace)' : ''}
          value={value.admin_secret_key || ''}
          onChange={e => onChange({ ...value, admin_secret_key: e.target.value })}
        />
      </Form.Group>
    </>
  );
}
```

New `frontend/src/storageProviders/GcsStorageForm.jsx` / `S3StorageForm.jsx` — placeholder inputs
(not empty/hidden — per Design decisions, values are preserved for whenever real support lands) plus
a `text-muted` note that this protocol isn't implemented yet and Test Connection will fail.

### 4.2 Registration

**`frontend/src/App.jsx`**, alongside `cluster_provider_forms`:

```javascript
registerHook('storage_protocol_forms', () => [
  { type: 'minio', title: 'MinIO', Component: MinioStorageForm },
  { type: 'gcs',   title: 'Google Cloud Storage', Component: GcsStorageForm },
  { type: 's3',    title: 'AWS S3', Component: S3StorageForm },
]);
```

---

## Phase 5 — Frontend: data hooks

**`frontend/src/datamodel/api.js`** (mirror `listAdminClusters`/etc. exactly):
`listAdminStorageBackends()`, `createAdminStorageBackend(body)`,
`updateAdminStorageBackend(id, body)`, `testAdminStorageBackendConnection(body)`.

**`frontend/src/datamodel/useAuthQueries.js`**, mirroring the cluster hooks exactly:
`useAdminStorageBackends()`, `useCreateAdminStorageBackend()`, `useUpdateAdminStorageBackend()`,
`useTestAdminStorageBackendConnection()` — each invalidating `queryKey: ['adminStorageBackends']`.
Same reasoning as clusters: plain TanStack Query for an admin-only resource, the
`ProcessContext`/`invalidateProject` rule doesn't apply here.

---

## Phase 6 — Frontend: `Storage` admin tab

New `frontend/src/StorageBackendsAdminPanel.jsx`, mirroring `ClustersAdminPanel.jsx`'s shape:

- Table of all backends (including retired, visually distinguished), columns: Name, Protocol,
  Endpoint, Bucket Prefix, Credential Strategy, Sort Order, Active, Edit button.
- "Add Storage Backend" / edit form (modal): generic fields (Name, Endpoint, Bucket Prefix, Sort
  Order, Active — the last only on edit) plus a **Protocol** `<select>` populated from
  `hooks.run.storage_protocol_forms()` and a **Credential Strategy** `<select>` (`static-key` /
  `short-lived`, independent of protocol). Selecting a protocol renders that entry's `Component`
  with `{ value: configState, onChange, hasExisting: has_config }`; switching protocol resets
  `configState` to `{}` (no cross-protocol carryover). Selecting `short-lived` shows the static
  warning banner from Design decisions.
- **Test Connection** button next to the protocol form, calling
  `useTestAdminStorageBackendConnection` with `{ protocol, endpoint, config }` — spinner then a
  clear pass/fail message. Not a precondition for Save (Save re-tests authoritatively
  server-side), just faster feedback.
- Submit calls `useCreateAdminStorageBackend`/`useUpdateAdminStorageBackend`. Body only includes
  `protocol`/`config` if the protocol form was actually touched this session (`configTouched` flag,
  identical mechanism to `ClustersAdminPanel.jsx`).

**`frontend/src/AdminPage.jsx`**: add a third `builtinTabs` entry:

```javascript
{ key: 'storage', title: 'Storage', render: () => <StorageBackendsAdminPanel /> },
```

---

## Implementation Order

1. **Phase 1** — schema migration (`sort_order`/`active`, `DEFAULT_STORAGE_BACKEND_ID` moved into
   the model). No behavior change.
2. **Phase 2.1** — the `config` backfill migration. Must land and run **before** 2.2-2.4's code
   deploys, since once `MinioProtocolHandler.provision()` stops falling back to global `settings`,
   the bootstrap row's `config` must already hold real admin credentials or the one working
   production path breaks. Verify by reading the bootstrap row's `config` after migrating in a real
   environment before proceeding.
3. **Phase 2.2–2.4** — `minio_service.py` parametrization, `MinioProtocolHandler`/`gcs.py`/`s3.py`
   `test_connection`. Verify end-to-end: trigger `setup_project_storage` for a real project (e.g.
   via `POST /project/{id}/setup-storage`) and confirm it still works identically to before, using
   only the bootstrap row's now-populated `config` — no regression on the one live path.
4. **Phase 3** — backend admin routes. Verify via `/docs`/`curl` with an admin session: list should
   show the bootstrap backend with `has_config: true`; create a second `minio` backend pointed at
   the same dev MinIO endpoint with the same admin credentials, confirm Test Connection passes;
   create a `gcs` backend, confirm Test Connection fails with a clear "not implemented" message.
5. **Phase 4** — frontend protocol-form registration, no admin UI consuming it yet.
6. **Phase 5** — frontend query/mutation hooks.
7. **Phase 6** — `StorageBackendsAdminPanel` + `AdminPage.jsx` wiring. End-to-end test: create a
   second MinIO backend via the UI pointing at the same dev MinIO instance but a different
   `bucket_prefix`, confirm Test Connection passes, confirm it appears retired/active correctly in
   the table, confirm retiring it doesn't affect the (unrelated, unchanged) `select_storage`
   fallback behavior for new projects.

## Open Questions

- **GCS/S3 real implementations** — explicitly deferred, same status as before this plan (`mint()`/
  `provision()` stubs). When either lands, it plugs into the exact registry/form mechanism this plan
  establishes — no dispatch-layer changes needed, per the "core has no special precedence" pattern
  already proven for clusters and process types.
- **`short-lived` credential_strategy** — this plan exposes the selector but implements no minting.
  A future plan (Phase 4 of the original short-lived-storage-credentials plan, still not built)
  would make it functional for at least one protocol; until then the warning banner is the only
  guardrail.
- **Migrating an existing project between `StorageBackend` rows** stays out of scope, same as the
  original plan's stance — `select_storage`/provisioning only ever resolves once, at project
  creation.
