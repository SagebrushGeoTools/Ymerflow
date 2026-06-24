# Backend Hook System Plan

## Goal

Introduce a lightweight plugin hook system for the backend using setuptools entry points.
The first use is to extract all billing and quota logic into a separate top-level `billing/`
module that is decoupled from the core backend. With billing installed the current behaviour is
preserved; without it users can run any inversion, any number of times, at no cost, with no
transaction records created.

---

## Two kinds of plugins (shared vocabulary)

Nagelfluh has two plugin delivery mechanisms that converge on **one frontend artifact format** — a
Module Federation remote **built by Nagelfluh from an npm source package** against the host's exact
shared versions. They differ only in *where the build runs*:

| | **Frontend plugin** | **Backend plugin** |
|---|---|---|
| Packaged as | an npm source package | pip-installed Python package |
| Installed by | run a build Process in a project, then register; user enables per-account | admin (`pip install`) — system-wide |
| Can provide | frontend extensions only | backend models, hooks, **API routers**, **and** a frontend package |
| Frontend **build** | in a `build_frontend_plugin` **Process** (pod), output dataset in the project bucket | **at `pip install` time, from the plugin's `setup.py`** (admin-installed ⇒ trusted) |
| Frontend **serve** | content-addressed from the project-bucket dataset | content-addressed from the package's bundled `frontend_dist/` |

A backend plugin is a **superset** of a frontend plugin: anything a frontend plugin can register
(dataset types, widgets, layer types, quantity kinds, pages, frontend hook callbacks) a backend
plugin can register too — by **declaring the same kind of npm frontend source**. Because the backend
plugin is admin-installed and therefore trusted, its **`setup.py` builds that source at install
time** (rather than in a Process) and ships the result as package data; the backend content-addresses
it and advertises it through the same plugin-list endpoint, so the browser loads it identically. The
asymmetry is intentional and one-directional: a frontend plugin is pure JS and cannot run backend
code.

This document covers the **backend** half — the hook runner, models, API routers, and the
server-side build/serve of a backend plugin's frontend. The **frontend** extension API (registries,
the frontend hook system, MF loading), the `build_frontend_plugin` Process, and the register/serve
mechanics live in `plugin-system-plan.md`. The two halves meet at:

- the `frontend_bundles` hook (below) → `GET /plugins/me` → MF `loadRemote` in the browser, and
- the shared SDK (`nagelfluh-plugin-sdk`) that both plugin kinds import to register extensions.

---

## Hook runner — `backend/hooks.py`

Two calling styles share the same entry-point discovery:

```python
hooks.run.hook_name(*args, **kwargs)              # sync  — returns list
await hooks.run_async.hook_name(*args, **kwargs)  # async — returns list
```

Both styles use the **same attribute-access (Proxy) namespace** convention — the hook name is an
attribute, not a string argument — and differ only in sync vs async:

- `hooks.run` is a namespace where attribute access returns a **sync** callable. Used in the
  common case and for early-init where no event loop is available yet (see `register_models`).
- `hooks.run_async` is a namespace where attribute access returns an **async** callable.
- Both discover all entry points in the `nagelfluh.hooks` group whose `name` matches the
  attribute, load them, and call them in registration order.
- `hooks.run_async.<name>(...)` awaits async hook functions (detected via
  `asyncio.iscoroutine`) automatically; `hooks.run.<name>(...)` requires all matching hooks
  to be sync.
- If no entry points match the name, both return `[]` immediately.
- Return values from each hook must be `list`; they are concatenated into one list.

**Exception handling — all hooks always run:**
If a hook raises, the runner catches the exception, continues calling the remaining
hooks, then re-raises after all hooks have completed. This ensures that execution order
never determines which hooks run. If multiple hooks raise, the first exception is
re-raised with the others chained as `__context__`:

```python
# pseudocode for the runner's inner loop
errors = []
for hook_fn in matched_hooks:
    try:
        results.extend(await hook_fn(...))
    except Exception as e:
        errors.append(e)
if errors:
    for later in errors[1:]:
        later.__context__ = errors[0]
    raise errors[-1]
```

