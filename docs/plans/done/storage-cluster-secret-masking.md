# Storage/Cluster Admin Secret Masking — Plan

## Goal

Fix a real bug found in production use: editing the Default Storage Backend in Admin > Storage
and clicking "Test Connection" fails with `InvalidAccessKeyId`, even though the credentials stored
in the database are correct and MinIO is reachable (confirmed directly with the MinIO Python SDK
against the stored `minioadmin`/`minioadmin` credentials — they work).

Root cause: `StorageBackend.config` (and, identically, `Cluster.provider_config` /
`Cluster.registry_auth`) is deliberately **write-only** — the admin API never sends secret values
back to the browser (see [storage-admin-ui.md](done/storage-admin-ui.md) Design decisions:
"Secrets never round-trip to the browser"). The edit form therefore always starts with **blank**
fields for these values. Blank is indistinguishable from "leave unchanged": clicking Test
Connection (or Save, if any field in the config group was touched) sends the blank fields as-is,
which for MinIO means an empty access key/secret key — MinIO correctly rejects that as
`InvalidAccessKeyId`.

This plan replaces "blank on edit" with "send back a `****` placeholder per field, and resolve
`****` back to the stored value server-side on Save/Test Connection." Secrets still never actually
round-trip to the browser in plaintext — only the fixed placeholder string does — so the
no-round-trip property from storage-admin-ui.md is preserved, while fixing the actual bug: leaving
a field untouched during edit now genuinely means "unchanged," for both Save and Test Connection.

Confirmed with the user that the identical bug pattern exists in Admin > Clusters
(`Cluster.provider_config`, e.g. pasted kubeconfig; `Cluster.registry_auth`), since it's built on
the exact same `configTouched`/blank-on-edit mechanism as storage
([cluster-admin-ui.md](done/cluster-admin-ui.md)). This plan fixes both in one pass, since it's the
same fix applied to two structurally identical call sites, not two different designs.

Also removes `has_config`/`has_provider_config`/`has_registry_auth` and the "(currently set — enter
to replace)" placeholder-text mechanism in the same pass: once a set field is pre-filled with the
real `****` placeholder content (not left blank), that boolean and its placeholder-text convention
become dead weight — the masked value itself already conveys "this is set." Confirmed nothing else
in the frontend reads these `has_*` flags (only the form-modal placeholder logic did).

## Supersedes / modifies

Modifies the "Secrets never round-trip to the browser" design decision in
[storage-admin-ui.md](done/storage-admin-ui.md) and the equivalent one in
[cluster-admin-ui.md](done/cluster-admin-ui.md): the no-plaintext-round-trip property is kept, but
"blank on edit" becomes "`****` placeholder on edit, resolved server-side." Does not change
`credential_strategy`, `mint()`/`provision()`, or anything about which protocols/cluster types are
implemented.

## Background — current state (confirmed by reading the code)

- `backend/models/storage_backend.py` — `StorageBackend.config` (JSON dict, e.g.
  `{"admin_access_key": ..., "admin_secret_key": ...}` for MinIO, or `{"raw": "<json blob>"}` for
  the GCS/S3 stubs). `to_dict()` never includes `config`.
- `backend/routers/admin.py` `_storage_backend_admin_dict()` adds `has_config: bool(backend.config)`
  — the only place `config`'s presence is exposed to the client today.
- `frontend/src/StorageBackendsAdminPanel.jsx` — `config` state always resets to `{}` on modal open
  (edit or create) per the "reset all form state... connection config is always write-only" effect
  comment. `hasConfig = isEdit && backend.protocol === protocol && backend.has_config` is passed as
  `hasExisting` to `MinioStorageForm`/`GcsStorageForm`/`S3StorageForm`, which only use it to pick
  placeholder text on an otherwise-empty field.
- `handleTest()` always POSTs `{protocol, endpoint, config}` to the **stateless**
  `/admin/storage-backends/test-connection` route — this route has no backend row to compare
  against today, and (verified) has no `db` dependency at all.
- `handleSubmit()` only includes `protocol`/`config` in the PATCH/POST body if `configTouched` —
  editing unrelated fields (e.g. `sort_order`) correctly never touches `config`. This part is
  correct today and is unaffected by this plan.
- Backend `_test_and_apply_storage_connection()` (PATCH path) and
  `admin_test_storage_backend_connection()` (stateless path) both pass `body.get("config") or {}`
  straight through to `handler.test_connection()` with no resolution against any stored value.
- The identical shape exists for clusters: `Cluster.provider_config` (JSON dict, e.g.
  `{"kubeconfig": "<yaml or already-parsed dict>"}` for the `kubeconfig` provider — see
  `backend/services/cluster_providers/kubeconfig.py`, which normalizes the raw string to a parsed
  dict in place on first successful `test_connection`) and `Cluster.registry_auth` (a plain
  `String` column, not JSON — edited by its own always-blank password field in
  `ClustersAdminPanel.jsx`, submitted only `if (form.registryAuth)` truthy, so today it already
  can't be blanked-out by accident, just can't be *tested* — clusters' "Test Connection" only
  exercises `provider_config`/cluster reachability, never `registry_auth`, which is registry-pull
  auth, not cluster connectivity).
