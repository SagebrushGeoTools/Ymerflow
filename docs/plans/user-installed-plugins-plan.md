# User-Installed Plugins Plan

> **Status: future / out of scope for now.** This plan is a deliberate, self-contained extension
> of `plugin-system-plan.md`. Nothing here is required to ship the admin-installed plugin system;
> it documents *how* to add user-installed plugins later and *why* the blast radius is small, so
> the door is designed-for without being built yet. Read `plugin-system-plan.md` (esp. Phase 4)
> and `backend-hook-system.md` first — this plan only describes the **deltas**.

## Goal

Let an ordinary (non-admin) user install a frontend plugin **for themselves**, without admin
review, while keeping the multi-tenant security model intact.

The enabling constraint — and the reason this is cheap — is a strict scoping rule:

> **A user-installed plugin is visible only to its owner. By `name` (and version) it overrides the
> admin-installed/system plugin of the same name — but for that one user, and no one else.**

Everything below follows from that single rule.

---

## Core model — a two-layer overlay

Plugins resolve as two stacked layers, per user:

```
effective(user) = system_plugins  ⊕  user_plugins(user)        # ⊕ = override by name
```

- **System layer** — admin-installed plugins (`owner_id IS NULL`), visible to everyone. Exactly
  today's behaviour.
- **User layer** — plugins installed by `user` (`owner_id == user.id`), visible only to `user`.
- **Override is by `name`**: if a user owns a plugin named `billing`, *their* `billing` replaces
  the system `billing` — for them alone. Other users still see the system `billing`. A user with
  no override for a name simply sees the system one.

Because it is an **override, not coexistence**, each `name` resolves to exactly **one** bundle in
any given user's session. There is never more than one bundle per remote name loaded at once.

---

## Why the blast radius is small (the load-bearing rationale)

The admin-only design rests on the assumption *"installed ⇒ trusted, because it runs in every
user's browser."* Private + override **changes the premise** rather than working around it, which
is what dissolves the two expensive problems a naïve "users can install plugins" feature would hit:

1. **No runtime name-namespacing.** Module Federation remote names are global per page load. With
   coexisting user plugins you'd need to rewrite remote names (`u{id}_{name}`) to avoid clashes.
   With override semantics the clash cannot occur — the overlay is resolved **server-side** in
   `GET /plugins/me`, and the browser still loads one remote per name. The MF remote name stays
   clean and equal to `Plugin.name`.

2. **No sandboxing.** A private plugin runs only in its owner's browser, with that owner's own
   auth token, against that owner's own data. It cannot reach another user. The threat collapses
   from "supply-chain attack on all users" to "the user's own footgun" — the same class as the
   user pasting JS into their devtools console or installing a browser extension. It gains **no
   privilege the user doesn't already have**, *provided the backend already enforces per-user
   authorization on every endpoint* (which it must regardless of plugins). So no iframe/worker
   sandbox, no capability/permission model, and **no change to the in-process extension API**
   (registries, `hooks.run_jsx`, page/widget registries all keep working as-is).

This containment is the whole value of the rule: it makes user-installed plugins a genuinely
incremental feature instead of a security re-architecture.

---

## What changes

### 1. Schema — one column + one uniqueness change

On `Plugin` (from `plugin-system-plan.md` § 4.1):

```python
class Plugin(Base):
    __tablename__ = "plugins"
    # ... existing columns ...
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"),
                      nullable=True)            # NULL = system/admin layer; set = private to a user

    __table_args__ = (UniqueConstraint("owner_id", "name"),)   # was: name unique globally
```