**`UserError`** is a general backend/REST API concept, not specific to the hook system.
It lives in **`backend/exceptions.py`** and is used by both core backend code and plugins:

```python
# backend/exceptions.py
class UserError(Exception):
    """A failure caused by the end user. The message is shown directly in the UI
    and is not treated as a software fault. Raise instead of HTTPException where
    the error originates deep in model/service code rather than in a route handler."""
    pass
```

FastAPI registers a global exception handler that converts `UserError` to a 400
response, while unhandled exceptions become 500s. This applies everywhere in the
backend — routes, services, and hook implementations alike.

Plugin modules subclass it for their domain errors:

```python
# billing/__init__.py
from backend.exceptions import UserError

class InsufficientFundsError(UserError):
    pass
```

The backend never imports plugin-specific subclasses — hook call sites catch `UserError`
for clean user-facing failures and `Exception` for unexpected faults.

```
nagelfluh.hooks
  └─ <name>   one entry point per (package, hook-name) pair
```

Multiple packages can register different functions under the same `name`; all are called
and their results merged.

---

## Billing module — `billing/`

A new top-level Python package at the project root. It depends on `backend` (imports
`backend.database.Base`, `backend.config.settings`) but the reverse is not true — the
backend never imports from `billing` directly.

### Files

```
billing/
  __init__.py      — hook functions (registered as entry points)
  models.py        — UserBalance, UserTransaction, TransactionType
  config.py        — BillingSettings (process_cost, initial_user_balance)
```

### `billing/models.py`

```python
from backend.database import Base
from backend.models.user import User   # to patch back-references onto User

class TransactionType(str, enum.Enum):
    credit  = "credit"
    debit   = "debit"
    hold    = "hold"
    release = "release"

class UserBalance(Base):
    __tablename__ = "user_balances"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    balance = Column(Numeric(10, 2), default=0, nullable=False)
    user    = relationship("User", back_populates="billing_balance")

class UserTransaction(Base):
    __tablename__ = "user_transactions"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    user_id         = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"),
                             nullable=False, index=True)
    timestamp       = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    type            = Column(Enum(TransactionType), nullable=False)
    description     = Column(String(500), nullable=False)
    amount          = Column(Numeric(10, 2), nullable=False)
    process_id      = Column(String(255), ForeignKey("processes.id", ondelete="SET NULL"),
                             nullable=True)
    process_version = Column(Integer, nullable=True)
    process_name    = Column(String(255), nullable=True)
    user            = relationship("User", back_populates="billing_transactions")

# Patch back-references onto User so SQLAlchemy can resolve both sides.
# This runs when billing/models.py is imported; User itself has no mention of billing.
User.billing_balance      = relationship("UserBalance",     uselist=False,
                                         cascade="all, delete-orphan")
User.billing_transactions = relationship("UserTransaction", cascade="all, delete-orphan")
```

`UserBalance` is 1-to-1 with `User` (enforced by the primary key being the FK itself).
`UserTransaction` is the existing table moved verbatim from `backend/models/user.py`.

SQLAlchemy fully supports adding `relationship()` properties to a mapped class after the
class body is defined, as long as it happens before `configure_mappers()` is called (the
first DB operation). The patching here executes at import time of `billing/models.py`,
which is triggered by the `register_models` hook (see below) well before any session is
opened.

---

## `billing/config.py`

```python
from pydantic_settings import BaseSettings

class BillingSettings(BaseSettings):
    process_cost: float = 0.10
    initial_user_balance: float = 100.0

    class Config:
        env_file = "config.env"
        env_prefix = "BILLING_"

billing_settings = BillingSettings()
```

`backend/config.py` loses `process_cost` and `initial_user_balance` entirely. All
billing hook functions import from `billing.config` instead.

---

## Changes to `backend/models/user.py`

Remove entirely — no billing references remain in this file:
- `balance` column
- `transactions` relationship
- `TransactionType` enum
- `UserTransaction` model
- `get_held_amount()` method
- `get_available_balance()` method

