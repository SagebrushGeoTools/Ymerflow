# Minikube cluster registration — fix command-before-Save UX

## Goal & scope

The "Add Cluster" flow for the `minikube` self-service cluster type
(`docs/plans/done/remote-cluster-provisioning-and-registry.md`) currently shows unhelpful
"click Save to get a command" text, then only reveals the copy-paste command *after* Save has
already created a pending `Cluster` row server-side. That's backwards from both the plan's own
stated intent ("on selecting this type, triggers pending-registration creation, then shows the
command") and from what's actually useful: the admin wants the command as soon as they've decided
this is a minikube cluster, wants to see when it's landed, and wants Save to be the last step, not
the first.

Fix the ordering: **select type → get command immediately → run it → see confirmation it landed →
optionally test connection → Save.**

Getting this right also means changing *where* the `Cluster` row gets created. Today
`admin_create_cluster` creates the row (and issues a registration token) as part of the admin's
Save click — i.e. before the command has even been shown. This plan moves both token generation
and row creation out of that path entirely:

- The registration token is generated **client-side**, in the browser, with no backend round-trip
  — so the command can appear the instant "Minikube" is selected, with zero latency and zero
  dependency on the admin having filled in anything else yet.
- The `Cluster` row itself is created **lazily, by the callback endpoint**, the first time it sees
  a token it doesn't already recognize. If the admin never runs the command, no row is ever
  created. If they do, the row appears "pending" (inert, `active=false`) until the admin comes back
  to the still-open dialog, sees it was found, and clicks Save to claim/activate it.

This is a deliberate simplification over the original plan's "backend pre-creates a pending row +
short-lived token at Save time" design. A row that's created but never claimed is cheap and inert
— it does nothing, dispatches nothing, and doesn't need an expiry to bound its lifetime. So token
expiry (`registration_token_expires_at`) is dropped entirely; validity relies purely on the
token's randomness (client-generated, sufficient entropy), same as any bearer credential.

Out of scope: everything else in the original plan (registry addressing, the setup script itself,
Kueue/RBAC provisioning, `same_as_backend`/`kubeconfig` cluster types) is unchanged. This is purely
a reshuffling of *when* the `Cluster` row and its token come into existence, and the corresponding
frontend flow.

## Background — current state

(See `docs/plans/done/remote-cluster-provisioning-and-registry.md` for full prior design/rationale;
summarizing only what this plan changes.)

- **`Cluster` model** (`backend/models/cluster.py:14-38`): `provisioning_status`
  (`pending`/`active`/`failed`, default `active`), `registration_token_hash` (SHA-256 hex,
  nullable), `registration_token_expires_at` (nullable). Comment block documents the current
  create-then-callback lifecycle.
- **`admin_create_cluster`** (`backend/routers/admin.py:98-140`): for
  `provider.self_service_registration` (true only for `minikube`), creates the row up front
  (`active=False`, `provisioning_status="pending"`), generates
  `secrets.token_urlsafe(32)`, stores its hash + expiry (+45 min,
  `REGISTRATION_TOKEN_TTL_MINUTES`), returns `registration_command` from
  `provider.registration_command(token)`.
- **`cluster_register_callback`** (`backend/routers/admin.py:180-238`,
  `POST /admin/clusters/register-callback`): bearer-token-only auth (no admin session, no cluster
  id in the URL — looked up purely by matching `registration_token_hash`). Checks expiry, calls
  `provider.test_connection(payload)`, on success sets `provider_config`, `active=True`,
  `provisioning_status="active"`, **clears `registration_token_hash`/`registration_token_expires_at`
  on both success and failure**.
- **`MinikubeClusterProvider.registration_command(token)`** (`backend/services/cluster_providers/minikube.py`):
  builds `curl -fsSL {backend_base_url}/static/assets/setup-minikube-remote.sh | REGISTER_TOKEN={token} bash`
  server-side, using a server-known base URL.
- **Frontend** (`frontend/src/ClustersAdminPanel.jsx`, `frontend/src/clusterProviders/MinikubeClusterForm.jsx`):
  Save calls `createMutation` (→ `admin_create_cluster`); only on a response containing
  `registration_command` does the modal swap to showing the command, replacing the Save/Cancel
  footer with a single "Done" button. No polling exists — the admin has to manually re-open the
  Edit dialog later to see whether `provisioning_status` flipped to `active`.
- **Frontend API base URL** (`frontend/src/datamodel/api.js:1-13`): `ABSOLUTE_API` is the
  guaranteed-absolute origin+path base (handles both dev's absolute `VITE_API_URL` and prod's
  relative `/api` nginx-proxy mode) — this is what the client-side command builder should use in
  place of the backend's `backend_base_url`.

## Design decisions (settled in discussion)

1. **Token generated client-side, no backend call to show the command.** `crypto.randomUUID()`
   (or equivalent CSPRNG source) generated in `MinikubeClusterForm` the moment "Minikube" is
   selected. The command is built entirely in the browser:
   `` `${ABSOLUTE_API}/static/assets/setup-minikube-remote.sh` `` piped through
   `REGISTER_TOKEN=<token> bash`, identical shape to today's server-built string. No round trip,
   no latency, no dependency on Name/Namespace being filled in yet.
2. **No pre-created row. The callback endpoint creates the `Cluster` row lazily**, the first time
   it sees a token hash it doesn't recognize (`registration_token_hash` no longer set by
   `admin_create_cluster` for `minikube` — that branch goes away). On an unrecognized token: create
   `Cluster(cluster_type="minikube", name=<placeholder>, namespace=<default>, active=False,
   provider_config=<posted payload>)`, run `test_connection` same as today, set
   `provisioning_status` to `"pending"` (success — config landed, awaiting admin activation) or
   `"failed"` (test failed), and **keep `registration_token_hash` set** (do not clear it) so the
   frontend can still find this row by polling and so a re-paste of the same command is a
   recognized, idempotent update rather than a second row.
