# Short-Lived, Per-Project Storage Credentials — Phase 2: `hooks.run_first` + `select_storage`

Part of [short-lived-storage-credentials-00-overview.md](short-lived-storage-credentials-00-overview.md) — read that first for
goal, background, and architecture summary. This is Phase 2 of 4.

**Depends on:** Phase 1 ([short-lived-storage-credentials-01-storage-backend-model.md](short-lived-storage-credentials-01-storage-backend-model.md))
— needs the `StorageBackend` table and `Project.storage_backend_id` to exist.

Still no behavior change with zero plugins installed — `default` always wins.

## 2.1 `backend/hooks.py` additions

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

## 2.2 `select_storage` hook — call site

**`backend/routers/projects.py`**, in `create_project` (currently line ~74). The request body
param is named `project` (a plain `Dict`) and the ORM row is `proj`; the acting user is
`auth.user`, not a bare `user`. Insert right after `await db.flush()` for `proj` (so `proj.id`
exists) and before `member = ProjectMember(...)` is built — this folds into the single
`db.commit()` a few lines down, no extra round-trip:

```python
from backend.hooks import hooks

DEFAULT_STORAGE_BACKEND_ID = 'default-storage-backend-00000000-0000-0000-0000-000000000000'

proj.storage_backend_id = hooks.run_first.select_storage(
    DEFAULT_STORAGE_BACKEND_ID, db, auth.user, proj
)
```

A plugin implementing this hook receives the same shape of context `job_pre_run` already does
(`db`, the acting `auth.user`, and the object being decided about) — e.g. a billing-tier plugin
could route free-tier users to a shared MinIO backend and paying users to a dedicated GCS bucket.

`proj.storage_backend_id` must be set before `asyncio.create_task(_setup_storage_background(project_id))`
is fired a few lines later (`routers/projects.py:106`), since that background task is what
actually dispatches to a credential strategy per 2.3.

## 2.3 Provisioning becomes backend-parametrized

`setup_project_storage()` currently assumes MinIO unconditionally. It becomes dispatch on
`project.storage_backend.credential_strategy` only — `StorageBackend.credential_strategy` selects
a `CredentialStrategy` (Phase 3.2, [short-lived-storage-credentials-03-credential-strategies.md](short-lived-storage-credentials-03-credential-strategies.md)),
which internally resolves `project.storage_backend.protocol` to a `StorageProtocolHandler`
(Phase 3.1) and delegates to it. `is_minio_enabled()` becomes the built-in `minio` protocol
handler's concern, not a global gate checked ad hoc across the codebase.

**Two call sites need this dispatch, not one.** `is_minio_enabled()` / `setup_project_storage()`
are called from two independent places today:
- `routers/projects.py`'s `_setup_storage_background()` (project creation / manual re-setup via
  `POST /project/{id}/setup-storage`).
- `ProcessVersion.run_task()` (`backend/models/process.py:758-779`) — re-provisions/refreshes the
  k8s secret lazily before *every job launch* (e.g. after a cluster restart wipes the secret), with
  its own independent copy of the `is_minio_enabled()` → `ensure_project_k8s_secret()` /
  `setup_project_storage()` branching.

Both must go through the same per-backend dispatch or they will silently diverge the moment a
non-default `StorageBackend` exists. Extract a single shared helper — e.g.
`storage_credentials.ensure_ready(db, project) -> credentials` — that both call sites use instead
of each keeping its own `if is_minio_enabled(): ... else: ...` branch. This helper is also the
natural home for Phase 3's strategy dispatch (`StaticKeyStrategy` vs `ShortLivedStrategy`) and for
Phase 4's mint-per-launch call, so `run_task()`'s job-launch path and `ShortLivedStrategy.mint()`
don't need separate wiring later.

## Next

Once this phase lands, continue with
[short-lived-storage-credentials-03-credential-strategies.md](short-lived-storage-credentials-03-credential-strategies.md)
(depends on [backend-installable-package.md](backend-installable-package.md) as a prerequisite).