The `User` class gains **nothing** to replace them. Back-references are added
dynamically by `billing/models.py` at import time (see above). `User` is left
completely unaware of billing.

Remove `UserTransaction` and `TransactionType` from `backend/models/__init__.py`.

`User.to_dict()` — remove `balance` and `transactions` from the base dict, then call
the `user_to_dict` hook and deep-merge all returned dicts into the result:

```python
def to_dict(self):
    result = { "username": self.username, "email": self.email, "preferences": self.preferences }
    for extra in hooks.run.user_to_dict(self):
        result.update(extra)
    return result
```

Any query that calls `to_dict()` must also apply the options returned by the
`user_query_options` hook so that billing relationships are eagerly loaded before
`to_dict()` is called (async SQLAlchemy cannot lazy-load inside a sync method):

```python
from backend.hooks import hooks

extra_opts = hooks.run.user_query_options()  # e.g. [selectinload(User.billing_balance), ...]
stmt = select(User).options(selectinload(User.something), *extra_opts).where(...)
```

Call sites that need the full user dict: signup, login, `GET /auth/me`. Any site that
only needs identity fields (e.g. permission checks) can skip `user_query_options`.

---

## Alembic / migration strategy

`register_models` is a **sync** hook (no DB access, just imports). It is called in two
places:

**1. `backend/models/__init__.py` — application startup**

```python
# bottom of backend/models/__init__.py
from backend.hooks import hooks
hooks.run.register_models()
```

This runs before any SQLAlchemy session is opened, so the back-references added by
`billing/models.py` are present before `configure_mappers()` is triggered. When billing
is not installed, `hooks.run.register_models()` returns `[]` and `User` is left plain.

**2. `backend/alembic/env.py` — migration generation**

```python
# before target_metadata is read
from backend.hooks import hooks
hooks.run.register_models()
target_metadata = Base.metadata
```

`billing/__init__.py` registers the hook:

```python
def register_models():
    import billing.models  # registers UserBalance/UserTransaction on Base; patches User
    return []
```

When billing is not installed, `Base.metadata` contains only core tables and
`alembic revision --autogenerate` produces no billing migrations. When billing is
installed, the two billing tables appear in metadata and a single `alembic revision`
creates the migration that adds them. Billing tables are managed in the same Alembic
history as the core backend — one migration file, generated once at install time.

---

## Hook API

All hooks live in `billing/__init__.py` and are registered in `setup.py`.

### `job_pre_run(db, user, process, process_version) -> []`

Async. Called by the backend just before a K8s job is submitted. Billing calculates the
max cost internally from `process_version.resource_requests` and
`process_version.deadline_seconds`, checks the user's `UserBalance`, deducts the
submission fee, verifies sufficient funds, and creates a `HOLD` `UserTransaction`.
Commits before returning. To abort the job, raises a domain exception (e.g.
`billing.InsufficientFundsError`); the backend catches `Exception` at the call site.

### `job_completed(db, process, process_version, runtime_seconds, status) -> []`

Async. Called by the backend when a K8s job finishes (succeeded or failed). Billing
calculates the actual cost internally from `process_version.resource_requests` and
`runtime_seconds`, looks up the matching `HOLD` transaction, creates `RELEASE` and
`DEBIT` transactions, and decrements `UserBalance.balance`. Does **not** commit — the
caller commits at the end of its own logic.

If no `HOLD` transaction exists (billing was not active when the job was submitted),
returns `[]` without doing anything.

### `user_created(db, user) -> []`

Async. Called by the backend after a new `User` row is flushed (but not yet committed).
Billing creates a `UserBalance` record with the configured initial balance and inserts a
`CREDIT` `UserTransaction`. Does **not** commit — the caller (signup endpoint) commits.

### `user_query_options() -> [SQLAlchemy load option]`

**Sync.** Returns a list of SQLAlchemy `selectinload` (or similar) options that query
sites must add to any `select(User)` statement whose result will be passed to
`User.to_dict()`. Billing returns:

```python
from sqlalchemy.orm import selectinload
from backend.models.user import User

def user_query_options():
    return [
        selectinload(User.billing_balance),
        selectinload(User.billing_transactions),
    ]
```

When billing is not installed, returns `[]` and no extra joins are issued.

### `user_to_dict(user) -> dict`

**Sync.** Receives the `User` ORM object (with billing relationships already loaded via
`user_query_options`) and returns a dict of extra fields to merge into `User.to_dict()`.
Billing returns:

```python
def user_to_dict(user):
    balance = user.billing_balance
    if balance is None:
        return [{}]
    return [{
        "balance": float(balance.balance),
        "transactions": [t.to_dict() for t in (user.billing_transactions or [])],
    }]
```

When billing is not installed, returns `[]` and the base dict is unchanged.

### `register_models() -> []`

**Sync.** Imports `billing.models` as a side effect, which:
- registers `UserBalance` and `UserTransaction` on SQLAlchemy's `Base.metadata`, and
- patches `User.billing_balance` and `User.billing_transactions` back-references onto
  the `User` class.

Called synchronously from `backend/models/__init__.py` (app startup) and from
`backend/alembic/env.py` (migration generation). Must remain sync — both call sites
have no event loop.

---

## Changes to `backend/models/process.py`

### `ProcessVersion` model — remove cost fields

Remove from the model:
- `max_reserved_cost` column
- `actual_cost` column
- `_calculate_max_cost()` method
- `_calculate_actual_cost()` method

These are billing concepts with no meaning in the core backend. The billing module
tracks costs internally (in `UserTransaction` amounts).

Log messages that currently reference `actual_cost` drop the cost portion:
```python
# Before:
f"Process completed in {runtime_seconds:.1f}s, cost: ${process_version.actual_cost}"
# After:
f"Process completed in {runtime_seconds:.1f}s"
```
Billing's `job_completed` hook can append its own log entry with cost details.

### `Process.create_queued()` — remove cost pre-calculation

Remove the line:
```python
version_obj.max_reserved_cost = Decimal(str(version_obj._calculate_max_cost()))
```
Nothing replaces it. The backend creates the `ProcessVersion` with no cost fields.

### `ProcessVersion.run_task()` — pre-run hook

Replace the entire balance-check + HOLD block (~30 lines) with:

```python
try:
    await hooks.run_async.job_pre_run(db, user, process, process_version)
except UserError as e:  # from backend.exceptions
    await process_version.add_log_entry(db, f"ERROR: {e}")
    await process_version.update_state(db, ProcessState.FAILED, process.project_id)
    return
except Exception as e:
    logger.error(f"Unexpected error in job_pre_run hook: {e}", exc_info=True)
    await process_version.add_log_entry(db, f"Internal error: {e}")
    await process_version.update_state(db, ProcessState.FAILED, process.project_id)
    return
```

The user lookup that precedes this block stays (user object is passed to the hook).

### `ProcessVersion._handle_job_completion()` — completion hook

Replace the entire actual-cost calculation + transaction block with:

```python
await hooks.run_async.job_completed(db, process, process_version, runtime_seconds, status)
await db.commit()   # unchanged position — commits any billing additions
```

---

## Changes to `backend/routers/auth.py` — signup

```python
# Before:
user = User(
    ...
    balance=Decimal(str(settings.initial_user_balance)),
    ...
)
db.add(user)
await db.flush()
db.add(UserTransaction(
    type=TransactionType.credit, description="Welcome bonus",
    amount=Decimal(str(settings.initial_user_balance))
))
await db.commit()

# After:
user = User(...)   # no balance field
db.add(user)
await db.flush()
await hooks.run_async.user_created(db, user)
await db.commit()
```

Remove `UserTransaction`, `TransactionType` imports from `auth.py` if unused elsewhere.

---

## `setup.py` at project root

```python
from setuptools import setup, find_packages

setup(
    name='nagelfluh',
    version='0.1.0',
    packages=['billing'],
    entry_points={
        'nagelfluh.hooks': [
            'register_models    = billing:register_models',
            'user_query_options = billing:user_query_options',
            'user_to_dict       = billing:user_to_dict',
            'job_pre_run        = billing:job_pre_run',
            'job_completed      = billing:job_completed',
            'user_created       = billing:user_created',
        ],
    },
)
```

