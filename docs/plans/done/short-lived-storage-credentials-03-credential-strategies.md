# Short-Lived, Per-Project Storage Credentials — Phase 3: Credential strategies

Part of [short-lived-storage-credentials-00-overview.md](short-lived-storage-credentials-00-overview.md) — read that first for
goal, background, and architecture summary. This is Phase 3 of 4.

**Depends on:**
- Phase 2 ([short-lived-storage-credentials-02-hooks-run-first-select-storage.md](short-lived-storage-credentials-02-hooks-run-first-select-storage.md))
  — needs `hooks.run_first`/sorted entry points and the `select_storage` call site in place.
- [backend-installable-package.md](backend-installable-package.md) — the backend must already be a
  pip-installed package registering its own `nagelfluh.hooks` entry points, so core protocol
  handlers can register through the fan-out hook instead of a private dict.

`storage_protocol_handlers` hook + registry, `MinioProtocolHandler` extracted from today's
`minio_service.py` code (refactor, not a behavior change), stub `GcsProtocolHandler` /
`S3ProtocolHandler`, `StaticKeyStrategy` / `ShortLivedStrategy` delegating to the registry.
`setup_project_storage()` dispatches on `credential_strategy` only; protocol dispatch is fully
inside the registry, not duplicated at either call site.

## 3.1 `storage_protocol_handlers` hook — one class per protocol, not an `if`

Protocol-specific behavior (bucket/service-account provisioning, credential minting for a
specific cloud API) never lives inline in a strategy class. It lives in a small handler class per
protocol value, discovered through a fan-out hook — the same `hooks.run.<name>(...)` mechanism
`backend/hooks.py` already provides for `job_pre_run` / `job_completed` / `user_created`
(`backend/hooks.py:10-24`), no new primitive needed.

**New file: `backend/services/storage_protocols/__init__.py`**

```python
class StorageProtocolHandler:
    """Implements protocol-specific storage operations for one value of
    StorageBackend.protocol (e.g. 'minio', 'gcs', 's3'). CredentialStrategy
    implementations (3.2) delegate to one of these instead of branching on
    `backend.protocol` themselves."""

    def provision(self, project, backend) -> dict:
        """One-time setup at project creation: bucket/service-account/policy creation.
        Returns credentials to persist for static-key use, or {} if this protocol never
        persists a long-lived credential."""
        raise NotImplementedError

    def mint(self, project, backend) -> dict:
        """Mint a fresh credential. Returns {"credentials": {...}, "expires_at": datetime | None}."""
        raise NotImplementedError
```

A plugin registers additional (or overriding) protocol handlers by returning a list of
`(protocol_name, HandlerClass)` tuples from a function registered under the existing
`nagelfluh.hooks` entry-point group, exactly like `plugins/billing/setup.py` already does for
`job_pre_run` etc.:

```python
# some-plugin/setup.py
entry_points={'nagelfluh.hooks': ['storage_protocol_handlers = my_plugin:storage_protocol_handlers']}

# my_plugin/__init__.py
def storage_protocol_handlers():
    return [("azure", AzureProtocolHandler)]
```

