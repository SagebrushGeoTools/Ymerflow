# Route ALL cluster-directed deployment through the resolved `ClusterProvider` — kill the remaining raw-`kubectl` orchestration in `prod/runall-production.sh` / `docker/build.sh`

## Goal

`docs/plans/done/generic-deployment-orchestration.md` ("Moved minikube support to a separate
plugin", commit range ending `39b94f9`) already made build/push, registry-wait, image pre-pull,
and secret-resolution generic — but its own "Not touched by this plan" section explicitly punted
on two things:

> - Database backend pluggability — Postgres is not a pluggable axis; `k8s/postgres/` stays a
>   static manifest regardless of cluster type.
> - pgAdmin/Headlamp conditionality — deployed unconditionally today; whether these should become
>   optional/hook-driven per cluster type is a separate question, not addressed here.

That deferral is now a real bug, not just a tidiness gap: since `docs/plans/done/gke-app-deployment.md`
landed, `CLUSTER_TYPE=gke` makes `deploy_app()`/`expose_app()` place the backend + frontend
Deployments **on GKE** (`plugins/ymerflow-gcp`'s `GkeClusterProvider`), while `prod/runall-production.sh`
still applies namespaces, Postgres, pgAdmin, Headlamp, RBAC, and every base Secret/ConfigMap via
plain `kubectl` against whatever the **operator's local kubeconfig context** happens to point at —
completely independent of `CLUSTER_TYPE`. For a local Minikube deploy these two things are
(usually) the same cluster by coincidence. For a GKE deploy they are provably not: the backend pod
on GKE tries to reach `postgres.nagelfluh.svc.cluster.local`, a DNS name that only resolves inside
whatever cluster Postgres actually landed on (local Minikube, if that's still the active kubeconfig
context) — cross-cluster in-cluster DNS doesn't work. The deploy is broken, not just inelegant.

This plan finishes the job `generic-deployment-orchestration.md` started: **every piece of
`prod/runall-production.sh`, `docker/build.sh`, `backup.sh`, `restore.sh`, and
`debug-harness/run_debug.sh` that talks to a Kubernetes API talks to it through the `Cluster`
row's resolved `ClusterProvider` — never through a raw `kubectl` subprocess tied to the
operator's ambient local context.** Plugin decides which cluster; plugin's provider applies
everything to it. No exceptions carved out for "just the base infra", "just the migration Job",
or "just the backup/debug scripts" — those were exactly the exceptions that broke the GKE case.

**Hard rule, non-negotiable:** no shell script anywhere in the host repo may invoke `kubectl`
against whatever context happens to be ambient (the operator's `~/.kube/config` current-context),
and no shell script anywhere in the host repo may invoke a vendor CLI (`gcloud`, `minikube`, or
any other cluster-vendor tool) at all. Where a script's job is small enough to do directly in
Python via the resolved `ClusterProvider`'s `k8s_client` (kubernetes_asyncio), it does that —
zero `kubectl` subprocesses (Design decision 1, `prod/runall-production.sh`/`docker/build.sh`).
Where a script's job is easier expressed as `kubectl` (interactive TTY exec, streaming tar over
stdin/stdout — `backup.sh`/`restore.sh`/`debug-harness/run_debug.sh`), `kubectl` may stay, but it
must be pointed at an explicit kubeconfig the resolved `ClusterProvider` materializes for it
(Design decision 5) — never the operator's ambient context. Either way, the plugin is the only
thing that ever knows how to reach or authenticate to a given cluster type; the host repo never
contains vendor-specific reach/auth logic, CLI or otherwise.

**Explicitly not a goal**: making Postgres/pgAdmin/Headlamp themselves a *pluggable* axis (e.g. a
GCP plugin swapping in Cloud SQL instead of in-cluster Postgres). That's a materially bigger
change — a new backend axis, its own hooks, its own bootstrap() — and is called out as an **open
question for a future plan**, not decided here. This plan only fixes *which cluster* the existing,
still-static `k8s/*.yaml` manifests land on.

## Background — current state

(Confirmed by reading the implemented code — `prod/runall-production.sh`, `docker/build.sh`,
`backend/services/app_deployment.py`, `backend/services/cluster_job_provisioning.py`,
`backend/services/cluster_providers/*`, `k8s/**` — not assumed.)

### Already fully generic — do not touch

- `backend/bin/nagelfluh-bootstrap-provision` — resolves `<AXIS>_PROTOCOL`/`<AXIS>_CONFIG_JSON`
  for registry/storage/cluster and calls `.bootstrap()` on each. Runs **host-side** (not as an
  in-cluster Job) — see its own rationale in `prod/runall-production.sh` Step 3's comments: "this
  is deliberately NOT a `docker run` wrapper... whatever a plugin's `bootstrap()` needs is already
  natively present in this shell's environment." This is the precedent the rest of this plan
  generalizes.
- `backend/bin/nagelfluh-registry-push` / `nagelfluh-build-and-push` — registry-protocol-agnostic
  build+push, already used for the process-runner image and (since `app-deployment-hooks.md`) the
  backend/frontend images.
- `backend/services/cluster_job_provisioning.py`'s `ensure_cluster_job_ready()` — **already fully
  correct for this exact problem** (installs Kueue + the `nagelfluh-backend-jobs`/
  `nagelfluh-backend-kueue-reader` RBAC via `kubernetes_asyncio` against whatever `k8s_client` the
  resolved `ClusterProvider.connect()` hands back — zero shell/`kubectl`). It runs from
  `backend/alembic/versions/d1266f2f6e68_generic_seed_default_cluster.py`, which itself runs
  *inside* the migration Job that `apply_app_workloads()`'s `_run_migration_job()` creates on the
  **resolved** cluster (GKE, in our case) — confirmed by reading the migration. So Kueue/job RBAC
  readiness is **not** part of this plan's bug; it already lands correctly on GKE today.
- `backend/services/app_deployment.py`'s `apply_app_workloads()` + `ClusterProvider.deploy_app()`/
  `expose_app()` — the backend/frontend Deployments/Services/ConfigMap/Secret/migration Job,
  already fully provider-driven (`docs/plans/done/app-deployment-hooks.md`). Not touched by this
  plan except for *how* it gets invoked (Design decision 1, below).

### Redundant dead weight — found while researching this plan

- **`k8s/rbac/backend-jobs-rbac.yaml`**, applied by `prod/runall-production.sh` Step 7, duplicates
  *exactly* what `ensure_cluster_job_ready()` already applies generically (see above) — same
  Role/RoleBinding/ClusterRole/ClusterRoleBinding names (`nagelfluh-backend-jobs`,
  `nagelfluh-backend-kueue-reader`). It's a leftover static copy from before that function existed,
  now harmless only because it's applied against the *wrong* cluster half the time and happens to
  be a no-op reapplication the other half. Safe to delete outright.
- **`backend/services/app_deployment.py`'s own module docstring is stale**: it claims Postgres/
  MinIO/the registry/pgAdmin/Headlamp are "applied identically for every cluster type via the
  existing `k8s/*.yaml` manifests" — true for Postgres/pgAdmin/Headlamp, **false** for MinIO/the
  registry, which haven't been static manifests since the minikube-plugin migration (bootstrap()
  deploys them now, per-protocol, only when that axis is configured). Needs a doc fix as part of
  this plan regardless of which design decisions below are picked.

### Genuinely in scope — raw `kubectl` against the ambient local context

**`prod/runall-production.sh`:**
- Step 4 / Step 7: `kubectl apply -f k8s/00-namespaces.yaml`, `k8s/postgres/`, `k8s/storage/`
  (Postgres PV/PVC only — MinIO's manifests are gone, see above), `k8s/backend/service.yaml`,
  `k8s/rbac/backend-jobs-rbac.yaml` (delete per above), `k8s/pgadmin/`, `k8s/headlamp/`.
- Step 6: `kubectl create secret ... nagelfluh-postgres-secret`, `pgadmin-pgpass`,
  `nagelfluh-backend-secret`, plus a `kubectl apply -f -` heredoc for `nagelfluh-backend-config`.
- Step 6b: `kubectl create secret ... nagelfluh-admin-secret` (skip-if-exists).
- Step 6c: `kubectl create secret docker-registry nagelfluh-app-pull` + `kubectl apply -f
  k8s/rbac/app-deploy-rbac.yaml`. The pull secret duplicates what `apply_app_workloads()`'s own
  `_apply_image_pull_secret()` already creates when `deploy_app()` is called directly (see Design
  decision 1) — it only exists today because the in-cluster deploy Job needs a pull secret to pull
  its *own* image before it can run at all.
- Step 8: a 30-iteration polling loop (`kubectl get secret headlamp-static-token -n headlamp`)
  copying the Headlamp SA token into the `nagelfluh` namespace.
- Step 9: `kubectl apply -f -` of the `nagelfluh-deploy-app` batch `Job` manifest itself, then a
  hand-rolled poll loop (`kubectl get job ... -o jsonpath=...`) for Complete/Failed, `kubectl logs`,
  `kubectl delete job`. This Job runs *inside* whatever cluster `kubectl` is pointed at (not
  necessarily the resolved `CLUSTER_TYPE` cluster!) and, once running, uses its own in-cluster
  ServiceAccount token to reach... whichever cluster the resolved `ClusterProvider.connect()`
  points it at (GKE, via the stored SA key) — i.e. **the Job's own existence is bootstrapped
  against the wrong cluster even though its *contents* correctly target the right one.**

**`docker/build.sh`** (`DEPLOYMENT=production` branch, Step 10 of `runall-production.sh`):
- `kubectl exec -n nagelfluh deploy/backend -- python backend/bin/nagelfluh-build-and-push
  --resolve-only` — reaches into the backend pod (on whatever cluster `kubectl` points at) purely
  to read `REGISTRY_PROTOCOL`/`REGISTRY_CONFIG_JSON`, which are already sitting in this same
  shell's own environment (exported by Step 3's bootstrap-provision) — `nagelfluh-deploy-app`
  already resolves the identical thing host-side without any `kubectl exec`.
- The `db-update-${ENV_TAG}` Job: `kubectl create configmap`/`kubectl delete job`/`kubectl apply
  -f -`/`kubectl wait`/`kubectl logs`/`kubectl delete job`, all against the ambient context. The Job
  manifest itself hardcodes `image: nagelfluh-backend:prod` with `imagePullPolicy: Never` (would
  only ever work if that exact tag already sits in whatever local daemon the target node uses —
  false for GKE, whose nodes never see the operator's Docker daemon) and a **third**, independently
  hardcoded `DATABASE_URL` literal (`postgresql://nagelfluh:nagelfluhpass@postgres.nagelfluh.svc.cluster.local:5432/nagelfluh`)
  duplicating what's already resolved once in `runall-production.sh` Step 6 and again inside
  `apply_app_workloads()`'s migration Job.

**`backup.sh` / `restore.sh` / `debug-harness/run_debug.sh`** — found while researching this plan,
not previously flagged anywhere: all three are pure `kubectl` shell scripts with **zero** cluster
resolution at all (no `CLUSTER_TYPE`/`CLUSTER_CONFIG_JSON` reference of any kind), so every
`kubectl` call in them silently targets whatever the operator's `~/.kube/config` current-context
happens to be — the exact same bug class as Step 4-9 of `runall-production.sh`, just never
touched by `generic-deployment-orchestration.md` because those scripts predate the multi-cluster
work entirely:
- `backup.sh` / `restore.sh`: `kubectl scale statefulset/postgres`/`deployment/minio`/
  `deployment/backend`, `kubectl apply -f -` (a `busybox` helper Pod), `kubectl wait`,
  `kubectl exec ... tar czf/xzf` (streaming a PVC's contents over stdout/stdin), `kubectl delete
  pod`, `kubectl get secrets -o json` for the secrets dump/restore.
- `debug-harness/run_debug.sh`: `kubectl create configmap --dry-run=client -o yaml | kubectl
  apply`, `kubectl apply -f -` (a debug Pod), `kubectl wait`, an **interactive**
  `kubectl exec -it ... -- python /app/debug_runner.py` (TTY passthrough), `kubectl delete
  pod`/`configmap` on exit.

None of these operations have a natural `kubernetes_asyncio` equivalent worth building (streaming
`tar` over a pod's stdin/stdout, and especially an interactive TTY session, are exactly what
`kubectl exec` is for) — so unlike `runall-production.sh`/`docker/build.sh`, the fix here is not
"delete kubectl", it's "kubectl must never guess the context; the resolved `ClusterProvider` must
hand it one explicitly" (Design decision 5).

### Not addressed by this plan (flagged so reviewers don't expect it)

- Whether Postgres/pgAdmin/Headlamp become a genuinely pluggable axis (see Goal). Stays a static,
  unconditionally-applied set of manifests — this plan only fixes *which cluster* they land on.
- `dev/runall.sh`'s own `kubectl apply -f k8s/00-namespaces.yaml` — dev mode never calls
  `deploy_app()`/`expose_app()` at all (backend/frontend run on the host), so it always targets
  whatever cluster is configured for job execution, which is the one thing dev mode's `kubectl`
  context is already guaranteed to be pointed at (there's no separate "app cluster" concept in dev).
  Not a bug; out of scope.
- Teardown for Postgres/pgAdmin/Headlamp — nothing tears these down today (locally or remotely);
  stays that way. Flagged as a possible future extension of `ClusterProvider.teardown()`, not
  designed here.

## Design decisions — proposed, need your sign-off before implementation

### 1. Eliminate the in-cluster `nagelfluh-deploy-app` Job. Run the entire K8s-side deploy as one host-side Python entry point instead.

**Recommended.** Today's Job exists so `same-as-backend`'s `K8sClient(kubeconfig=None)` can use
`load_incluster_config()`. But `K8sClient._ensure_initialized()` already falls back to
`load_kube_config()` (the operator's local kubeconfig) when *not* running in-cluster — i.e.
`same-as-backend`/`minikube` work identically whether this code runs host-side or in-a-pod, because
the operator already has kubectl pointed at Minikube locally (that's how today's shell script's own
raw `kubectl` calls work in the first place). And `GkeClusterProvider.connect()` never used
in-cluster auto-detection anyway — it always builds a client from the stored SA key, reachable from
anywhere with network access, including the operator's own machine. **Nothing about this
architecture actually needs an in-cluster Job** — it's a carried-over assumption from when
`same-as-backend` was the only provider that mattered.

Running host-side, in one Python process (mirroring `nagelfluh-bootstrap-provision`'s own already-
established rationale, quoted above) means:
- `provider.connect(cluster_config, namespace)` builds a `k8s_client` that talks to the **correct**
  cluster (GKE) unconditionally — no dependence on the operator's ambient kubectl context.
- No bootstrapping chicken-and-egg: nothing needs its own pull secret to start, because nothing
  needs to be pulled and scheduled just to *begin* orchestrating.
- `k8s/rbac/app-deploy-rbac.yaml` and Step 6c's `nagelfluh-app-pull` secret pre-creation both become
  unnecessary — `apply_app_workloads()` already creates the pull secret itself when
  `image_pull_credentials` is passed to `deploy_app()` directly.
- The hand-rolled Complete/Failed poll loop, `kubectl logs`, `kubectl delete job` dance (today
  needed because the orchestrator *is* a Job) disappears — errors just raise, visible in the
  script's own stdout/stderr like `nagelfluh-bootstrap-provision` already behaves.

**Alternative (not recommended)**: keep an in-cluster orchestrator Job, but make *launching* it
provider-driven too (e.g. `ClusterProvider.run_deploy_job()`). This still needs *something* to
create that first Job somehow — for `same-as-backend` that's trivially `kubectl`/local API, for
`gke` it's `k8s_client.create_job()` same as anything else — so it doesn't actually simplify
anything over Design decision 1, it just keeps an extra layer of indirection (Job → Python, instead
of Python directly) with no clear benefit. Listed for completeness, not recommended.

### 2. New shared helper `backend/services/base_infrastructure.py`, `apply_base_infrastructure()` — mirrors `apply_app_workloads()`'s shape exactly

Applies, via `kubernetes_asyncio` against a passed-in `k8s_client` (never `kubectl`):
namespaces (`nagelfluh`, `nagelfluh-jobs`, `headlamp`), the Postgres `StatefulSet`/`Service`/
`PersistentVolume(Claim)`, pgAdmin (`Deployment`/`Service`/`ConfigMap`), Headlamp
(`Deployment`/`Service`/RBAC/token `Secret` — including the wait-then-copy logic Step 8 does today,
rewritten as an async poll against `k8s_client.core_api.read_namespaced_secret` instead of shelling
to `kubectl get secret` in a bash loop), and the base Secrets (`nagelfluh-postgres-secret`,
`pgadmin-pgpass`, `nagelfluh-admin-secret` — skip-if-exists, matching today's behavior exactly).
Idempotent (create-or-patch), same discipline as `apply_app_workloads()`/`ensure_cluster_job_ready()`.

`k8s/postgres/`, `k8s/storage/`, `k8s/pgadmin/`, `k8s/headlamp/`, `k8s/00-namespaces.yaml` stay as
the *source of truth* for what gets applied (read and translated into `kubernetes_asyncio` object
calls, the same relationship `apply_app_workloads()` already has to what were formerly
`k8s/backend/`, `k8s/frontend/` manifests) — not deleted, since they're useful references/manual
fallback (mirroring the precedent `generic-deployment-orchestration.md` already set for
`k8s/backend/deployment.yaml` being kept as a "MANUAL / OPT-OUT PATH ONLY" reference).

`k8s/rbac/backend-jobs-rbac.yaml` and its application step are deleted outright (redundant with
`ensure_cluster_job_ready()`, see Background). `k8s/rbac/app-deploy-rbac.yaml` is deleted outright
if Design decision 1 is accepted (nothing left that needs it).

### 3. New optional `ClusterProvider` hook: `resolve_app_hostname()`, called *before* building `app_config`/the ConfigMap

Needed so `BACKEND_BASE_URL` can be computed correctly on the very first deploy for a provider like
`gke` whose externally-reachable hostname isn't known until a resource (a static IP) is reserved —
today that reservation only happens inside `expose_app()`, which runs *after* the ConfigMap
containing `BACKEND_BASE_URL` was already built and applied. This is genuinely a GKE-specific
problem (`same-as-backend`/`minikube`'s NodePort hostname is knowable upfront, no reservation
needed) — the concrete fix belongs in `plugins/ymerflow-gcp/docs/plans/` (see the companion plan),
but the *hook* it needs is a host-repo change, so it's proposed here:

```python
async def resolve_app_hostname(self, provider_config: dict, app_config: dict) -> str | None:
    """Optional, cheap, idempotent. Called BEFORE apply_base_infrastructure()/deploy_app(), so its
    result can be baked into app_config["SERVER_URL"] before the ConfigMap is built. Default:
    return app_config.get("SERVER_URL") unchanged (every provider whose hostname doesn't need a
    reservation step — same-as-backend/minikube — never needs to override this)."""
    return app_config.get("SERVER_URL")
```

The new host-side orchestration entry point (Design decision 1) calls this first, merges the result
into `app_config["SERVER_URL"]`/derives `BACKEND_BASE_URL` from it, *then* calls
`apply_base_infrastructure()` and `deploy_app()`. `expose_app()` keeps doing what it does today
(idempotent — reusing whatever `resolve_app_hostname()` already reserved).

### 4. `docker/build.sh`'s production-mode schema-update step becomes provider-driven too

- Drop the `kubectl exec ... --resolve-only` — resolve `REGISTRY_PROTOCOL`/`REGISTRY_CONFIG_JSON`
  straight from the shell's own environment (exactly like `nagelfluh-deploy-app` already does).
- Replace the hand-rolled `db-update-${ENV_TAG}` Job (hardcoded image, hardcoded `imagePullPolicy:
  Never`, hardcoded `DATABASE_URL`) with a small helper (e.g.
  `backend/services/base_infrastructure.py`'s `run_schema_update_job()`, same shape as
  `apply_app_workloads()`'s `_run_migration_job()`) that creates the Job via the resolved
  `ClusterProvider`'s `k8s_client`, uses the **already-resolved backend image ref** (from the same
  `nagelfluh-build-and-push` call this script already makes) with real `imagePullSecrets`, and gets
  `DATABASE_URL` via `envFrom` against the existing `nagelfluh-backend-config`/`-secret` — no
  hardcoded connection string anywhere.

### 5. New `ClusterProvider` hook: `materialize_kubeconfig()` — the *only* channel through which a pure-`kubectl` shell script may reach a cluster

```python
def materialize_kubeconfig(self, provider_config: dict) -> dict:
    """Return a kubeconfig-shaped dict — the exact shape connect()'s own `kubeconfig` argument
    already accepts (K8sClient loads it via `config.load_kube_config_from_dict`) — for use by
    external tools that only speak kubectl's config format (backup.sh, restore.sh,
    debug-harness/run_debug.sh: their kubectl exec-based tar-streaming and interactive-TTY
    plumbing has no good kubernetes_asyncio equivalent worth building). MUST NOT shell out to a
    vendor CLI (gcloud, minikube) to build this — construct the credential directly via the
    provider's own Python SDK/HTTP calls (e.g. minting a short-lived bearer token from a stored
    GCP service-account key via `google-auth`, embedded straight into the returned dict's
    `users[].user.token`). No default implementation — every provider that wants to support the
    shell-script backup/restore/debug path must implement this explicitly; a provider that
    doesn't (raises NotImplementedError) simply means those scripts can't target that cluster
    type yet, a loud and correct failure rather than a silent wrong-cluster one."""
    raise NotImplementedError
```

- `KubeconfigClusterProvider.materialize_kubeconfig()`: trivial, `return provider_config["kubeconfig"]` — it already *is* one.
- `SameAsBackendClusterProvider.materialize_kubeconfig()`: reads the same local kubeconfig
  `load_kube_config()` would auto-detect (via `kubernetes_asyncio.config.kube_config`'s own dict-
  loading path) or, if running in-cluster, constructs a kubeconfig dict from the mounted
  ServiceAccount token + CA cert at `/var/run/secrets/kubernetes.io/serviceaccount/`. This is
  *not* "falling back to ambient" in the sense this plan forbids — for this provider type,
  "whatever this process's own cluster is" is the correct, resolved answer by definition; the
  point is that a script gets there by *asking the provider*, not by assuming it.
- `GkeClusterProvider.materialize_kubeconfig()` (plugin-side, companion plan): builds a kubeconfig
  dict embedding a short-lived OAuth bearer token minted from the stored SA key via `google-auth`
  — no `gcloud` CLI involved.

New host-side entry point `backend/bin/nagelfluh-materialize-kubeconfig`: resolves the active
`Cluster` row exactly the way `nagelfluh-bootstrap-provision`/`nagelfluh-deploy-app` already do,
calls `provider.materialize_kubeconfig(cluster.provider_config)`, dumps the result as kubeconfig
YAML to stdout. `backup.sh`/`restore.sh`/`debug-harness/run_debug.sh` each start with:

```bash
KUBECONFIG_FILE="$(mktemp)"
trap 'rm -f "$KUBECONFIG_FILE"' EXIT
env/bin/nagelfluh-materialize-kubeconfig > "$KUBECONFIG_FILE"
export KUBECONFIG="$KUBECONFIG_FILE"
```

— every subsequent `kubectl` call in the script now targets the resolved cluster explicitly, and
the operator's own `~/.kube/config` is never read or depended on (except indirectly, for
`same-as-backend`, where the provider itself chooses to read it — a resolved decision, not a
fallback).

## Open items to confirm at implementation time

- Exact name/location of the new host-side entry point replacing Step 9's Job-launch — extend
  `backend/bin/nagelfluh-deploy-app` in place (it already does the `deploy_app()`/`expose_app()`
  half) vs. a new `backend/bin/nagelfluh-deploy-production` that calls into it. Leaning towards
  extending `nagelfluh-deploy-app` itself, since its docstring's "runs as an in-cluster Job" framing
  is exactly what Design decision 1 removes — but confirm once Phase 1 is scoped.
- Whether the base-infrastructure Secrets keep their exact current values/behavior (e.g.
  `nagelfluh-admin-secret`'s skip-if-exists semantics, `MINIO_ROOT_USER`/`PASSWORD` defaults) or get
  cleaned up further while being ported — default to byte-identical behavior, don't sneak in
  unrelated changes.
- Whether `apply_base_infrastructure()` also gains its own `teardown()`-style counterpart now or
  later — see "Not addressed by this plan."

**Resolved (was an open item, settled by Design decision 5):** the script's closing print-out
(`kubectl logs -f deployment/backend -n nagelfluh`, etc.) stays as plain, provider-agnostic
`kubectl` commands — no `gcloud`/vendor-specific text is ever printed — prefixed with the same
`nagelfluh-materialize-kubeconfig` invocation the shell scripts use, e.g.:
```
To inspect the deployment:
  eval "$(env/bin/nagelfluh-materialize-kubeconfig --export)"
  kubectl logs -f deployment/backend -n nagelfluh
```
(`--export` flag: prints `export KUBECONFIG=<tmpfile>` instead of raw YAML, for eval'ing directly
into the operator's shell.) This keeps the hint text identical for every provider — the provider
only ever affects what `materialize_kubeconfig()` returns, never what the host script prints.

## Phases

### Phase 1 — `base_infrastructure.py`: namespaces, Postgres, RBAC cleanup
- New module, `apply_base_infrastructure()` covering namespaces/Postgres/PV/PVC only, ported
  verbatim in behavior from `k8s/00-namespaces.yaml`/`k8s/postgres/`/`k8s/storage/`.
- Delete `k8s/rbac/backend-jobs-rbac.yaml` and its application step (redundant, see Background).
- Fix `app_deployment.py`'s stale module docstring (MinIO/registry claim).

### Phase 2 — pgAdmin, Headlamp, base Secrets
- Extend `apply_base_infrastructure()`: pgAdmin, Headlamp (+ token-copy poll, rewritten async),
  `nagelfluh-postgres-secret`, `pgadmin-pgpass`, `nagelfluh-admin-secret`.

### Phase 3 — `resolve_app_hostname()` hook
- Add to `ClusterProvider` ABC with the no-op default shown above. `same-as-backend`/`minikube`
  need no change (inherit the default). GKE-side implementation is the companion plugin plan.

### Phase 4 — host-side orchestration entry point (Design decision 1)
- Resolve entry point name/shape per Open items.
- Sequence: bootstrap-provision (unchanged, Step 3) → `provider.connect()` →
  `resolve_app_hostname()` → `apply_base_infrastructure()` → resolve registry/images →
  `deploy_app()` → `expose_app()` → print result.
- Delete `k8s/rbac/app-deploy-rbac.yaml`.
- `prod/runall-production.sh` Steps 4, 6, 6b, 6c, 7, 8, 9 collapse into one call to this entry
  point; Steps 2 (host docker build), 3 (bootstrap-provision), 5 (build+push), 10 (runner image +
  schema update, Phase 5) are untouched except where Phase 5 changes Step 10 specifically.

### Phase 5 — `docker/build.sh` production-mode cleanup
- Drop the `kubectl exec --resolve-only` (Design decision 4).
- `run_schema_update_job()` helper, replacing the hand-rolled Job heredoc.

### Phase 6 — `backup.sh` / `restore.sh` / `debug-harness/run_debug.sh`: explicit kubeconfig, never ambient
- Add `materialize_kubeconfig()` to the `ClusterProvider` ABC (Design decision 5); implement on
  `SameAsBackendClusterProvider`/`KubeconfigClusterProvider` (host repo). `minikube`/`gke`
  implementations are each provider's own plugin's concern (companion plans).
- New `backend/bin/nagelfluh-materialize-kubeconfig` entry point (plain YAML to stdout, or
  `export KUBECONFIG=...` with `--export`).
- Update all three scripts to resolve+export `KUBECONFIG` via the new entry point before their
  first `kubectl` call, per the snippet in Design decision 5. No other logic in these scripts
  changes — same Pod manifests, same `tar`/`exec`/`scale` sequencing, only the auth/context
  resolution moves from implicit-ambient to explicit-resolved.

## Manual verification

- Local Minikube (`CLUSTER_TYPE=minikube`, unchanged from today): `./runall.sh` end-to-end reaches
  the same observable state as before this plan — app reachable at `SERVER_URL`, admin login works,
  pgAdmin/Headlamp reachable, process Jobs still run. Confirms the host-side rewrite is behaviorally
  identical for the existing supported path, not just theoretically cleaner.
- GKE (`CLUSTER_TYPE=gke`, this repo's actual motivating case): `./runall.sh` end-to-end with **no
  local kubectl context pointed at the GKE cluster beforehand** — confirms the whole flow no longer
  depends on the operator's ambient kubectl state at all. Backend pod successfully reaches Postgres
  (same cluster now). pgAdmin/Headlamp reachable at whatever `expose_app()` returns.
- `backup.sh`/`restore.sh`/`debug-harness/run_debug.sh` against `CLUSTER_TYPE=gke` with **no local
  kubectl context pointed at the GKE cluster beforehand** — confirms `materialize_kubeconfig()`
  is doing the actual work, not the operator's pre-existing setup papering over a gap.
- `grep -rn kubectl prod/runall-production.sh docker/build.sh` returns only the closing `echo`
  lines from Design decision 5's resolution (`eval "$(... nagelfluh-materialize-kubeconfig
  --export)"` / `kubectl logs -f ...` as copy-paste text for the operator) — zero matches that are
  an actual subprocess invocation. Confirm by inspection, not just count: every remaining hit must
  be inside an `echo`/`printf` string, never a bare `kubectl ...` statement.
- `grep -rn kubectl backup.sh restore.sh debug-harness/run_debug.sh` returns only invocations that
  run after `KUBECONFIG` has been set from `nagelfluh-materialize-kubeconfig`'s output — never a
  bare `kubectl` call preceding that export.
- `grep -rln 'gcloud\|minikube' -- $(git ls-files | grep -v '^plugins/')` returns nothing — no
  vendor-specific CLI name appears anywhere outside a plugin directory.
- Re-running the whole flow twice in a row against an already-deployed GKE cluster is a clean no-op
  modulo intentional redeploys (idempotency parity with `apply_app_workloads()`/
  `ensure_cluster_job_ready()`).
