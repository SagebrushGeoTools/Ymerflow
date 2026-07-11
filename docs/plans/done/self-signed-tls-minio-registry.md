# MinIO & registry: credentials + self-signed TLS (prerequisite for LAN exposure)

## Goal & scope

Give MinIO (`9000`/`9001`) and the docker registry (`30500`) both **authentication** (username /
password from `config.env`) and **self-signed TLS encryption** (Level A: encrypt + skip-verify), so
that neither is ever anonymous or cleartext once it is reachable off-host.

**This plan is a hard prerequisite of `docs/plans/expose-nodeports-on-host.md`** and must be
implemented and merged **first**. Ordering it before the exposure work is exactly what lets that plan
bind `0.0.0.0` safely (its decision 4): by the time these services are published on the LAN /
host interfaces, auth-over-TLS is already enforced.

Two layers with different blast radius:
- **Credentials (Phases 1–2)** — script + config only; the backend already has the consuming
  settings (`minio_root_user/password`, `registry_auth`).
- **TLS (Phases 3–5)** — needs backend code: there is **no TLS-verify/CA plumbing today** (see below).

TLS here is **Level A — encrypt, skip server-identity verification** (`https://` everywhere, clients
use `verify=False` / `--insecure` / `CERT_NONE`). This suits arch 2's trusted physical LAN: encryption
against passive sniffing without generating multi-SAN certs or distributing a CA. It is MITM-able;
Level B (real CA trust) is recorded as rejected-for-now at the bottom. Arch 1 (public CA / Let's
Encrypt) would use real certs for anything genuinely public rather than this self-signed path.

## Phase 1 — MinIO credentials from `config.env`

Replace hardcoded `minioadmin/minioadmin` with `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` from
`config.env`, **defaulting to `minioadmin`** so a redeploy on an existing install is a no-op.

- `config.env.example`: add `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` (default `minioadmin`; note the
  rotation caveat below and that public-interface hosts should change them).
- `dev/setup-minio.sh`: use `${MINIO_ROOT_USER:-minioadmin}` / `${MINIO_ROOT_PASSWORD:-minioadmin}`
  in the Deployment env, the `mc alias set`, the `test-minio.py` invocation, and the closing echoes.
- `prod/runall-minikube.sh`: same vars in `MINIO_ROOT_PASSWORD` (backend secret), the `MC_HOST_minio`
  URL, and `MINIO_ROOT_USER` (ConfigMap).
- Backend visibility: `backend/config.py` already reads these from env; ensure the dev backend
  process inherits them (dev/runall.sh sources `config.env` with `set -a`). Prod delivers them via
  the existing secret/ConfigMap `envFrom`.

**Rotation caveat (two credentials, one account).** The MinIO *server root* account and the **default
StorageBackend row**'s `config.admin_access_key/admin_secret_key` are the same account; that row is
seeded **once** from `settings.minio_root_user/password` by migration `182d880e84c7`.
- **Redeploy with defaults** = no-op (server + seeded row already hold `minioadmin`). ✅
- **Fresh DB** = config.env values seed both automatically. ✅
- **Changing the creds on an existing install** requires **also updating the default StorageBackend
  row** via the Admin > Storage panel — else the server moves but the stored backend creds go stale
  and provisioning breaks. Document in `config.env.example`; no reconcile code.

## Phase 2 — Registry username/password from `config.env`

The registry is **anonymous today** (no `auth:` block in `dev/setup-registry.sh`). Add HTTP basic
auth from `config.env`. The backend already injects `settings.registry_auth` (base64 `user:password`)
into job pods as `REGISTRY_AUTH` for in-pod plugin builds (`job_orchestrator.py:50-51`) — it's just
never populated. So this layer is **script + config only**.

- `config.env.example`: add `REGISTRY_USER` / `REGISTRY_PASSWORD` (turnkey defaults like MinIO).
- `dev/setup-registry.sh`:
  - Generate a **bcrypt** htpasswd (registry v2 rejects the `-apr1`/MD5 form prod uses for nginx):
    `htpasswd -Bbn "$REGISTRY_USER" "$REGISTRY_PASSWORD"` (apache2-utils) or a `passlib`/`bcrypt`
    Python one-liner if `htpasswd` isn't guaranteed present. Store it in a k8s Secret.
  - Add `auth: htpasswd: { realm: ..., path: /auth/htpasswd }` to the registry `config.yml` ConfigMap
    and mount the Secret at that path.
  - Update the readiness `curl ${REGISTRY_URL}/v2/` check to send `-u "$REGISTRY_USER:$REGISTRY_PASSWORD"`.
- `docker/build.sh`: `docker login "${REGISTRY_URL}" -u "$REGISTRY_USER" -p "$REGISTRY_PASSWORD"`
  before `docker push` (runs in the `minikube docker-env` daemon).
- Backend `settings.registry_auth`: deliver `REGISTRY_AUTH=$(printf '%s:%s' "$REGISTRY_USER"
  "$REGISTRY_PASSWORD" | base64 -w0)` — **prod** via `nagelfluh-backend-secret`; **dev** via
  `config.env`. Flows to plugin-build pods automatically.