`hooks.run.storage_protocol_handlers()` flattens core's **and** every plugin's returned list into
one combined list (`_run_sync`'s existing `results.extend(r)` behavior) — no change to `hooks.py`
required for this.

**Core's own handlers register through the very same entry point.** This depends on
[backend-installable-package.md](backend-installable-package.md), which makes the backend a
pip-installed package that registers its own `nagelfluh.hooks` entry points (that plan deliberately
leaves the `nagelfluh.hooks` group empty — *this* plan is what first populates it). There is no
`_BUILTIN_HANDLERS` dict and no "core is special" path: the built-in `minio` / `gcs` / `s3` handlers
are returned by a `storage_protocol_handlers()` function that the root `setup.py` registers under
`nagelfluh.hooks`, exactly as a plugin would:

```python
# root setup.py — add to the entry_points introduced by backend-installable-package.md
'nagelfluh.hooks': [
    'storage_protocol_handlers = backend.services.storage_protocols:storage_protocol_handlers',
],
```

The registry is then assembled once, in `storage_protocols/__init__.py`, purely from the fan-out
hook — core and plugins arrive through the identical channel:

```python
from backend.hooks import hooks
from backend.services.storage_protocols.minio import MinioProtocolHandler
from backend.services.storage_protocols.gcs import GcsProtocolHandler
from backend.services.storage_protocols.s3 import S3ProtocolHandler


def storage_protocol_handlers():
    """Core's built-in protocol handlers, registered under nagelfluh.hooks in the root setup.py
    exactly like a plugin's would be — hence returned as (name, class) tuples, not stored in a
    private dict. Core has no special precedence over plugins."""
    return [
        ("minio", MinioProtocolHandler),
        ("gcs", GcsProtocolHandler),
        ("s3", S3ProtocolHandler),
    ]


_registry = None


def get_protocol_handler(protocol):
    global _registry
    if _registry is None:
        registry = {}
        for name, handler_cls in hooks.run.storage_protocol_handlers():
            if name in registry:
                raise ValueError(
                    f"duplicate storage_protocol_handlers registration for protocol {name!r}"
                )
            registry[name] = handler_cls
        _registry = registry
    return _registry[protocol]()
```

Any two registrations claiming the *same* protocol name — core vs. plugin, or plugin vs. plugin —
raise immediately (never swallow errors, per `CLAUDE.md`) rather than silently picking a winner by
entry-point load order. Because core now has no special precedence, there is deliberately **no
"override a built-in" path**: a deployment that needs different behavior for a cloud registers it
under a *distinct* protocol name (e.g. `gcs-custom`) and points the `StorageBackend.protocol` column
at that name, rather than shadowing the built-in `gcs` key.

Built-in handlers for `minio` / `gcs` / `s3` are implemented directly in core
(`backend/services/storage_protocols/{minio,gcs,s3}.py`) rather than requiring even the default
deployment to install a plugin for basic protocol support — see 3.3.

## 3.2 `CredentialStrategy` — delegates to the protocol handler, never branches on `protocol` itself

**New file: `backend/services/storage_credentials.py`**

```python
from backend.services.storage_protocols import get_protocol_handler


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
    """Today's behavior, made explicit. provision() delegates to the resolved protocol
    handler's provision() — existing MinIO bucket/user/policy creation, or cloud SA + key
    creation — and persists the result on Project. mint() just returns those columns."""
    def provision(self, project, backend):
        return get_protocol_handler(backend.protocol).provision(project, backend)

    def mint(self, project, backend):
        return {
            "credentials": {
                "access_key": project.storage_access_key,
                "secret_key": project.storage_secret_key,
            },
            "expires_at": None,
        }


class ShortLivedStrategy(CredentialStrategy):
    """Lifetime pegged to the shortest common cap across backends actually in use (~1h) for
    uniform refresh cadence, even where a given backend (MinIO) could go longer — see Phase 4."""
    def provision(self, project, backend):
        return get_protocol_handler(backend.protocol).provision(project, backend)

    def mint(self, project, backend):
        return get_protocol_handler(backend.protocol).mint(project, backend)
```

`StorageBackend.credential_strategy` selects which `CredentialStrategy` class
`setup_project_storage()` and the job orchestrator instantiate; `StorageBackend.protocol` selects
which `StorageProtocolHandler` that strategy delegates to. Neither axis's dispatch code needs to
know about the other. The **hard ceilings** that shape `ShortLivedStrategy`'s lifetime choice,
per protocol handler:

| Protocol | Handler class | Mechanism | Hard max lifetime |
|---|---|---|---|
| `gcs` | `GcsProtocolHandler` | IAM Credentials API `generateAccessToken` (impersonation) | 1h (12h only if org policy `iam.allowServiceAccountCredentialLifetimeExtension` is enabled) |
| `s3` | `S3ProtocolHandler` | STS `AssumeRole` | 12h, hard ceiling on `MaxSessionDuration`, no override |
| `minio` | `MinioProtocolHandler` | expiring service account / native STS | operator-configurable, no external ceiling |

A single non-refreshed credential cannot cover a 36h+ inversion job on GCP or AWS at any lifetime
— this is a product limit, not an engineering gap. Hence Phase 4.

## 3.3 Built-in protocol handlers

`backend/services/storage_protocols/minio.py`, `gcs.py`, `s3.py` implement `StorageProtocolHandler`
for the three protocols core ships with, and are returned by core's own `storage_protocol_handlers()`
hook function — registered under `nagelfluh.hooks` in the root `setup.py` (3.1) — so a default
deployment gets MinIO/GCS/S3 support without installing any plugin, yet through the identical
discovery channel plugins use:

- `MinioProtocolHandler` — `provision()` and `mint()` (for the `short-lived` strategy) are
  extracted from today's `minio_service.py` (`setup_project_storage()`, `is_minio_enabled()`)
  essentially unchanged; this is a refactor, not a behavior change (see overview's Implementation
  Order).
- `GcsProtocolHandler` / `S3ProtocolHandler` — `provision()` implements cloud SA + bucket/policy
  creation for `static-key` use; `mint()` implements the impersonation / `AssumeRole` calls in the
  table above for `short-lived` use. New code, built in Phase 3/4, not a refactor of anything
  existing.

A deployment that needs a protocol core doesn't ship (e.g. Azure Blob) adds it with a plugin
implementing `storage_protocol_handlers` (3.1) — no core change required.

## Next

Once this phase lands, continue with
[short-lived-storage-credentials-04-runner-refresh-loop.md](short-lived-storage-credentials-04-runner-refresh-loop.md).