3. **No token expiry.** Drop `registration_token_expires_at` (column removed via migration — see
   Phase 4) and the `REGISTRATION_TOKEN_TTL_MINUTES` expiry check in the callback. An unclaimed
   pending row from an abandoned or never-run command just sits there, inactive, forever — it's
   already an accepted gap that stale rows are harmless (no delete-cluster endpoint exists either);
   this removes the need to reason about a time bound on top of that.
4. **New polling endpoint**: `GET /admin/clusters/by-registration-token?token=<raw>`
   (admin-session-authenticated, same `require_admin` as the rest of `backend/routers/admin.py`).
   Hashes the raw token server-side (same SHA-256 helper as the callback) and looks up a `Cluster`
   row with a matching `registration_token_hash`, returning its admin dict (id, name,
   provisioning_status, namespace, ...) or 404 if no such row exists yet. The `MinikubeClusterForm`
   /  `ClusterFormModal` poll this on an interval (e.g. every 3s) once a token has been generated
   and no match has been found yet, and stop polling once found.
5. **"Config exists" indicator.** Once the poll finds a match, show a success line/icon under the
   command (e.g. "✓ Configuration received") and reveal the (previously hidden, for minikube) "Test
   Connection" button, now targeting the discovered `cluster_id`.
6. **Save = claim + normal field update.** Once a row has been discovered via polling, clicking
   Save no longer calls `createMutation` — it calls the existing `updateMutation` (PATCH
   `/admin/clusters/{id}`) against the discovered cluster's id, sending whatever Name / Namespace /
   Sort Order / Max Runtime the admin has filled into the rest of the (still fully editable) form,
   plus `active: true`. This is the point the row actually goes live/dispatchable, and where its
   placeholder name gets replaced with whatever the admin typed. `admin_update_cluster` should also
   clear `registration_token_hash` on this transition (no longer needed once claimed).
7. **Cluster Type moves above Name/Namespace/etc. in the modal.** Since choosing "Minikube" is now
   the trigger for showing the command — no other field needs to be filled first — the natural
   reading order is type first, then the rest. (Flag for final review when the plan is read back —
   this is a layout call, easy to reverse if it reads worse in practice.)
8. **Placeholder name for a callback-created row**: something like `f"minikube-{token[:8]}"` —
   distinguishable in the admin cluster list, harmless if never claimed, always overwritten by
   Save's PATCH once claimed.

## Phase 1 — Backend: lazy row creation in the callback

- `backend/routers/admin.py`: remove the `self_service_registration` branch from
  `admin_create_cluster` that pre-creates a pending `minikube` row + token (lines ~109-133) —
  `minikube` is no longer a creatable `cluster_type` via `POST /admin/clusters` at all now (it's
  only ever created by the callback). Non-self-service providers (`same_as_backend`,
  `kubeconfig`) keep their existing path unchanged.
