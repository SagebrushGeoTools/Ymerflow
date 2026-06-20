# Backend Hook System Plan

## Goal

Introduce a lightweight plugin hook system for the backend using setuptools entry points.
The first use is to extract all billing and quota logic into a separate top-level `billing/`
module that is decoupled from the core backend. With billing installed the current behaviour is
preserved; without it users can run any inversion, any number of times, at no cost, with no
transaction records created.

---

## Hook runner — `backend/hooks.py`

Two calling styles share the same entry-point discovery:

```python
await hooks.run.hook_name(*args, **kwargs)   # async — returns list
hooks.run_sync('hook_name', *args, **kwargs) # sync  — returns list
```

- `hooks.run` is a namespace where attribute access returns an **async** callable.
- `hooks.run_sync(name, ...)` is for the rare early-init case where no event loop is
  available yet (see `register_models` below).
- Both styles discover all entry points in the `nagelfluh.hooks` group whose `name`
  matches, load them, and call them in registration order.
- Async hook functions (detected via `asyncio.iscoroutine`) are awaited automatically
  by `hooks.run`; `hooks.run_sync` requires all matching hooks to be sync.
- If no entry points match the name, both return `[]` immediately.
- Return values from each hook must be `list`; they are concatenated into one list.

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
    for extra in hooks.run_sync('user_to_dict', self):
        result.update(extra)
    return result
```

Any query that calls `to_dict()` must also apply the options returned by the
`user_query_options` hook so that billing relationships are eagerly loaded before
`to_dict()` is called (async SQLAlchemy cannot lazy-load inside a sync method):

```python
from backend.hooks import hooks

extra_opts = hooks.run_sync('user_query_options')  # e.g. [selectinload(User.billing_balance), ...]
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
hooks.run_sync('register_models')
```

This runs before any SQLAlchemy session is opened, so the back-references added by
`billing/models.py` are present before `configure_mappers()` is triggered. When billing
is not installed, `run_sync` returns `[]` and `User` is left plain.

**2. `backend/alembic/env.py` — migration generation**

```python
# before target_metadata is read
from backend.hooks import hooks
hooks.run_sync('register_models')
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

### `job_pre_run(db, user, process, process_version) -> [] or ["error message"]`

Async. Called by the backend just before a K8s job is submitted. Billing calculates the
max cost internally from `process_version.resource_requests` and
`process_version.deadline_seconds`, checks the user's `UserBalance`, deducts the
submission fee, verifies sufficient funds, and creates a `HOLD` `UserTransaction`.
Commits before returning. Returns `[]` on success or `["<reason>"]` to fail the process.

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
errors = await hooks.run.job_pre_run(db, user, process, process_version)
if errors:
    await process_version.add_log_entry(db, f"ERROR: {errors[0]}")
    await process_version.update_state(db, ProcessState.FAILED, process.project_id)
    return
```

The user lookup that precedes this block stays (user object is passed to the hook).

### `ProcessVersion._handle_job_completion()` — completion hook

Replace the entire actual-cost calculation + transaction block with:

```python
await hooks.run.job_completed(db, process, process_version, runtime_seconds, status)
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
await hooks.run.user_created(db, user)
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
| `user_query_options` | sync | any `select(User)` that calls `to_dict()` | Return extra `selectinload` options for billing relations |
| `user_to_dict` | sync | `User.to_dict()` | Return extra fields (balance, transactions) to merge |
| `job_pre_run` | async | `ProcessVersion.run_task()` | Balance check + HOLD transaction; returns errors |
| `job_completed` | async | `_handle_job_completion()` | RELEASE + DEBIT transactions; no commit |
| `user_created` | async | `auth.py` signup | Create `UserBalance` + CREDIT transaction; no commit |