- `admin_test_cluster_connection()` (stateless route) also has no `db` dependency today.

## Design decisions (settled in discussion)

- **Placeholder is a single fixed sentinel string, `"****"`, applied uniformly per top-level key of
  a config dict (or to a whole scalar field like `registry_auth`).** `config`/`provider_config` are
  already treated as opaque-to-everything-except-the-strategy-implementation blobs (per their own
  model docstrings) — the admin layer doesn't need to know which specific sub-fields are
  "sensitive" vs. not, because today every field in these blobs is credential material. Masking key
  by key (not the whole dict as one opaque value) is what lets an admin change just one field
  (e.g. rotate `admin_access_key`) while leaving a sibling field (e.g. `admin_secret_key`)
  untouched — required for the "partial edit" case to work at all.
- **Shared helpers live in a new small module, `backend/services/secret_masking.py`**, not inside
  `storage_backend.py` or `admin.py` — it's genuinely used by both the storage and cluster call
  sites from the start (not speculative future reuse), and neither model should import the other's
  concerns.
  - `mask_config(config: dict | None) -> dict` — `{k: "****" for k in (config or {})}`.
  - `mask_secret(value: str | None) -> str | None` — `"****"` if truthy, else `None`.
  - `resolve_config(submitted: dict | None, stored: dict | None) -> dict` — per-key: if a
    submitted value equals the sentinel, replace it with `stored[key]`; raises `ValueError` if the
    key isn't in `stored` (nothing to restore — a clear, actionable error, not a silent no-op or a
    confusing downstream connection-test failure).
  - `resolve_secret(submitted, stored) -> value` — same idea for a lone scalar field.
- **The stateless Test Connection routes gain an optional id parameter** (`backend_id` for storage,
  `cluster_id` for clusters) so they can look up the row being edited and resolve `"****"` against
  its *current* stored config. Required because the "Test Connection" button in the edit modal
  hits the stateless route, not the PATCH route, and can't resolve placeholders without knowing
  which row to compare against. If the id is missing, unknown, or the protocol/cluster_type in the
  request doesn't match the stored row's (no cross-protocol carryover, matching the existing
  "switching protocol always requires re-entering config from scratch" rule), the fallback is
  treated as "nothing stored" (`{}`/`None`) — a `"****"` submitted in that situation is a genuine
  error (`resolve_config`/`resolve_secret` raise), not a lookup failure to mask with an unrelated
  404.
- **`has_config`/`has_provider_config`/`has_registry_auth` are removed**, along with the
  `hasExisting` prop and its placeholder-text branch in every per-protocol/per-cluster-type form
  component. Confirmed by reading `StorageBackendsAdminPanel.jsx`/`ClustersAdminPanel.jsx` and the
  admin list tables that nothing else reads these flags.
- **`registry_auth` gets the same `"****"`-and-resolve treatment as `config`/`provider_config`**,
  for consistency (it's the same "write-only secret" shape, just a scalar column instead of a JSON
  dict), even though it doesn't currently have the Test-Connection bug (registry auth isn't part of
  cluster connectivity testing). Its existing "can't be cleared to blank via the UI, only replaced"
  behavior is preserved unchanged — this plan does not add a way to clear it, only fixes how
  "unchanged" is represented and resolved.

## Phase 1 — Shared masking helpers

### 1.1 `backend/services/secret_masking.py` (new file)

```python
"""Shared helpers for write-only secret fields in the admin API (StorageBackend.config,
Cluster.provider_config, Cluster.registry_auth). Secrets are never sent to the browser in
plaintext — GET/list responses substitute MASKED for each set field. On Save/Test Connection, any
field still equal to MASKED means "leave unchanged" and is resolved back to the stored value here,
rather than being persisted (or tested against) literally."""

MASKED = "****"


def mask_config(config):
    return {k: MASKED for k in (config or {})}


def mask_secret(value):
    return MASKED if value else None


def resolve_config(submitted, stored):
    stored = stored or {}
    resolved = dict(submitted or {})
    for key, value in resolved.items():
        if value == MASKED:
            if key not in stored:
                raise ValueError(
                    f"cannot restore masked value for {key!r}: no existing value stored"
                )
            resolved[key] = stored[key]
    return resolved


def resolve_secret(submitted, stored):
    if submitted == MASKED:
        if not stored:
            raise ValueError("cannot restore masked value: no existing value stored")
        return stored
    return submitted
```

No test-writing infrastructure exists elsewhere in `backend/services/`, so no new test file is
added here — consistent with the rest of the codebase (see CLAUDE.md Testing section: backend
tests are a TODO).

## Phase 2 — Storage backend routes (`backend/routers/admin.py`)

### 2.1 `_storage_backend_admin_dict`