### Activation

```bash
pip install -e .                                       # registers entry points
alembic -c backend/alembic.ini revision --autogenerate -m "add billing tables"
alembic -c backend/alembic.ini upgrade head
```

To deactivate billing (e.g. for open self-hosted deployments), remove the entry points
from `setup.py` and reinstall. No code changes to the backend are needed.

---

## Backend plugins: API routers and frontend assets

The billing example above registers only models and data hooks. Backend plugins in general need
two further capabilities — their own **API endpoints** and their own **frontend bundle**. Two
additional sync hooks cover these. Both are part of the core hook contract, not billing-specific.

### `register_routers(app) -> []`

**Sync.** Called once from `backend/main.py` after the core routers are included. Each plugin
adds its own FastAPI routers to the app:

```python
# billing/__init__.py
def register_routers(app):
    from billing.router import router   # APIRouter(prefix="/billing", tags=["billing"])
    app.include_router(router)
    return []
```

`backend/main.py` — immediately after the existing hardcoded `app.include_router(...)` block:

```python
from backend.hooks import hooks
hooks.run.register_routers(app)
```

This is how a backend plugin's frontend page (e.g. a billing dashboard) gets the API it calls.
The plugin owns its URL prefix; prefix collisions are the admin's responsibility. Routers may use
the same `UserError` → 400 handling and the same auth dependencies as core routes, since they are
mounted on the same app.

### Building the frontend at install — `setup.py`

A backend plugin **triggers its own frontend build from `setup.py`**, so the build runs as part of
`pip install` (which already needs the network) rather than lazily at app startup. A custom
setuptools command fetches the declared npm **source** and builds it as a Module Federation remote
with `shared` pinned to the **host's** versions — via the SDK's federation preset, reading the host
shared-version manifest provided by the installed `nagelfluh` package — and writes the output into
the package's `frontend_dist/`, shipped as `package_data`:

```python
# setup.py
from setuptools import setup
from setuptools.command.build_py import build_py
from nagelfluh.plugin_build import build_frontend     # provided by the host package/SDK

class BuildWithFrontend(build_py):
    def run(self):
        # npm install @nagelfluh/billing-frontend@2.3.1 + MF build pinned to host versions
        build_frontend(npm_name='@nagelfluh/billing-frontend', npm_version='2.3.1',
                       out_dir='billing/frontend_dist')
        super().run()

setup(
    name='nagelfluh-billing', version='2.3.1',
    cmdclass={'build_py': BuildWithFrontend},
    package_data={'billing': ['frontend_dist/**']},
    entry_points={'nagelfluh.hooks': [ ... ]},   # see below
)
```

The npm package is the **same kind of source package as a standalone frontend plugin** (see
`plugin-system-plan.md` Phase 6); only the build *trigger* (setup.py vs a `build_frontend_plugin`
Process) and the trust basis (admin `pip install`) differ. The build **is** an `npm install` +
bundle, so it **needs network** — but at `pip install` / wheel-build time, which already uses the
network. The built output ships in the package, so the **running app server never runs npm** (no
build at startup, no per-request fetch). Air-gapped: point the build's `PLUGIN_NPM_REGISTRY` at an
internal mirror.

### `frontend_bundles() -> [BundleDescriptor]`

**Sync.** Points at the **already-built** frontend that `setup.py` produced and shipped as package
data. A backend plugin with no UI simply omits this hook (or returns `[]`):

```python
# billing/__init__.py
import importlib.resources

def frontend_bundles():
    dist = importlib.resources.files('billing') / 'frontend_dist'   # built by setup.py
    return [{
        'display_name': 'Billing',
        'dist_dir':     str(dist),          # built remoteEntry.js + chunks
        'entry':        'remoteEntry.js',
    }]
```

### Serving and advertising bundles — `backend/plugin_assets.py`

Because the frontend is already built, startup does **no network and no build** — it just hashes
each `dist_dir`, content-addresses it, and registers it:

```python
# backend/plugin_assets.py
from backend.hooks import hooks
from backend.plugins import content_address_dir   # hash a built tree, cache in the system store

def mount_plugin_assets(app):
    descriptors = []
    for b in hooks.run.frontend_bundles():
        ch, remote_name = content_address_dir(b['dist_dir'])   # hash + remoteName from package.json
        descriptors.append({
            'name':         remote_name,          # from the built package's nagelfluh.remoteName
            'display_name': b['display_name'],
            'remote_url':   f"/plugin-assets/{ch}/{b['entry']}",
            'source':       'backend',
        })
    app.state.backend_frontend_plugins = descriptors
```

Called from `main.py` at startup (after `register_routers`). `app.state.backend_frontend_plugins`
is the canonical list of backend-shipped frontend plugins, consumed by `GET /plugins/me`.
Backend-plugin frontends and Process-built frontend plugins resolve through the **identical**
`/plugin-assets/{content_hash}/…` route (`plugin-system-plan.md` § 4.4); the serve endpoint streams
from the package's `frontend_dist/` (backend plugin) or a project-bucket dataset (frontend plugin)
transparently.

### Merging into `GET /plugins/me`

`plugin-system-plan.md` Phase 4 defines `GET /plugins/me`. With backend plugins it returns the
**union** of two sources, each entry carrying `{ name, remote_url, source }`:

| `source` | Origin | Toggle |
|---|---|---|
| `"backend"` | `app.state.backend_frontend_plugins` (this doc) | always enabled — present iff the backend plugin is installed |
| `"remote"` | DB `UserPlugin` rows with `enabled=true` (plugin-system-plan) | per-user enable/disable |

The frontend loads both through the identical Module Federation path and cannot tell them apart
at runtime. Backend bundles are **not** user-toggleable: their presence is tied to installed
backend functionality, and disabling billing's UI while billing's endpoints remain live would be
incoherent — exactly mirroring the "no billing installed → no balance anywhere" guarantee.

### Updated `setup.py` entry points

```python
entry_points={
    'nagelfluh.hooks': [
        'register_models    = billing:register_models',
        'register_routers   = billing:register_routers',
        'frontend_bundles   = billing:frontend_bundles',
        'user_query_options = billing:user_query_options',
        'user_to_dict       = billing:user_to_dict',
        'job_pre_run        = billing:job_pre_run',
        'job_completed      = billing:job_completed',
        'user_created       = billing:user_created',
    ],
},
```

---

## Behaviour without billing installed

| Concern | Without billing | With billing |
|---------|-----------------|--------------|
| User balance | not stored | `user_balances` table |
| Submission fee | not checked | checked from `UserBalance` |
| Cost tracking | no cost fields anywhere | HOLD/RELEASE/DEBIT transactions |
| Transaction log | empty | full history in `user_transactions` |
| Signup | user created, no balance record | `UserBalance` created, CREDIT logged |
| Who can run | anyone, unlimited | users with sufficient balance |

---

## Complete hook inventory

| Hook | Style | Caller | Purpose |
|------|-------|--------|---------|
| `register_models` | sync | `backend/models/__init__.py`, `alembic/env.py` | Import billing models; patch `User` back-refs |
| `register_routers` | sync | `backend/main.py` | Plugin adds its FastAPI routers (API endpoints) |
| `frontend_bundles` | sync | `backend/plugin_assets.py` (startup) | Declare MF frontend bundles shipped as package data |
| `user_query_options` | sync | any `select(User)` that calls `to_dict()` | Return extra `selectinload` options for billing relations |
| `user_to_dict` | sync | `User.to_dict()` | Return extra fields (balance, transactions) to merge |
| `job_pre_run` | async | `ProcessVersion.run_task()` | Balance check + HOLD transaction; returns errors |
| `job_completed` | async | `_handle_job_completion()` | RELEASE + DEBIT transactions; no commit |
| `user_created` | async | `auth.py` signup | Create `UserBalance` + CREDIT transaction; no commit |
