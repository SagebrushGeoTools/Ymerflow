# Mini Plan — Plugin npm Source Resolution (local dir + public registry)

> **Status: IMPLEMENTED.** `resolve_npm_source(name, version, mode=…)` in
> `ymerflow_plugin_build/build.py` does local-first / local-only / registry-only per
> `PLUGIN_NPM_SOURCE_MODE`; registry fetch is via `npm pack` (unifying both paths to a tarball).
> Settings live in `backend/config.py`, are injected by `job_orchestrator.py`, and documented in
> `config.env.example` / `docs/deployment.md` / `docs/plugin-author-guide.md`. Tests:
> `tests/test_npm_source_resolution.py` (unit) + verified registry fetch from real npmjs.

## Goal

The `build_frontend_plugin` build must be able to fetch a plugin's npm **source** package from
**either**:

1. **Public npm registry** (`registry.npmjs.org` or a configured private registry) — the production
   default.
2. **Server-local directory** — packages (`.tgz` tarballs from `npm pack`, or unpacked source
   dirs) that the server admin places ahead of time. Primarily for testing and air-gapped
   deployments.

Both must be supported simultaneously. The current implementation (server-local only) is a subset;
this plan adds the registry path and a clean resolution order so neither is special-cased.

> **Context:** the local-dir path was built first because it lets us test the whole
> user-install flow without publishing test packages to npm. It is not a replacement for the
> registry path — both ship.

## Resolution model

A build is parameterised by `{ npm_name, npm_version }`. A **source resolver** decides where the
tarball comes from, in this order:

1. **Local override** — if `<PLUGIN_NPM_SOURCE_DIR>/<name>-<version>.tgz` (or a matching source
   dir) exists, use it. Lets an admin pin/override a specific package without touching the registry.
2. **Registry** — otherwise `npm install <name>@<version>` against `PLUGIN_NPM_REGISTRY`
   (default `https://registry.npmjs.org`).

Local-first means a deployment can run fully offline by populating the directory, while an
unmodified deployment "just works" against npm. The resolver returns a concrete install spec
(a tarball path or a `name@version` registry spec) that the build step passes to `npm install`.

## Configuration

| Setting | Env var | Default | Meaning |
|---|---|---|---|
| Local source dir | `PLUGIN_NPM_SOURCE_DIR` | `""` (disabled) | Directory of admin-placed `.tgz`/source packages. Empty ⇒ registry-only. |
| Registry URL | `PLUGIN_NPM_REGISTRY` | `https://registry.npmjs.org` | Registry used when no local match. Point at a private mirror for locked-down installs. |
| Source mode | `PLUGIN_NPM_SOURCE_MODE` | `auto` | `auto` = local-first then registry; `local` = local only (fail if absent); `registry` = registry only (ignore local dir). |

`PLUGIN_NPM_SOURCE_MODE=local` reproduces today's behaviour for tests; `registry` is the
strict-production setting; `auto` is the convenient default.

## Changes

1. **Config** — add the three settings above to the backend/build config (wherever
   `PLUGIN_NPM_SOURCE_DIR` already landed). Keep them in one place the build step reads.
2. **Source resolver** — a single function `resolve_npm_source(name, version) -> install_spec`
   implementing the order/mode above. Unit-testable in isolation (no network): given a temp dir
   with/without a matching tarball and each mode, assert the chosen spec.
3. **Build step** — replace the hard-coded local-tarball install with a call to the resolver, then
   `npm install <install_spec>` with `--registry <PLUGIN_NPM_REGISTRY>` when the spec is a registry
   spec. Everything downstream (MF build, content-addressing, register) is unchanged.
4. **Pod vs local** — the resolver runs identically in the K8s pod and the local subprocess path;
   only the egress policy differs (the pod's only allowed egress is `PLUGIN_NPM_REGISTRY`; the
   local dir is mounted read-only).
5. **Errors** — surface a clear process-log failure when `mode=local` and no local package matches,
   or when the registry fetch fails (unknown package / network), rather than a generic build error.

## Testing

- **Unit:** resolver picks local tarball when present; falls back to registry when absent;
  respects each `PLUGIN_NPM_SOURCE_MODE`; errors clearly when `local` mode has no match.
- **Integration (local dir):** existing flow — admin drops a `.tgz`, build installs from it.
- **Integration (registry):** point `PLUGIN_NPM_REGISTRY` at a throwaway/private registry (or
  npmjs with a real published test package) and build with no local file present; confirm the
  registry path produces an identical MF remote.

## Out of scope

- Auth tokens / `.npmrc` credentials for private registries (add later as
  `PLUGIN_NPM_REGISTRY_TOKEN` if needed).
- Provenance/signature verification of fetched packages.
- Caching/dedup of identical `(source, host-versions)` builds across projects (already tracked in
  the main plan's open questions).