```python
def _storage_backend_admin_dict(backend: StorageBackend) -> Dict:
    d = backend.to_dict()
    d["config"] = mask_config(backend.config)
    return d
```

(drops the `has_config` line)

### 2.2 `_test_and_apply_storage_connection` (PATCH path)

```python
async def _test_and_apply_storage_connection(backend: StorageBackend, body: Dict) -> None:
    if "protocol" in body or "config" in body:
        protocol = body.get("protocol", backend.protocol)
        submitted = body.get("config") or {}
        stored = backend.config if protocol == backend.protocol else {}
        try:
            config = resolve_config(submitted, stored)
            handler = get_protocol_handler(protocol)
            await handler.test_connection(_TestBackend(backend.endpoint, config))
        except HTTPException:
            raise
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Connection test failed: {e}")
        backend.protocol = protocol
        backend.config = config
```

Ordering is unchanged (still runs after `_apply_storage_generic_fields`, still reads
`backend.config` — the pre-update stored value — before overwriting it), and the create path
(`admin_create_storage_backend`) goes through the same function unchanged; a brand-new backend has
no stored config, so a stray `"****"` there correctly raises rather than silently doing nothing.

### 2.3 Stateless test-connection route

```python
@router.post("/admin/storage-backends/test-connection")
async def admin_test_storage_backend_connection(
    body: Dict, auth=Depends(require_admin), db: AsyncSession = Depends(get_db)
):
    protocol = body.get("protocol")
    if not protocol:
        raise HTTPException(status_code=400, detail="protocol is required")
    stored = {}
    backend_id = body.get("backend_id")
    if backend_id:
        existing = await db.get(StorageBackend, backend_id)
        if existing is not None and existing.protocol == protocol:
            stored = existing.config or {}
    try:
        config = resolve_config(body.get("config") or {}, stored)
        handler = get_protocol_handler(protocol)
        await handler.test_connection(_TestBackend(body.get("endpoint"), config))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Connection test failed: {e}")
    return {"ok": True}
```

## Phase 3 — Storage frontend (`StorageBackendsAdminPanel.jsx` + protocol forms)

- On modal open for an existing backend: `setConfig(backend.config || {})` (now the masked dict
  from the server) instead of `setConfig({})`. `configTouched` still starts `false` — untouched
  masked fields must not cause Save to include `config`/re-run Test Connection, same invariant as
  today.
- `handleProtocolChange` unchanged: still resets to `{}` and marks touched (no cross-protocol
  carryover, matches the resolve-side guard in 2.2/2.3).
- `handleTest`: include `backend_id: backend?.id` in the POST body when editing, so the stateless
  route in 2.3 can resolve.
- `hasConfig`/`hasExisting` removed; `MinioStorageForm`/`GcsStorageForm`/`S3StorageForm` drop the
  `hasExisting` prop and the "(currently set — enter to replace)" placeholder branch, falling back
  to their plain empty-state placeholder (`''` / `'{}'` / format hint) since the field is now
  either genuinely empty (nothing stored) or pre-filled with `****` (something stored) — no
  separate hint text is needed.

## Phase 4 — Cluster routes (`backend/routers/admin.py`)

Mirrors Phase 2 exactly:

- `_cluster_admin_dict`: add `d["provider_config"] = mask_config(cluster.provider_config)` and
  `d["registry_auth"] = mask_secret(cluster.registry_auth)`; drop `has_provider_config`/
  `has_registry_auth`.
- `_test_and_apply_connection`: resolve `provider_config` via `resolve_config`, guarded by
  `cluster_type == cluster.cluster_type` for the stored fallback, same as storage's protocol guard.
- `_apply_generic_fields`: replace
  `if body.get("registry_auth"): cluster.registry_auth = body["registry_auth"]` with
  ```python
  if body.get("registry_auth"):
      cluster.registry_auth = resolve_secret(body["registry_auth"], cluster.registry_auth)
  ```
  (still a no-op skip if the field is absent/blank — unchanged "can't clear via UI" behavior).
- `admin_test_cluster_connection` (stateless route): add `db: AsyncSession = Depends(get_db)` and
  an optional `cluster_id` in the body, resolving `provider_config` against the stored row exactly
  like storage's `backend_id` handling in 2.3.

## Phase 5 — Cluster frontend (`ClustersAdminPanel.jsx` + provider forms)

- On modal open for an existing cluster: `setProviderConfig(cluster.provider_config || {})` and
  `setForm(f => ({ ..., registryAuth: cluster.registry_auth || '' }))` (the masked values) instead
  of always blank. `configTouched` still starts `false`.
- `handleTest`: include `cluster_id: cluster?.id` when editing.
- `KubeconfigClusterForm` drops `hasExisting` and its placeholder branch, same as the storage
  protocol forms.
- Registry Auth field drops the `cluster?.has_registry_auth` placeholder condition — it's now
  pre-filled with `****` directly when set, no separate hint needed.

## Open Questions

- None outstanding — scope (storage + clusters) and the `has_*`/placeholder cleanup were both
  confirmed with the user before writing this plan.