- `cluster_register_callback` (lines ~180-238): change the token-hash lookup from "must already
  exist, else 401/404" to "look up; if found, update in place (idempotent re-paste / re-test); if
  not found, create a new `Cluster` row" per Design decision 2. Drop the expiry check entirely.
  On success keep `registration_token_hash` set (don't clear); only clear it in Phase 2's update
  path once the admin claims the row via Save.
- `MinikubeClusterProvider.registration_command` (`backend/services/cluster_providers/minikube.py`)
  can likely be deleted (or kept only if some other server-side caller still needs it) now that the
  frontend builds the command itself — check for other callers before removing.

## Phase 2 — Backend: polling endpoint + claim-on-update

- New endpoint `GET /admin/clusters/by-registration-token` (admin-session-authenticated):
  query param `token`, hashes it, looks up matching `Cluster.registration_token_hash`, returns the
  admin dict or 404.
- `admin_update_cluster`: when the PATCH targets a cluster whose `registration_token_hash` is still
  set and includes `active: true`, clear `registration_token_hash` as part of the same update
  (claiming it) — confirm this doesn't need a separate explicit "claim" flag by checking how
  `admin_update_cluster` currently distinguishes "update fields" from "activate."

## Phase 3 — Frontend: generate token, build command, poll, claim

- `frontend/src/clusterProviders/MinikubeClusterForm.jsx`: generate the token client-side
  (`crypto.randomUUID()`) as soon as the component mounts for a fresh (non-edit) minikube
  selection; build and display the command immediately using `ABSOLUTE_API`
  (`frontend/src/datamodel/api.js`) — no more "click Save to get a command" text.
- Add polling (new hook, e.g. `useAdminClusterByRegistrationToken(token)` in
  `datamodel/useAuthQueries.js`, `refetchInterval` while unresolved) that stops once a match is
  found; surface the discovered `cluster_id` up to `ClusterFormModal`.
- `ClustersAdminPanel.jsx`: rework `showTestConnection` (currently `clusterType !== 'minikube' &&
  !registrationCommand`, line 139) to also show it once a minikube row has been discovered via
  polling; wire `handleTest`/`handleSubmit` to use the discovered `cluster_id` for `minikube`
  instead of `cluster?.id` (there is no `cluster` prop yet — this is still a create-shaped dialog
  from the admin's point of view).
- `handleSubmit` (lines 103-136): for `clusterType === 'minikube'` with a discovered cluster id,
  call `updateMutation` instead of `createMutation`, per Design decision 6.
- Reorder the modal body: Cluster Type selector above Name/Namespace/Sort Order/Max Runtime, per
  Design decision 7.
- Remove the now-dead `registrationCommand` prop/state threading that assumed the command only
  exists post-Save (`ClusterFormModal`'s `registrationCommand` state, the `onHide()`-skip logic in
  `handleSubmit`, the "Done"-only footer) — replace with the new discovered-row state.

## Phase 4 — Migration: drop unused token-expiry column

- New Alembic migration dropping `Cluster.registration_token_expires_at` (generate the revision id
  with real entropy per `CLAUDE.md` rule 9 — `python3 -c "import uuid; print(uuid.uuid4().hex[:12])"`,
  verify uniqueness with `grep -rn "revision = '<id>'" --include=*.py .` before committing).
- `backend/models/cluster.py`: remove the column and the now-stale lifecycle comment describing
  expiry, replace with a comment describing the new lazy-create-on-callback lifecycle.

## Manual verification

- Fresh "Add Cluster" → select Minikube → command appears immediately, with no fields filled in
  and without clicking Save.
- Copy the command, run it against a real target host (or re-run against `mimer` per the original
  plan's verification) — confirm the still-open dialog's poll picks up the new row within a few
  seconds, shows the "config received" indicator, and reveals Test Connection.
- Click Test Connection — confirm it succeeds against the discovered cluster id.
- Fill in Name/Namespace/Sort Order, click Save — confirm the row is updated (not a duplicate
  created), `active` flips true, the placeholder name is gone, and it now appears as a normal
  active cluster in the admin list.
- Close the "Add Cluster" dialog *without* ever running the command — confirm no `Cluster` row was
  created at all (nothing to see in the admin list).
- Run the command from a stale/abandoned dialog (one that was closed without Save) — confirm a
  `Cluster` row is created (per Design decision 2/3), sits inert (`active=false`,
  `provisioning_status="pending"`) with a placeholder name, and doing nothing does not affect any
  other cluster or dispatch behavior.
- Re-run the same command twice in a row (idempotency) — confirm it updates the same row rather
  than erroring or duplicating, both before and after the admin has claimed it via Save.
- Confirm `same_as_backend` and `kubeconfig` cluster type creation is unaffected.

## Open questions / follow-ups

- Exact polling interval and backoff/stop condition for Phase 3 — decide at implementation (a
  simple fixed interval, e.g. 3s, stopped on first match, is likely sufficient).
- Whether `MinikubeClusterProvider.registration_command` has any other caller before deleting it
  (Phase 1) — check at implementation.
- Whether `admin_update_cluster` needs an explicit "claim" signal or can infer it purely from
  "`registration_token_hash` is set and `active: true` is in the request body" (Phase 2) — decide
  at implementation based on the existing update-endpoint shape.
- Field reorder (Design decision 7) is a judgment call, not load-bearing for the rest of the plan —
  fine to revisit independently if it doesn't read well once built.