**Out of scope — cross-cluster image *pull* auth.** Single-cluster pods pull the runner image
`IfNotPresent` from minikube's local daemon (`job_orchestrator.py:159-160`), so they need no registry
login. A *second* machine's pods pulling **from** this registry would need a `docker-registry`
imagePullSecret in the pod spec (a `job_orchestrator.py` change) plus `--insecure-registry`/CA on that
node — that belongs to the multi-cluster job-dispatch work.

## Why TLS is not scripts-only

No TLS-verify/CA plumbing exists today (confirmed by reading the code):
- `backend/services/storage_service.py::get_fsspec_storage_options()` returns only
  `client_kwargs={"endpoint_url": ...}` + key/secret — no `verify`.
- `docker/base-runner/runner.py::get_storage_kwargs()` sets only `client_kwargs={"endpoint_url": ...}`.
- `backend/services/minio_service.py::get_minio_client_for_backend()` does `Minio(..., secure=scheme
  == "https")` with no `http_client`/CA control; `_run_mc` has no `--insecure`/CA flag.
- `backend/services/job_orchestrator.py` injects `STORAGE_ENDPOINT` into pods but no TLS config.

## Phase 3 — enable TLS on the servers

- **MinIO** (`dev/setup-minio.sh`): generate a self-signed cert (`openssl req -x509 -newkey ...`; SANs
  don't matter for Level A since nobody verifies) and mount it into the pod at
  `/root/.minio/certs/{public.crt,private.key}` via a k8s Secret — MinIO auto-serves HTTPS on
  9000/9001 when present. Persist the cert (e.g. under `NAGELFLUH_DATA_DIR`) so it survives
  `minikube delete`.
- **Registry** (`dev/setup-registry.sh`): add `http.tls.certificate`/`http.tls.key` to the registry
  `config.yml` ConfigMap and mount a self-signed cert Secret. The node daemon already runs with
  `--insecure-registry` (`dev/setup-minikube.sh`), which permits unverified HTTPS, so pulls/pushes
  keep working. Any *other* machine's docker/containerd pulling from it must also add
  `--insecure-registry <host>:30500`.

## Phase 4 — point clients at https + skip verify

Add `storage_tls_skip_verify: bool = False` to `backend/config.py`; when the endpoint is `https://`
and this is set, disable cert verification everywhere:
- `storage_service.py::get_fsspec_storage_options()`: add `client_kwargs["verify"] = False`.
- `minio_service.py::get_minio_client_for_backend()`: pass `http_client=urllib3.PoolManager(cert_reqs=
  "CERT_NONE")` (and silence InsecureRequestWarning); add `--insecure` to `_run_mc`.
- `job_orchestrator.py`: inject `STORAGE_TLS_SKIP_VERIFY` into pod env.
- `runner.py::get_storage_kwargs()`: add `client_kwargs["verify"] = False` (both the plain-dict and
  `RefreshableStorageKwargs` paths).
- Endpoints move to `https://` (the `STORAGE_ENDPOINT` ConfigMap and the default StorageBackend
  `config.endpoint`).

## Phase 5 — config + docs

- `config.env.example`: document `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`, `REGISTRY_USER`/
  `REGISTRY_PASSWORD`, and `STORAGE_TLS_SKIP_VERIFY`; note that enabling TLS means switching the MinIO
  endpoint (and default StorageBackend `config.endpoint`) to `https://`, and the trusted-LAN caveat
  (Level A gives no server-identity auth).

## Manual verification

- MinIO serves HTTPS: `curl -k https://<host>:9000/minio/health/live` → 200; plain `http://` fails.
  `mc ls` with the configured creds + `--insecure` works; wrong creds are rejected.
- Registry serves HTTPS with auth: `curl -k -u "$REGISTRY_USER:$REGISTRY_PASSWORD"
  https://<host>:30500/v2/` → `{}`; the same without `-u` is `401`.
- End-to-end: `docker/build.sh` logs in + pushes; a process runs (pod pulls the runner image and
  reads/writes datasets over `https://` with skip-verify).
- Backend provisioning still works against `https://` MinIO (create a project → bucket + user made).
- From the other LAN machine: `curl -k https://<lan-ip>:9000` and a docker pull with
  `--insecure-registry` both succeed.

## Rejected for now: Level B (real CA trust)

Recorded so the tradeoff isn't re-litigated. Level B = a CA + server certs whose SANs cover **every**
name each client uses, plus CA distribution to every trust store:
- MinIO SANs: `minio.minio.svc.cluster.local`, `minio-nagelfluh.nagelfluh-jobs.svc.cluster.local`,
  `localhost`, `127.0.0.1`, each LAN IP. Registry SANs: `registry.registry.svc.cluster.local`,
  `192.168.49.2`, LAN IP, `localhost`.
- Distribute the CA to: backend (fsspec `verify=<ca>`, MinIO SDK http_client CA, `~/.mc/certs/CAs/`),
  job pods (mount a CA Secret + a `STORAGE_CA_CERT` env consumed by `runner.get_storage_kwargs`), the
  node docker daemon (`/etc/docker/certs.d/<host>:<port>/ca.crt`), and every other machine.
- Also required if the **browser** ever hits MinIO directly (presigned URLs) — self-signed without a
  trusted CA gives unavoidable browser warnings. Confirm whether any direct-to-MinIO browser path
  exists before Level B is needed for browser flows.
MITM-resistant but much more work; revisit if the LAN stops being trusted.
