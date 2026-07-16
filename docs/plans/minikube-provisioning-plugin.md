# Minikube/MinIO/docker-v2 provisioning plugin — Plan

## Goal

Move the local self-hosted infrastructure stack — Minikube itself, the in-cluster MinIO server, and
the in-cluster docker-v2 registry — out of core and into a new backend plugin,
`plugins/ymerflow-minikube`, so that provisioning it goes through the exact same pluggable
`bootstrap()` mechanism `plugins/ymerflow-gcp` already uses for GKE/GCS/GAR, instead of the
hand-rolled shell scripts (`dev/setup-minikube.sh`, `dev/setup-minio.sh`, `dev/setup-registry.sh`)
that predate that mechanism and were never migrated onto it.

**Why this exists:** mid-conversation (2026-07-16) it came up that `MinioProtocolHandler`,
`DockerV2ProtocolHandler`, and every core `ClusterProvider`'s `bootstrap()` are passthrough stubs —
real provisioning for the local stack still happens in the three shell scripts above, called
directly by `prod/runall-minikube.sh`/`dev/runall.sh`, bypassing `nagelfluh-bootstrap-provision`
entirely. Initial framing was that this was a deliberate scope boundary ("`bootstrap()` enriches
config for an already-existing external service; standing up local infra from scratch is a
different kind of problem"). On reflection, that framing was **not accurate** — it was an
after-the-fact rationalization produced from a long text dump rather than a real recorded design
decision. There is no reason the local stack can't be provisioned through the same hook, the same
way `ymerflow-gcp` does it for the cloud stack. This plan closes that gap and deletes the leftover
shell scripts.

## Background — current state

- `backend/services/storage_protocols/minio.py:79-83` (`MinioProtocolHandler.bootstrap`),
  `backend/services/registry_protocols/docker_v2.py:109-113` (`DockerV2ProtocolHandler.bootstrap`),
  `backend/services/cluster_providers/kubeconfig.py:28-32` and `same_as_backend.py`
  (`.bootstrap`) are all `return config` passthroughs.
- `dev/setup-minikube.sh` starts/resizes/recreates the Minikube VM (host-level `minikube
  start`/`stop`/`delete`, interactive `CONFIRM` prompt before a destructive disk-size recreate,
  host port publishing, `NAGELFLUH_DATA_DIR` bind-mount) and applies the static
  `k8s/storage/{persistent-volumes,persistent-volume-claims}.yaml` (hostPath PVs for Postgres +
  MinIO data, rooted at `/mnt/nagelfluh-data/{postgres,minio}` inside the VM).
- `dev/setup-minio.sh` generates/persists a self-signed TLS cert under
  `${NAGELFLUH_DATA_DIR}/certs/minio/`, deploys the MinIO Deployment/Service (NodePort 30900/30901)
  into the `minio` namespace, and does a Python connectivity test
  (`dev/test-minio.py`, which is how this whole conversation started).
- `dev/setup-registry.sh` generates/persists a self-signed TLS cert under
  `${NAGELFLUH_DATA_DIR}/certs/registry/`, hashes the htpasswd credential (via system `htpasswd` or
  a Python+bcrypt fallback), and deploys the docker-v2 registry Deployment/Service (NodePort 30500)
  into the `registry` namespace.
- `prod/runall-minikube.sh` Steps 1–3 call all three scripts directly, before Step 4d's
  `nagelfluh-bootstrap-provision` call (which today only ever fires for plugin-provided protocols,
  since `REGISTRY_PROTOCOL`/`STORAGE_PROTOCOL`/`CLUSTER_TYPE` are unset in the common/local case).
- `plugins/ymerflow-gcp` is the reference pattern to mirror: `gcp_plugin/{storage_protocol,
  registry_protocol,cluster_provider}.py` implement real `bootstrap()` using
  `google.auth.default()` against the operator's own local `gcloud` session, invoked via
  `docker run --rm nagelfluh-backend:prod python backend/bin/nagelfluh-bootstrap-provision`
  (Step 4d) — no host venv needed, because the only thing bootstrap needs is network access to a
  cloud API.
- **Minikube's bootstrap is not that simple**, and this is the one real asymmetry with the GCP
  plugin: `minikube start`/`stop`/`delete` control the host's own Docker daemon and the VM/container
  minikube runs as — there is no cluster yet for a `docker run` container to reach into the way
  GCP's bootstrap reaches into an already-existing cloud API.
- There are **two distinct existing meanings of "minikube cluster" in the codebase** today:
  1. `backend/services/cluster_providers/minikube.py`'s `MinikubeClusterProvider`
     (`self_service_registration=True`) — an admin's own, separately-running minikube instance,
     registered via a copy-paste setup command
     (`frontend/src/clusterProviders/MinikubeClusterForm.jsx`) + `POST
     /admin/clusters/register-callback`, used to give a hosted/SaaS Nagelfluh install extra
     job-execution capacity.
  2. `prod/runall-minikube.sh`'s own deployment target — the *local* minikube this very host starts,
     which hosts the Nagelfluh app itself. This currently uses `cluster_type="same-as-backend"`
     (in-cluster auto-detected `kubeconfig=None`), not `"minikube"`.
  These are conceptually the same kind of cluster, provisioned two different ways, and currently
  modeled as two different `ClusterProvider`s.
- `minio_service.py` (`setup_project_storage`, `get_minio_client_for_backend`) is imported
  **only** by `storage_protocols/minio.py` — nothing else in core touches it, so it moves as a unit.
- No frontend admin form is MinIO/docker-v2–specific (those protocols are only ever config.env/
  bootstrap-provisioned, never added by hand through the admin UI) — only
  `MinikubeClusterForm.jsx` needs to move, exactly like `ymerflow-gcp` ships its own
  `GkeClusterForm.jsx`/`GcsStorageForm.jsx` via the `frontend_bundles` hook.

## Design decisions (settled in discussion, 2026-07-16)

1. **Full move, same names.** `plugins/ymerflow-minikube` becomes the sole registrant of the
   `minio` storage protocol, the `docker-v2` registry protocol, and the `minikube` cluster type —
   mirroring exactly how `gcs`/`gar`/`gke` are plugin-only in `ymerflow-gcp`, with no "generic core
   version + plugin bootstrap-capable version" split. Core's `setup.py` drops these three
   registrations; the corresponding files move into the plugin package. A stock install with
   `ymerflow-minikube` not in `BACKEND_PLUGINS` has no self-hosted storage/registry/cluster option
   left (only `s3`, `same-as-backend`, `kubeconfig`, plus whatever other plugins are installed) —
   consistent with `BACKEND_PLUGINS` already being how this repo's deployments opt into concrete
   infrastructure backends.
2. **Bootstrap runs entirely via `docker run` against the host's Minikube, no host venv.** Extending
   the same container `nagelfluh-backend:prod` Step 4d already runs for GCP bootstrap, but with
   additional host mounts: the host's Docker socket (so `minikube start`/`stop`/`delete` inside the
   container actually control the host's real Minikube, not a nested Docker-in-Docker instance),
   the host's `~/.minikube`/`~/.kube` (so Minikube's own state and the resulting kubeconfig persist
   on the host across bootstrap runs, exactly like today's shell scripts assume), and
   `NAGELFLUH_DATA_DIR` (so the self-signed TLS certs persist across `minikube delete` exactly as
   today). This replaces host-venv `python3`/`minio-client` dependence with container-mount
   dependence — closes the loop on this conversation's original question.
3. **Unify the two "minikube" meanings into one `MinikubeClusterProvider`.** There is one
   plugin-owned cluster type, `minikube`, reachable via two on-ramps into the same `Cluster` row
   shape — exactly paralleling `gke`'s two on-ramps (copy-paste script vs. `bootstrap()`):
   - **External/self-service** (unchanged): admin's own separately-running minikube, via
     `MinikubeClusterForm.jsx` + `register-callback`.
   - **Local/default** (new): `bootstrap()`, invoked by `nagelfluh-bootstrap-provision` when
     `CLUSTER_TYPE=minikube` — starts/resizes the host's own Minikube, applies the storage PVs, and
     returns a `provider_config` holding a real kubeconfig (mirroring `GkeClusterProvider.bootstrap`
     returning `{"endpoint","ca_cert","sa_key"}`) rather than relying on in-cluster auto-detection.
   `prod/runall-minikube.sh`'s default `CLUSTER_TYPE` changes from `same-as-backend` to `minikube`
   as part of this — `same-as-backend` remains in core as a generic option for other
   already-in-cluster scenarios, but is no longer what the default local deployment uses.
4. **Destructive resize refuses rather than silently recreating.** When `bootstrap()` finds an
   existing Minikube VM with a disk size smaller than required, it raises with a clear error
   instructing the operator to re-run with an explicit `MINIKUBE_ALLOW_RECREATE=1` (or similar) —
   no silent `minikube delete`. Mirrors today's shell script's intent (a typed `CONFIRM` prompt)
   without requiring an interactive TTY inside the bootstrap container.
5. **TLS certs stay on the host filesystem.** `bootstrap()` keeps persisting the MinIO/registry
   self-signed certs under `${NAGELFLUH_DATA_DIR}/certs/{minio,registry}/`, bind-mounted into the
   bootstrap container exactly like the Minikube state dirs (decision 2) — same mechanism as today,
   least change, one less thing to redesign in the same pass as the venv/container migration.

## What moves out of core into `plugins/ymerflow-minikube`

- `backend/services/storage_protocols/minio.py` → `minikube_plugin/storage_protocol.py`
  (`MinioProtocolHandler`, `bootstrap()` upgraded from passthrough to real provisioning).
- `backend/services/minio_service.py` → moves alongside it (sole importer).
- `backend/services/registry_protocols/docker_v2.py` → `minikube_plugin/registry_protocol.py`
  (`DockerV2ProtocolHandler`, `bootstrap()` upgraded).
- `backend/services/cluster_providers/minikube.py` → `minikube_plugin/cluster_provider.py`
  (`MinikubeClusterProvider`, `bootstrap()` upgraded to real Minikube VM lifecycle + PV apply).
  Still built on core's `KubeconfigClusterProvider`/`NodePortAppDeploymentMixin` (imported from
  core, not duplicated — same relationship `GkeK8sClient` has to core's `K8sClient`).
- `frontend/src/clusterProviders/MinikubeClusterForm.jsx` → `plugins/ymerflow-minikube/frontend/
  src/MinikubeClusterForm.jsx`, registered via the `frontend_bundles` hook.
- Root `setup.py`: remove the `("minio", ...)`/`("docker-v2", ...)`/`("minikube", ...)` entries
  from `storage_protocol_handlers`/`registry_protocol_handlers`/`cluster_provider_handlers`.
- `k8s/storage/persistent-volumes.yaml`/`persistent-volume-claims.yaml`: split — the MinIO PV/PVC
  moves into the plugin's `bootstrap()` (applied alongside the MinIO Deployment); the Postgres PV/
  PVC stays in core's `k8s/storage/` (Postgres is out of scope for this plugin, per
  `app_deployment.py`'s existing "does NOT own Postgres" boundary).

## What stays in core

- `StorageProtocolHandler`/`RegistryProtocolHandler`/`ClusterProvider` ABCs, the hook-discovery
  registries (`get_protocol_handler`/`get_registry_protocol_handler`/`get_cluster_provider`).
- `S3ProtocolHandler` (generic AWS/S3-compatible, unrelated to Minikube).
- `KubeconfigClusterProvider`/`SameAsBackendClusterProvider` (generic bring-your-own /
  already-in-cluster connectivity, no infra bring-up of their own).
- `NodePortAppDeploymentMixin`, `apply_app_workloads()` (already provider-agnostic — the plugin's
  `MinikubeClusterProvider` continues to import and use these exactly as it does today).
- `nagelfluh-bootstrap-provision`, `nagelfluh-deploy-app` (unchanged — this plan gives them real
  work to do for the local axes, it doesn't change their shape).
- `k8s/postgres/`, `k8s/backend/service.yaml`, RBAC, pgAdmin/Headlamp manifests, and the Postgres
  half of `k8s/storage/` — none of this is Minikube/MinIO/registry-specific.

## Scripts deleted

- `dev/setup-minikube.sh`
- `dev/setup-minio.sh` (+ `dev/test-minio.py`, folded into the plugin's `test_connection()`)
- `dev/setup-registry.sh`

`prod/runall-minikube.sh` and `dev/runall.sh` Steps that called these are replaced by ensuring
`CLUSTER_TYPE=minikube`/`STORAGE_PROTOCOL=minio`/`REGISTRY_PROTOCOL=docker-v2` (with sensible
`*_CONFIG_JSON` defaults) are always set — no longer optional/skipped in the common case — so
`nagelfluh-bootstrap-provision` always does real work for a local deployment, not just for
plugin-provided cloud protocols.

## Remaining items to confirm during implementation (not blocking plan sign-off)

- **`docker/build.sh` / `docker/prepull-images.sh`** currently assume a shared Minikube Docker
  daemon (`eval $(minikube docker-env)`) — confirm these aren't affected by this plan (they build/
  push images, not provision infra) or scope them in if they turn out to be.
- **Migration of existing installs.** An existing `StorageBackend`/`RegistryBackend`/`Cluster` row
  with `protocol="minio"`/`"docker-v2"`/`cluster_type="same-as-backend"` already in a running
  database — confirm this plan doesn't require a data migration (protocol/cluster_type strings are
  unchanged for storage/registry; only the *default* `CLUSTER_TYPE` for new deployments changes,
  existing `same-as-backend` rows keep working since that provider isn't removed).

## Phases

### Phase 1 — Plugin scaffold, pure file move (no behavior change)
- Create `plugins/ymerflow-minikube` mirroring `plugins/ymerflow-gcp`'s layout (`setup.py`,
  `minikube_plugin/__init__.py` with `register_routers`/`frontend_bundles` if needed,
  `nagelfluh.hooks` entry points for the three handler groups).
- Move `storage_protocols/minio.py` + `minio_service.py`, `registry_protocols/docker_v2.py`,
  `cluster_providers/minikube.py`, and `MinikubeClusterForm.jsx` verbatim (imports adjusted, no
  logic changes) — `bootstrap()` stays a passthrough for now.
- Remove the three registrations from root `setup.py`; add `plugins/ymerflow-minikube` to
  `BACKEND_PLUGINS` in `config.env.example`.
- Verify: `dev/runall.sh`/`prod/runall-minikube.sh` still work unchanged (the shell scripts still
  do the real provisioning; only the Python-side registration moved).

### Phase 2 — Real `bootstrap()` for storage (`minio`) and registry (`docker-v2`)
- Port `dev/setup-minio.sh`'s TLS cert generation + Deployment/Service/PV/PVC apply, and
  `dev/setup-registry.sh`'s TLS cert + htpasswd + Deployment/Service apply, into
  `MinioProtocolHandler.bootstrap()`/`DockerV2ProtocolHandler.bootstrap()`, using
  `kubernetes_asyncio` (matching `app_deployment.py`'s style) instead of shell/`kubectl`.
- Port `dev/test-minio.py`'s connectivity check into `MinioProtocolHandler.test_connection()`
  (mostly already there — confirm it covers the same cases).

### Phase 3 — Real `bootstrap()` for cluster (`minikube`)
- Port `dev/setup-minikube.sh`'s VM lifecycle (start/resize-refuse/port-publish/data-mount) into
  `MinikubeClusterProvider.bootstrap()`, shelling out to the `minikube` CLI (no Python SDK for
  this exists) from inside the bootstrap container.
- Extend Step 4d's `docker run` invocation (in `prod/runall-minikube.sh`, and the equivalent in
  `dev/runall.sh`) with the Docker-socket, `~/.minikube`/`~/.kube`, and `NAGELFLUH_DATA_DIR` mounts
  decision 2 requires.
- `bootstrap()` returns a `provider_config` with a real kubeconfig (not `kubeconfig=None`
  auto-detect), per decision 3.

### Phase 4 — Wire the local deployment path onto `minikube` bootstrap by default
- `config.env.example`: set `CLUSTER_TYPE=minikube`/`STORAGE_PROTOCOL=minio`/
  `REGISTRY_PROTOCOL=docker-v2` with sensible default `*_CONFIG_JSON` (or equivalent default-object
  construction in `nagelfluh-deploy-app`/the seed migration if literal config.env defaults are
  awkward) so these axes are no longer skip-if-unset.
- `prod/runall-minikube.sh`: delete Steps 1–3's script calls, replace with (or fold into) the
  `nagelfluh-bootstrap-provision` container run.
- `dev/runall.sh`: same replacement for the dev flow.
- Delete `dev/setup-minikube.sh`, `dev/setup-minio.sh`, `dev/test-minio.py`,
  `dev/setup-registry.sh`.

### Phase 5 — Docs
- Update `docs/deployment.md`, `docs/architecture/registry.md`, `docs/architecture/storage.md` to
  describe the plugin-based local stack instead of the shell scripts.
