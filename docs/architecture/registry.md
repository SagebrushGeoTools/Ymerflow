# Container Registry Architecture

Nagelfluh pulls/pushes process-runner images through a **pluggable registry backend** — the same
pattern used for [object storage](storage.md) (`StorageBackend`/`StorageProtocolHandler`) and
multi-cluster job execution (`Cluster`/`ClusterProvider`). Unlike storage (one backend per
project), there is exactly **one active registry backend**, used app-wide: every cluster pulls
runner images from the same place `docker/build.sh` pushed them to.

**Related documentation:**
- [Storage Architecture](storage.md) — the sibling pluggable-backend axis; the registry axis
  mirrors its shape closely
- [Environment](environment.md) — how a Docker image becomes an Environment's `docker_image`
- Plugin SDK: [`RegistryProtocolHandler` reference](../plugin-sdk/overview.md) (full method
  signatures live in the SDK repo's `docs/backend-hooks.md`)

## Development: self-hosted Docker Registry v2

`dev/setup-registry.sh` deploys a self-hosted [Docker Registry
v2](https://docs.docker.com/registry/) inside Minikube:
- Namespace `registry`, NodePort 30500, self-signed TLS, htpasswd basic auth
  (`REGISTRY_USER`/`REGISTRY_PASSWORD` in `config.env`, both default to `nagelfluh`)
- Reachable at `<REGISTRY_PUBLIC_HOST>:30500` from every cluster (local or remote) — there is no
  per-cluster registry address, matching the "one global registry" model above

Core registers this as protocol `docker-v2` — the only protocol core ships. Any other protocol
(e.g. Google Artifact Registry) is additive, provided by a plugin; local/offline dev has zero
dependency on one existing.

## The `RegistryBackend` model

`backend/models/registry_backend.py`:

```python
class RegistryBackend(Base):
    id: str
    name: str
    protocol: str        # "docker-v2", or a plugin-provided value (e.g. "gar")
    config: dict          # JSON column, opaque — shape is entirely protocol-specific
    active: bool
    sort_order: int
```

`get_default_registry_backend_id(db)` resolves the app-wide registry: the first `active=True` row
ordered by `sort_order`. `docker-v2`'s `config` shape is `{"user", "password", "host", "port"}`.

## `RegistryProtocolHandler`

`backend/services/registry_protocols/` (`__init__.py` for the ABC + `registry_protocol_handlers`
hook, `docker_v2.py` for core's implementation) defines five required methods:

| Method | Sync/async | Purpose |
|---|---|---|
| `image_url(config, repository, tag)` | sync | The single place address *shape* is decided — `docker-v2` returns `host:port/repository:tag` |
| `pull_credentials(config)` | async | Resolve a pod image-pull credential: `{"username", "password", "expires_at"}` |
| `configure_push_auth(config)` | sync | Local `docker login`/credential-helper setup before a `docker push` |
| `test_connection(config)` | async | Validate connectivity/credentials, no side effects |
| `bootstrap(config)` | sync | config.env-driven provisioning hook — see [Configuration](#configuration) below |

Handlers are discovered via the `registry_protocol_handlers` fan-out hook (the same
`nagelfluh.hooks` mechanism as `storage_protocol_handlers`/`cluster_provider_handlers`) — core
registers `docker-v2` through this exact channel, with no "core is special" path. See the plugin
SDK's `docs/backend-hooks.md` for the full reference plugin authors use to add a new protocol.

## Push flow

`docker/build.sh` no longer hardcodes any registry address or credentials. It shells out to:

```
backend/bin/nagelfluh-registry-push <repository> <tag>
```

which:
1. loads the active `RegistryBackend` row,
2. resolves its `RegistryProtocolHandler`,
3. calls `handler.configure_push_auth(config)` (e.g. `docker login` for `docker-v2`),
4. calls `handler.image_url(config, repository, tag)`,
5. prints the resolved full image reference to stdout.

`build.sh` captures that output, `docker tag`s the freshly built local image to it, and `docker
push`es. Core only ever exercises this with `docker-v2`; any other protocol's push mechanics are
that plugin's concern.

## Pull flow: per-Job ephemeral credentials

Rather than a single long-lived registry pull Secret synced into every cluster's jobs namespace
(the old model), each process Job's pull credential is minted **fresh, at Job-creation time**:

1. `ProcessVersion.run_task()` (`backend/models/process.py`) resolves the active
   `RegistryBackend`, its handler, and calls `await handler.pull_credentials(config)`.
2. `job_orchestrator.create_job()` (`backend/services/job_orchestrator.py`) builds a per-Job
   `kubernetes.io/dockerconfigjson` Secret (named `<job-name>-registry-pull`) from that
   credential, keyed under the registry's `host:port` (matching what's actually embedded in the
   pod's image reference).
3. The Job is created first; the Secret is then created **owned by the Job**
   (`ownerReferences` pointing at the Job's UID), so Kubernetes garbage-collects it automatically
   whenever the Job itself is deleted (its own `ttl_seconds_after_finished` cleanup, or an
   explicit kill) — a Job's pull credential is never older than the Job.

This works uniformly for every protocol: `docker-v2`'s static credential just means
`expires_at=None` (never refresh, reuse the value minted at Job launch); a protocol with genuinely
short-lived pull tokens returns a real expiry, though nothing currently re-mints mid-Job on
expiry — `pull_credentials()` is only ever called once, at Job-creation time.

There is no longer a static, namespace-wide `nagelfluh-registry-pull` Secret provisioned by
`dev/lib/provision-nagelfluh-jobs.sh` — that step was removed entirely.

## Configuration

### `config.env`

```bash
# Defaults are turnkey (nagelfluh/nagelfluh); change on any host exposed off a trusted LAN.
REGISTRY_USER=nagelfluh
REGISTRY_PASSWORD=nagelfluh
REGISTRY_PUBLIC_HOST=192.168.1.142   # required for remote-cluster registration; see below
```

These are consumed by a one-time Alembic seed migration
(`backend/alembic/versions/50dd9ce3311b_add_registry_backends_table.py`) that seeds the default
`RegistryBackend` row on first migrate — same "seed once, never re-touch on redeploy" model as
`StorageBackend`/`Cluster`.

### Opting a protocol into `bootstrap()`

All three pluggable axes share one more config.env-driven mechanism, for protocols/providers that
need **live provisioning** (not just persisting static config values) before their default row
is seeded — e.g. a plugin's `gar` registry protocol creating an Artifact Registry repository, or
a `gke` cluster type actually standing up a cluster. Core's `docker-v2`/`minio`/`kubeconfig` never
need this (their `bootstrap()` is a no-op passthrough), so it's entirely opt-in:

```bash
REGISTRY_PROTOCOL=docker-v2
REGISTRY_CONFIG_JSON={"user":"nagelfluh","password":"nagelfluh","host":"192.168.1.142","port":30500}

STORAGE_PROTOCOL=s3
STORAGE_CONFIG_JSON={...}

CLUSTER_TYPE=kubeconfig
CLUSTER_CONFIG_JSON={...}
```

If set, `backend/bin/nagelfluh-bootstrap-provision` (run before migrations in both `dev/runall.sh`
and `prod/runall-minikube.sh`) resolves the matching handler/provider and calls
`.bootstrap(config)`; the enriched `{protocol, config}` result is what the generic seed migrations
(`9623bab8493d` for storage, `d1266f2f6e68` for cluster, `50dd9ce3311b` for registry) persist onto
the default row — overriding whatever the axis's own fallback env vars (`REGISTRY_USER`/
`STORAGE_ENDPOINT`/etc.) would otherwise seed. In `prod/runall-minikube.sh`, since
`nagelfluh-bootstrap-provision` needs the full backend Python environment, it's run host-side via a
one-off `docker run` against the freshly built backend image, and its output is folded into
`nagelfluh-backend-secret`/`nagelfluh-backend-config`, which the in-cluster `alembic-migrate` Job
now also receives via `envFrom` (closing a pre-existing gap where that Job only ever saw a literal
`DATABASE_URL`).

See `docs/plans/done/registry-backend-hooks.md` for the full design history and rationale, and the
plugin SDK's `docs/backend-hooks.md` for how a plugin implements `bootstrap()` on its own
protocol/provider.