- `owner_id IS NULL` → system plugin (admin-installed; today's rows).
- `owner_id == user.id` → private plugin in that user's layer.
- Name uniqueness moves from **global** to **per-owner**: the system layer keeps unique names, and
  each user's private layer keeps unique names, but a user *may* reuse a system name to override
  it. (Postgres treats `NULL` as distinct, so add a partial unique index
  `UNIQUE(name) WHERE owner_id IS NULL` to keep system names globally unique.)

`PluginVersion`, `UserPlugin`, the build Process, content-addressed serving, `latest_version_id`,
and pinning are all **unchanged** — a private plugin is just a `Plugin` row with an `owner_id`, and
its versions (build-output datasets) work identically.

### 2. Resolution overlay — `GET /plugins/me`

The only behavioural change. Today `/plugins/me` returns system backend-bundles + the user's
enabled remote plugins. It now resolves the overlay first:

```python
# candidates = system plugins (owner_id IS NULL) + this user's plugins (owner_id == me)
# group by name; within each name, prefer owner_id == me over owner_id IS NULL
effective = {}
for p in candidates:                       # system first, user second (user wins on collision)
    effective[p.name] = p
return [serialize(p) for p in effective.values() if enabled_for(me, p)]
```

Each entry keeps the same shape as before — `{ name, display_name, remote_url, source,
upgrade_available }` — with one added field, `owner: "system" | "user"`, so the UI can mark
overrides. The served `remote_url` is the chosen layer's content-addressed
`/plugin-assets/{pinned content_hash}/remoteEntry.js`; the frontend loads it exactly as today and
**cannot tell** a private plugin from a system one at runtime.

### 3. Authorization

- `POST /plugins` — any authenticated user may install into **their own** layer (forces
  `owner_id = current_user.id`). Only admins may install into the **system** layer
  (`owner_id IS NULL`). The existing `is_admin` gate generalizes to "admin ⇒ system scope, anyone
  ⇒ own scope."
- `POST /plugins/{id}/upgrade`, `DELETE /plugins/{id}` — an **ownership check**: a user may mutate
  only plugins they own; admins may mutate system plugins. Reusing the same handlers with a scope
  guard.
- `GET /plugins` (list-all) must filter to `system ∪ owned` so users never see others' private
  plugins.

### 4. Install path — build in the user's own project, then register private

Install is **already a build Process** for everyone (`plugin-system-plan.md` § 4.4–4.5): the user
runs `build_frontend_plugin` for `{ npm_name, npm_version }` **in their own project**, then
registers the output dataset with `scope: "user"`. This needs almost no new machinery and is a
direct payoff of the build-as-Process decision:

- **No new ingestion/egress surface.** The build pod's only egress is the fixed `PLUGIN_NPM_REGISTRY`
  — no arbitrary URL, no upload, so no SSRF.
- **Access & compute accounting come for free.** The build runs in the user's project, under their
  project access and their compute budget (the billing hooks charge it like any job). The user can
  only build where they're already a member.
- **Containment is structural.** The output dataset lives in the user's project bucket; the private
  plugin is served only to them (auth by visibility). Deleting the project deletes the plugin —
  consistent with the base plan, and moot until projects are deletable.

The only registration-time difference from a system plugin is that `owner_id` is forced to the
caller (and an optional per-user quota applies). Compatibility is still **constructed at build
time** (shared pinned to host); an incompatible source just **fails the build** in the user's own
project, with logs they can read.

### 5. Quotas & GC — mostly free

Because a user plugin's bytes are an ordinary **output dataset in the user's own project bucket**,
storage accounting and lifecycle ride the **existing project-storage** mechanisms — there is no new
system store and no bespoke plugin GC:

- Build output counts against the user's **project storage** like any process output; the existing
  per-project quota applies.
- Lifecycle is dataset/project lifecycle: an abandoned build is just an old dataset the user can
  delete; deleting the project removes everything. (Don't delete a dataset a live `PluginVersion`
  still pins — guard registration-referenced datasets.)
- A build rate-limit per user and the usual job resource caps bound abuse (the build is a Process,
  so the job controls already apply).

---

## Subtleties introduced by the override semantics

- **Override = fork.** Once a user shadows system `billing`, they stop receiving admin updates to
  `billing` until they remove their override. Surface this in the UI ("you are overriding the
  system version — system updates won't apply") so users don't silently miss security fixes.
- **No admin audit of private bytes.** Admins cannot review user-installed code (it's private).
  This is acceptable **only because** the blast radius is self-contained — which is exactly the
  property the scoping rule guarantees. If that ever stops holding (e.g. plugins gain a
  server-side execution path), this assumption must be revisited.
- **Residual risk: social engineering.** A user can be phished into installing a malicious private
  plugin that exfiltrates *their own* data using *their own* session — identical in class to a
  malicious browser extension or a console paste. Mitigation is a blunt install-time warning and
  documented user responsibility, not a code change.
- **Backend plugins are unaffected.** Backend-bundled frontend plugins (`backend-hook-system.md`)
  are inherently system-scope and admin-installed; users cannot install backend plugins (those run
  server-side and would breach containment). User-installed plugins are **frontend-only**, always.

---

## What explicitly does NOT change

- `PluginVersion`, content-addressing, `/plugin-assets/{hash}` serving, `Cache-Control: immutable`.
- Per-user version pinning (`UserPlugin.plugin_version_id`), `enable` / `upgrade` / `disable`.
- The `build_frontend_plugin` Process and build-time shared-dep pinning.
- The frontend extension API: registries (dataset/widget/layer/quantity-kind/page) and the
  frontend hook system (`hooks.run` / `run_async` / `run_jsx`). A private plugin registers exactly
  the same way; the host has no idea who installed it.
- The MF runtime loader and the startup gate on `pluginsReady`.

The reuse is near-total: the feature is **`owner_id` + a uniqueness change + a resolution overlay
+ ownership authz.** (No new install or storage surface — building in the user's own project
already carries it.)

---

## Open questions (for when this is actually scheduled)

- **Per-user MF singleton drift.** A private plugin still shares the host's React/gladly
  singletons; its build pins `shared` to the host the same way. No new mechanism needed — an
  incompatible source just fails the user's build, with logs they can read in their own project.
- **Override visibility for admins.** Should an admin be able to see *that* a user overrides a
  system plugin (not the bytes), e.g. for support? Privacy vs. supportability.
- **Org/team layer.** This plan has exactly two layers (system, user). A middle "org" layer
  (`owner` = org, visible to members) is a natural extension and would slot into the same overlay
  resolution with a priority order `user ⊕ org ⊕ system`. Out of scope here.
- **Build-output lifecycle.** Build datasets accumulate in the user's project; decide whether to
  auto-prune old build outputs not pinned by any `PluginVersion` (vs. leaving it to normal dataset
  management).

---

## Implementation delta (if/when built)

Strictly additive on top of a shipped `plugin-system-plan.md`:

1. Migration: add `Plugin.owner_id`; swap global name-unique for `UNIQUE(owner_id, name)` +
   partial `UNIQUE(name) WHERE owner_id IS NULL`.
2. `/plugins/me`: insert the overlay resolution; add `owner` to the response.
3. Authorization: scope guard on `POST /plugins`, `/upgrade`, `DELETE`, `GET /plugins`.
4. User install: allow non-admins to run `build_frontend_plugin` in their own project and register
   with `scope: "user"` (force `owner_id = caller`); add a build rate-limit. No new ingestion or
   storage path — the Process build + project bucket already carry it.
5. (No bespoke GC — build outputs are ordinary project datasets.)
6. UI: self-install flow in `PluginManager`, an "overriding system" badge, and the
   forking/updates warning.

No frontend-runtime, MF-loader, or extension-API changes.
