# Postgres PersistentVolume becomes cluster-provider-owned (finish the `k8s/storage/` migration)

## Goal

Make the Postgres PersistentVolume that backs `data-postgres-0` be supplied by the **cluster
provider** for the active `CLUSTER_TYPE`, instead of a single host static manifest that only
describes a Minikube-style `hostPath` volume. This fixes a real, deploy-breaking bug on GKE and
completes a migration the codebase already started for MinIO.

## Background — current state

`prod/runall-production.sh` Step 7 applies, generically and with no cluster-type awareness:

- `k8s/postgres/statefulset.yaml` — the `postgres` StatefulSet. Its `volumeClaimTemplates` entry is
  named `data`, so it generates a PVC `data-postgres-0` in the `nagelfluh` namespace. The template
  sets **no** `storageClassName`.
- `k8s/storage/persistent-volumes.yaml` — a `hostPath` PersistentVolume `nagelfluh-postgres`
  (`storageClassName: ""`, `hostPath: /mnt/nagelfluh-data/postgres`, `Retain`).
- `k8s/storage/persistent-volume-claims.yaml` — an explicit PVC `data-postgres-0`
  (`storageClassName: ""`, `volumeName: nagelfluh-postgres`).

`k8s/storage/persistent-volumes.yaml` already carries the comment:

> The MinIO PV moved into plugins/ymerflow-minikube's own MinioProtocolHandler.bootstrap() … —
> Postgres is the only thing left here

i.e. MinIO's PV was already migrated out of the host into the plugin that owns that cluster/storage
type (`plugins/ymerflow-minikube`, applied via `apply_persistent_volume` in that plugin's
`bootstrap()`). Postgres is the last straggler.

### The bug on GKE

On GKE the `hostPath` PV is both wrong and actively harmful:

1. `hostPath` is node-local on a multi-node, node-disposable cluster — autorepair/upgrade/scale
   replaces nodes and the StatefulSet pod can reschedule to a different node, so Postgres data is
   ephemeral.
2. The StatefulSet's `volumeClaimTemplate` (no `storageClassName`) makes the controller create
   `data-postgres-0` against GKE's default StorageClass `standard-rwo`, dynamically provisioning a
   PD. When Step 7 then applies the explicit `data-postgres-0` PVC with `storageClassName: ""`,
   kubectl tries to mutate the already-created PVC's storage class → **`spec is immutable after
   creation`**, the exact error that blocks the deploy at Step 7.

The **hard, non-negotiable rule** from
`docs/plans/done/base-infrastructure-via-cluster-provider.md` governs the fix: no host-repo shell
script may invoke a vendor CLI (`gcloud`, `minikube`, …) or `kubectl` against an ambient context —
"the plugin is the only thing that ever knows how to reach or authenticate to a given cluster
type." Therefore the GCE-disk creation and the cluster-specific PV shape **must** live in the
plugin, never in `prod/runall-production.sh`, and the host must not gain a `CLUSTER_TYPE` branch.

### Not touched by this plan

- pgAdmin / Headlamp manifests, the Postgres StatefulSet's non-storage spec, the base
  Secrets/ConfigMaps, and every other Step 7 manifest.
- Postgres remaining a single, non-pluggable database (no DB-backend axis) — only *where its PV
  comes from* changes.

## Design decisions

1. **The Postgres PV is cluster-provider-owned, applied in `ClusterProvider.bootstrap()`.** Each
   provider creates a cluster-scoped PV named `nagelfluh-postgres` sized 5Gi, `Retain`,
   `storageClassName: ""`, with `claimRef: {namespace: nagelfluh, name: data-postgres-0}` so it
   pre-binds to the StatefulSet's generated PVC regardless of apply ordering. This mirrors the
   established MinIO precedent (`MinioProtocolHandler.bootstrap()` → `apply_persistent_volume`).
   `bootstrap()` runs at Step 3, before Step 7 applies the StatefulSet, so the PV always exists
   first.

2. **The PV stays a YAML file — it relocates into the plugin packages, it is not rewritten in
   Python.** YAML is the better documentation, and the "plugin owns it" rule only requires that the
   *plugin* apply it (via its own k8s client/REST), not that it stop being a manifest. So each
   provider ships a `postgres-pv.yaml` as package data and, in `bootstrap()`, `yaml.safe_load`s it
   and applies it. `k8s/storage/persistent-volumes.yaml`'s content moves into
   `plugins/ymerflow-minikube` (hostPath) and a new GKE equivalent in `plugins/ymerflow-gcp` (CSI);
   the file just changes owner. `k8s/storage/persistent-volume-claims.yaml` is the only thing truly
   **deleted**: with a pre-bound (`claimRef`) PV plus `storageClassName: ""` on the StatefulSet's
   `volumeClaimTemplate` (decision 3), the StatefulSet's own generated `data-postgres-0` binds to
   the provider's PV, so the explicit PVC manifest is redundant. Step 7's `kubectl apply` list drops
   the `k8s/storage` entry, and `k8s/storage/` is removed from the host repo. No `CLUSTER_TYPE`
   check is added anywhere in the host.

   (This intentionally differs from how `MinioProtocolHandler.bootstrap()` hand-builds its PV as a
   `client.V1PersistentVolume(...)` Python object — the YAML-file form is preferred for the
   documentation value; MinIO is not being reworked here.)

3. **`k8s/postgres/statefulset.yaml` gains `storageClassName: ""` on its `volumeClaimTemplate`.**
   This is the single generic (cluster-agnostic) manifest change: it stops the controller from
   ever dynamic-provisioning against a default StorageClass and forces binding to the static,
   pre-`claimRef`'d PV. Works identically on Minikube (hostPath PV) and GKE (CSI PV).

4. **Minikube: `MinikubeClusterProvider.bootstrap()` applies a shipped `postgres-pv.yaml`.** The
   hostPath PV YAML (`hostPath: /mnt/nagelfluh-data/postgres`, `Retain`, `storageClassName: ""`,
   `claimRef: {nagelfluh, data-postgres-0}`) ships as package data in `plugins/ymerflow-minikube`;
   `bootstrap()` `yaml.safe_load`s it and applies it via the plugin's existing
   `apply_persistent_volume` helper (which accepts a loaded object). Its `teardown()` deletes that
   PV via `delete_persistent_volume`. Fully static YAML — no runtime substitution.

5. **GKE: `GkeClusterProvider.bootstrap()` creates a GCE PD + applies a shipped CSI `postgres-pv.yaml`.**
   - Create a zonal GCE persistent disk `nagelfluh-postgres` (5Gi) in the cluster's zone
     (`location` from the bootstrap input config, e.g. `europe-west1-b`) via the Compute REST API —
     describe-before-create, tolerate "already exists" — mirroring `gke_app_exposure.py`'s
     `_ensure_static_ip` (`addresses.insert` + `_await_compute_operation`), but against
     `projects/{p}/zones/{zone}/disks` and polling the **zonal** operation.
   - Ship a `postgres-pv.yaml` as package data describing the full CSI PV:
     `csi.driver: pd.csi.storage.gke.io`, `csi.fsType: ext4`,
     `persistentVolumeReclaimPolicy: Retain`, `storageClassName: ""`,
     `claimRef: {nagelfluh, data-postgres-0}`, and `nodeAffinity` on `topology.gke.io/zone`.
     `bootstrap()` `yaml.safe_load`s it and sets only the two runtime-dependent values —
     `csi.volumeHandle` (`projects/{p}/zones/{zone}/disks/nagelfluh-postgres`) and the
     `nodeAffinity` zone value — from `provider_config`, then applies the resulting dict via the
     same raw-k8s-REST admin path `_ensure_cluster_role_binding` already uses (operator ADC
     credential, cluster-admin at bootstrap time). Setting two fields on the loaded dict is
     preferred over string-templating the YAML (no injection/formatting hazard); the file still
     documents the entire structure.
   - Both the disk-ensure and PV-apply are idempotent and run in **both** the full path and the
     `existing_sa_key` self-healing passthrough branch of `bootstrap()` (same treatment the
     role-binding self-heal already gets), so a re-run with a persisted config still guarantees the
     PV exists.

   Both plugins' `setup.py`/`pyproject.toml` must include the new `postgres-pv.yaml` as
   `package_data` so it ships in the installed wheel (the plugins install editable today, but the
   declaration keeps a real wheel build correct).

6. **GKE teardown deletes the PV and the GCE disk.** Add `GkeClusterProvider.teardown()` (currently
   inherits the base no-op) to delete the `nagelfluh-postgres` PV and then the GCE disk. Because the
   disk is `Retain`, nothing else reclaims it; this is what makes "delete all resources and rerun"
   yield a genuinely clean Postgres each cycle. Deletion order: PV first (releases the CSI
   attachment), then the disk; tolerate "already gone" on both.

## Phases

### Phase 1 — generic StatefulSet change
Add `storageClassName: ""` to the `volumeClaimTemplate` in `k8s/postgres/statefulset.yaml`.

### Phase 2 — remove the host storage manifests
Move `k8s/storage/persistent-volumes.yaml`'s hostPath PV into the minikube plugin as
`postgres-pv.yaml` package data (Phase 3), and **delete** `k8s/storage/persistent-volume-claims.yaml`
(redundant per decision 2). Remove the now-empty `k8s/storage/` dir and the
`-f "${PROJECT_ROOT}/k8s/storage"` argument from `prod/runall-production.sh` Step 7's `kubectl apply`.

### Phase 3 — Minikube provider owns the hostPath PV (YAML)
Ship `postgres-pv.yaml` (hostPath, with `claimRef`) as package data in `plugins/ymerflow-minikube`
and declare it in the plugin's `package_data`. `MinikubeClusterProvider.bootstrap()` `yaml.safe_load`s
it and applies via `apply_persistent_volume`; `teardown()` deletes it via `delete_persistent_volume`
(both from `minikube_plugin/k8s_apply.py`).

### Phase 4 — GKE provider owns the GCE PD + CSI PV (YAML)
Ship `postgres-pv.yaml` (CSI shape, with `claimRef` + `nodeAffinity`) as package data in
`plugins/ymerflow-gcp` and declare it in `package_data`. Add `_ensure_postgres_disk()` (Compute REST,
zonal disk, idempotent), and in `GkeClusterProvider.bootstrap()` load the YAML, fill in
`csi.volumeHandle` + the `nodeAffinity` zone from `provider_config`, and apply via the raw-k8s-REST
admin path (both branches, per decision 5). Add `GkeClusterProvider.teardown()` per decision 6.

### Phase 5 — docs
Update the plugin READMEs / any storage doc that references `k8s/storage/` to reflect that the
Postgres PV is now provider-supplied (the same way the MinIO migration was documented).

## Verification

- **GKE, clean:** delete all GKE resources incl. the `nagelfluh-postgres` disk, run `runall.sh`
  (`DEPLOYMENT=production`, `CLUSTER_TYPE=gke`). Confirm: bootstrap creates the disk + PV; Step 7
  applies StatefulSet with no immutable-PVC error; `data-postgres-0` binds to the CSI PV;
  `kubectl rollout status statefulset/postgres` succeeds; the PD is a real CSI disk
  (`kubectl get pv nagelfluh-postgres -o jsonpath='{.spec.csi.driver}'` = `pd.csi.storage.gke.io`).
- **GKE, re-run idempotency:** run `runall.sh` again without teardown; bootstrap's disk/PV ensure is
  a no-op (409/"already exists" tolerated), deploy still succeeds.
- **GKE, data survives pod reschedule:** write a row, delete the postgres pod, confirm the row
  survives (proves durable network-attached PD, not ephemeral node storage).
- **GKE teardown:** run the teardown path; confirm the PV and the GCE disk are both gone.
- **Minikube regression:** run a Minikube `DEPLOYMENT=production` deploy; confirm the hostPath PV is
  now created by the provider's `bootstrap()`, `data-postgres-0` binds to it, and Postgres comes up
  exactly as before.

## Open items to confirm at implementation time

- **Disk zone source.** `location` in the GKE bootstrap input is a zone (`europe-west1-b`) today; if
  a regional cluster (region-only `location`) is ever configured, a zone must be chosen for the
  zonal PD (or a regional PD used). Out of scope unless regional clusters are supported.
- **Reclaim on teardown.** Decision 6 deletes the disk on teardown for clean test cycles. If, later,
  keeping Postgres data across cluster re-creation is wanted, teardown would skip the disk delete and
  bootstrap's describe-before-create would re-attach the retained disk — noted, not implemented here.
