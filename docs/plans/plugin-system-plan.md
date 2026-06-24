# Plugin System Plan

## Goal

Make the Nagelfluh frontend pluggable at runtime: plugins can register new dataset types, layer
types, widget types, quantity kinds, **full pages, and frontend hook callbacks** without modifying
or rebuilding the main application.

There are **two kinds of plugins** sharing **one** frontend extension API **and one artifact
format** — a Module Federation remote **built from an npm source package** against the host's exact
shared-dependency versions. Plugins are distributed as npm **source** packages; Nagelfluh **builds**
them (running the real `npm`/`vite` resolver), it never trusts a pre-built blob. The two kinds
differ only in *where the build runs*:

1. **Frontend plugins** — built by a **Process** (a Kubernetes-pod job, like any inversion) running
   in a project the installer has access to. The build's **output dataset** — the directory of
   built artefacts in the **project bucket** — is what gets served. Frontend-only,
   enabled/disabled (and version-pinned) per user.
2. **Backend plugins** — pip-installed Python packages (see `backend-hook-system.md`) that, besides
   models / hooks / API routers, declare an npm frontend source. Because a backend plugin is
   admin-installed and therefore fully trusted, **its frontend is built on the backend server**
   (not in a Process). A backend plugin is a **superset** of a frontend plugin.

Building from source against the host's actual singleton versions means **compatibility is
constructed, not merely checked**, and arbitrary non-shared deps are simply bundled. There is **no
direct-upload path** and **no pre-built fetch**: npm-source-plus-build is the sole channel. Both
kinds register their extensions through the same registries, the same frontend hook system, and the
same SDK, and both serve content-addressed from `/plugin-assets/{content_hash}/…`. See
`backend-hook-system.md` § *Two kinds of plugins* for the full comparison.

## Architecture Summary

- **Build system**: Migrate from CRA (`react-scripts`) to Vite + `@module-federation/vite`
- **Plugin format**: Module Federation remotes, **built by Nagelfluh from an npm source package**;
  shared deps declared as `peerDependencies` and pinned **to the host's versions at build time**
- **Shared deps**: React, react-dom, gladly-plot declared as MF singletons — one instance shared
  between host and all plugins; the build injects the host's exact versions into the MF `shared`
  config, so a plugin can never load against an incompatible singleton
- **Registries** (keyed — one value per key): dataset types, layer types, quantity kinds, widgets,
  and **pages**, replacing hardcoded switch statements and plain objects
- **Frontend hook system** (fan-out — many callbacks per name): mirrors the backend hook runner;
  lets plugins contribute menu items, account tabs, context providers, routes, and per-object
  actions. New in this plan.
- **Plugin lifecycle (frontend)**: installer picks a project + `npm name@version` → a
  **`build_frontend_plugin` Process** runs in that project (npm install + MF build) → its **output
  dataset** (built `dist/`) lands in the project bucket → it's registered as a `Plugin` (remote
  name + visibility) → served content-addressed from `/plugin-assets/{content_hash}/…` → users
  enable + pin per-account → frontend loads at startup via MF runtime
- **Plugin lifecycle (backend plugin)**: admin `pip install`s the backend plugin → its **`setup.py`
  builds the npm frontend source** at install time (pinned to host versions) and ships it as package
  data → at startup the backend content-addresses that built dir and lists it in `GET /plugins/me` →
  loads through the identical `/plugin-assets/{content_hash}/…` path (always on, not user-toggled)

---

## Phase 1 — Migrate CRA to Vite

CRA (`react-scripts 5`) must be replaced. It bundles all deps internally and provides no
mechanism to share module instances with dynamically loaded code, which Module Federation
requires.

### 1.1 Remove CRA, add Vite

```
npm uninstall react-scripts
npm install --save-dev vite @vitejs/plugin-react @module-federation/vite
```

### 1.2 Create `frontend/vite.config.js`

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { federation } from '@module-federation/vite'

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'nagelfluh_host',
      remotes: {},          // populated dynamically at runtime, not statically here
      shared: {
        react:              { singleton: true, requiredVersion: '^18.2.0' },
        'react-dom':        { singleton: true, requiredVersion: '^18.2.0' },
        'gladly-plot':      { singleton: true, requiredVersion: '^0.0.15' },
        '@tanstack/react-query': { singleton: true },
      },
    }),
  ],
  build: {
    target: 'esnext',      // required for top-level await used by MF runtime
  },
  server: {
    port: 3000,
  },
})
```

### 1.3 Update `frontend/index.html`

Move `public/index.html` to `frontend/index.html` (Vite root). Replace CRA placeholders:

- `%PUBLIC_URL%/` → `/`
- `%PUBLIC_URL%/favicon.ico` → `/favicon.ico`

Add the app entry point (Vite convention):

```html
<script type="module" src="/src/index.js"></script>
```

### 1.4 Update environment variable references

CRA uses `process.env.REACT_APP_*`; Vite uses `import.meta.env.VITE_*`.

Grep and replace throughout `frontend/src/`:

```
process.env.REACT_APP_API_URL  →  import.meta.env.VITE_API_URL
```

Update `frontend/.env` / `frontend/.env.local` key names accordingly.

### 1.5 Fix CRA-specific import patterns

- **SVG as React component**: CRA's `import { ReactComponent as Foo } from './foo.svg'` does not
  work in Vite. Install `vite-plugin-svgr` and update imports to:
  `import Foo from './foo.svg?react'`
- **CSS Modules**: no change needed; Vite supports `*.module.css` natively.
- **`require()` calls**: convert any remaining CommonJS `require()` to ESM `import`. One known
  case: the lazy `require('./webxtile')` in `dataset.js:1010` → use dynamic `import()`.

### 1.6 Update `frontend/package.json` scripts

```json
"scripts": {
  "start": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "test": "vitest"
}
```

If Jest tests exist, migrate to Vitest (`npm install --save-dev vitest @vitest/ui`). The APIs
are compatible; only the config location changes.

### 1.7 Update Docker / CI build commands

Any `npm run build` invocations continue to work. The output lands in `frontend/dist/` instead
of `frontend/build/` — update the backend's static file serving path accordingly.

---

## Phase 2 — Create Frontend Registries

Replace hardcoded switch statements and plain objects with explicit registries that plugins can
call into.

### 2.1 Dataset Type Registry

**New file: `frontend/src/datamodel/datasetRegistry.js`**

```js
const registry = new Map()   // mimeType → DatasetClass

export function registerDatasetType(mimeType, DatasetClass) {
  registry.set(mimeType, DatasetClass)
}

export function createDatasetInstance(metadata) {
  const Cls = registry.get(metadata.mime_type)
  if (!Cls) throw new Error(`Unknown dataset mime type: ${metadata.mime_type}`)
  return new Cls(metadata)
}
```

In `dataset.js`, replace the `createDatasetInstance` switch with calls to
`registerDatasetType` at module level:

```js
import { registerDatasetType, createDatasetInstance } from './datasetRegistry'

registerDatasetType('application/json',                new JsonDataset)       // wrong example
// Actually register classes, not instances:
registerDatasetType('application/json',                JsonDataset)
registerDatasetType('application/x-aarhusxyz-msgpack', XyzDataset)
registerDatasetType('application/x-magdata-msgpack',   MagDataset)
registerDatasetType('application/x-webxtile',          WebxtileDataset)
```

Export `registerDatasetType` from `datasetRegistry.js` for use by plugins.

### 2.2 Widget Registry

**New file: `frontend/src/widgets/widgetRegistry.js`**

```js
const registry = new Map()   // name → React component

export function registerWidget(name, Component) {
  registry.set(name, Component)
}

export function getWidgets() {
  return Object.fromEntries(registry)
}
```

In `App.js`, replace the hardcoded `widgets` object:

```js
import { registerWidget, getWidgets } from './widgets/widgetRegistry'
import { PlotView, FlowView, ProcessEditor, /* ... */ } from './widgets'

registerWidget('PlotView',       PlotView)
registerWidget('FlowView',       FlowView)
registerWidget('ProcessEditor',  ProcessEditor)
// ... all existing widgets

// Then:
const widgets = getWidgets()   // passed to LayoutProvider
```

### 2.3 Layer Type Registry

`gladly-plot` already provides `registerLayerType`. The only change needed is to ensure plugins
can import it via a stable path without depending on the host's internal module graph.

**New file: `frontend/src/plotRegistry.js`** (thin re-export):

```js
export { registerLayerType, registerAxisQuantityKind } from 'gladly-plot'
```

This file is what plugin authors import. It resolves to the shared gladly-plot singleton via
Module Federation, so registration affects the same global gladly registry.

### 2.4 Quantity Kind Registry

Same pattern — `registerAxisQuantityKind` from gladly-plot is already a registry. Existing
calls in `dataset.js` and `quantityKinds.js` need no change. Plugins use the re-export from
`plotRegistry.js` above.

### 2.5 Page (Route) Registry

The app already uses `react-router-dom` v7 with top-level `<Routes>` in `App.js` (`/app/*`,
`/account`, `/invite/:token`, `/`). Plugins contribute **full pages** as routes — distinct from
**widgets** (2.2), which live inside draggable flexout panes. Pages are standalone screens:
settings, dashboards, admin tools, a billing transaction history view, etc.

**New file: `frontend/src/plugins/pageRegistry.js`**

```js
const registry = new Map()   // path -> { path, component, title }

export function registerPage(descriptor) {
  registry.set(descriptor.path, descriptor)   // descriptor: { path, component, title }
}

export function getPages() {
  return [...registry.values()]
}
```

`App.js` spreads registered pages into the router, namespaced under `/app/plugin/` to avoid
collisions with core routes (plugins load before the render gate in 3.2, so the registry is
fully populated by first render):

```jsx
import { getPages } from './plugins/pageRegistry'

// inside the main <Routes> block:
{getPages().map(p => (
  <Route key={p.path} path={`/app/plugin/${p.path}`} element={<p.component />} />
))}
```

A plugin pairs `registerPage(...)` with a `nav_items` hook callback (2.6) so the page is
reachable from the menu bar.

### 2.6 Frontend Hook Registry

A fan-out callback system that **mirrors the backend hook runner** (`backend-hook-system.md`).
The registries above are *keyed* (one value per key); hooks are *lists* — many callbacks under
one name, results concatenated. This is the right shape for "every plugin contributes some menu
items / account tabs / context providers", which a keyed registry cannot express.

**Frontend hook callbacks can return JSX/components, not just data.** The dominant use is a
component rendering plugin contributions inline:

```jsx
function ProcessToolbar({ processId }) {
  return <div className="toolbar">{hooks.run_jsx.process_actions(processId)}</div>
}
```

`hooks.run_jsx.<name>(...)` is the **render-safe** fan-out. It returns a flat array of whatever
the callbacks produce — JSX elements, plain descriptors, or a mix — and decides **per item** how
to handle it:

- items that are **React elements** are auto-keyed and wrapped in a `HookBoundary`, so
  `<div>{hooks.run_jsx.slot(ctx)}</div>` renders them directly and one faulty element can't
  blank the surrounding render;
- items that are **anything else** (descriptors, route specs, …) pass through untouched, for the
  caller to interpret.

Crucially, `run_jsx` also **isolates a throwing callback** — a broken plugin contributes nothing
rather than crashing the render. That swallowing is acceptable *only* because the output is UI
meant to degrade gracefully. For **data** hooks, silently dropping a failure hides bugs, so those
use `hooks.run` / `hooks.run_async`, which mirror the backend exactly: every callback runs, but
the first error is **re-raised** (chained), never swallowed. Three methods, one rule of thumb —
`run_jsx` for anything consumed during render, `run` / `run_async` for data computed off the
render path.

**New file: `frontend/src/plugins/hooks.js`**

```js
import React from 'react'
import { HookBoundary } from './HookBoundary'   // small error-boundary component

const registry = new Map()   // name -> [fn, ...]

export function registerHook(name, fn) {
  if (!registry.has(name)) registry.set(name, [])
  registry.get(name).push(fn)
}

export function getHookFns(name) {
  return registry.get(name) || []
}

// Backend-parity error handling: every callback runs; the first error is
// re-raised with the rest chained as `.cause`. Shared by run + run_async.
function rethrow(errors) {
  if (errors.length) {
    errors.slice(1).forEach(e => { e.cause = errors[0] })
    throw errors[errors.length - 1]
  }
}

// Sync DATA fan-out (`hooks.run.name(...)`) — mirrors the backend verbatim.
// Errors PROPAGATE (never swallowed). No JSX handling.
function runSync(name, ...args) {
  const out = [], errors = []
  for (const fn of getHookFns(name)) {
    try { out.push(...(fn(...args) || [])) }
    catch (e) { errors.push(e) }
  }
  rethrow(errors)
  return out
}

// Async DATA fan-out (`hooks.run_async.name(...)`) — mirrors the backend verbatim.
async function runAsync(name, ...args) {
  const out = [], errors = []
  for (const fn of getHookFns(name)) {
    try { out.push(...((await fn(...args)) || [])) }
    catch (e) { errors.push(e) }
  }
  rethrow(errors)
  return out
}

// Sync RENDER fan-out (`hooks.run_jsx.name(...)`) — FRONTEND-ONLY, no backend
// equivalent. Element items are auto-keyed + HookBoundary-wrapped so the result
// embeds straight into JSX; non-element items pass through. Per-callback errors
// are ISOLATED (logged + skipped) so one broken plugin can't blank the render.
// Never throws.
function runJsx(name, ...args) {
  const out = []
  getHookFns(name).forEach((fn, i) => {
    let items
    try { items = fn(...args) || [] }
    catch (e) { console.error(`hook "${name}" #${i} threw`, e); return }
    items.forEach((item, j) => {
      if (React.isValidElement(item)) {
        const key = item.key ?? `${name}:${i}:${j}`
        out.push(<HookBoundary key={key} name={name}>{item}</HookBoundary>)
      } else {
        out.push(item)   // plain data (descriptors, providers, route specs, …)
      }
    })
  })
  return out
}

// All three are attribute-access Proxy namespaces:
//   hooks.run.name(...)             -> sync  data   (errors propagate)
//   await hooks.run_async.name(...) -> async data   (errors propagate)
//   hooks.run_jsx.name(...)         -> sync  render (errors isolated, JSX-aware)
const ns = impl => new Proxy({}, { get: (_t, name) => (...args) => impl(name, ...args) })
export const hooks = {
  run:       ns(runSync),
  run_async: ns(runAsync),
  run_jsx:   ns(runJsx),
}
```

`run` and `run_async` match the backend hook runner (`backend-hook-system.md`) **verb-for-verb
and signature-for-signature** — both sides use the attribute-access Proxy namespace, the hook
name is an attribute (never a string argument), every callback runs, and the first error is
re-raised. `run_jsx` is the **frontend-only** third method for render-time hooks: it adds per-item
JSX wrapping and swaps re-raise for failure isolation (the backend never renders, so it has no
counterpart).

| Purpose | Backend (Python) | Frontend (JS) | On error |
|---|---|---|---|
| sync data | `hooks.run.name(...)` | `hooks.run.name(...)` | re-raise |
| async data | `await hooks.run_async.name(...)` | `await hooks.run_async.name(...)` | re-raise |
| render (JSX) | — (no rendering on the server) | `hooks.run_jsx.name(...)` | isolate |

**Optional memoized wrapper — `useHook`** (`frontend/src/plugins/useHook.js`), for hot render
paths where the args are stable:

```js
import { useMemo } from 'react'
import { hooks } from './hooks'

export function useHook(name, ...args) {
  return useMemo(() => hooks.run_jsx[name](...args), [name, ...args])   // eslint-disable-line react-hooks/exhaustive-deps
}
```

`useHook` wraps `run_jsx` because it is meant for render paths; a component needing a **data**
hook calls `hooks.run` / `hooks.run_async` directly (errors surface as they should).

**Built-in hook points** the host invokes (plugins opt in by registering a callback). A host
component adds a new render-time hook point simply by calling `hooks.run_jsx.my_point(ctx)` and
dropping the result into JSX — the list is open-ended. Two callback shapes recur:

- **Slot hooks** return arrays of **JSX elements** rendered inline via `run_jsx`.
- **Descriptor hooks** return arrays of **plain objects** the host interprets (providers, routes,
  menu specs) — `run_jsx` passes non-elements through untouched while still isolating failures.

All built-in points below are consumed during render, so all use `run_jsx`; `run` / `run_async`
are reserved for pure-data hooks (plugin-to-plugin, or future non-UI extension points).

| Hook | Shape | Call via | Host call site | Each callback returns |
|---|---|---|---|---|
| `app_providers` | descriptor | `run_jsx` | `App.js`, wrapping `<AuthenticatedApp>` | `[{ Component }]` — context providers nested around the app |
| `app_routes` | descriptor | `run_jsx` | `App.js` `<Routes>` | `[{ path, element }]` — react-router routes (complements the 2.5 registry) |
| `nav_items` | descriptor | `run_jsx` | menu bar (bridges to the existing `MenuContext`) | `[{ menuPath, label, to | onSelect }]` — menu entries |
| `account_tabs` | descriptor | `run_jsx` | `AccountPage.js` | `[{ id, title, content }]` — `content` is JSX |
| `process_actions` | **slot** | `run_jsx` | process toolbar | `[<button .../>, …]` — JSX rendered inline |
| `plot_overlays` | **slot** | `run_jsx` | `PlotView` | `[<Overlay .../>, …]` — JSX rendered inline |

> **Why this matters for backend plugins**: billing's transaction-history UI currently lives
> hardcoded in `AccountPage.js`. With this system it moves into an `account_tabs` callback shipped
> by billing's frontend bundle — so when billing is not installed there is no billing tab,
> matching the backend's "no billing → no balance anywhere" guarantee end-to-end.

The existing `MenuContext` (`useRegisterMenu` / `useRegisterMenuComponent`) is React-hook-based
and so only usable from mounted host components. Plugins register at module-load time as side
effects and cannot call React hooks, which is precisely why the `nav_items` *frontend hook* is
needed: the menu bar calls `useHook('nav_items')` and feeds the results into `MenuContext`.

---

## Phase 3 — Module Federation Plugin Loading

### 3.1 Dynamic remote loading at startup

Module Federation with Vite supports loading remotes whose URLs are not known at build time.
The pattern uses the low-level `loadRemote` API from `@module-federation/runtime`:

**New file: `frontend/src/plugins/loadPlugin.js`**

```js
import { init, loadRemote } from '@module-federation/runtime'

let mfInitialised = false

async function ensureInit(remotes) {
  if (mfInitialised) return
  await init({
    name: 'nagelfluh_host',
    remotes,
    shared: {
      react:         { version: '18.2.0', lib: () => import('react'),    singleton: true },
      'react-dom':   { version: '18.2.0', lib: () => import('react-dom'), singleton: true },
      'gladly-plot': { version: '0.0.15', lib: () => import('gladly-plot'), singleton: true },
    },
  })
  mfInitialised = true
}

export async function loadPlugins(plugins) {
  // plugins: [{ name, remote_url, source }] — source is "remote" or "backend".
  // Both kinds are loaded identically; the source field is informational only.
  const remotes = plugins.map(p => ({
    name: p.name,
    entry: p.remote_url,   // backend-served, content-addressed: /plugin-assets/{content_hash}/remoteEntry.js
  }))

  await ensureInit(remotes)

  await Promise.all(
    plugins.map(p => loadRemote(`${p.name}/index`))
    // each plugin's index.js calls registerDatasetType / registerWidget / etc. as side effects
  )
}
```

### 3.2 Gate rendering on plugin load

In `App.js`, fetch the user's plugin list from `GET /plugins/me` before rendering. As defined in
`backend-hook-system.md`, that endpoint returns the **union** of backend-bundled plugins
(`source: "backend"`, always present) and the user's enabled remote plugins
(`source: "remote"`) — `loadPlugins` treats them identically.

```js
function App() {
  const [pluginsReady, setPluginsReady] = useState(false)
  const { data: enabledPlugins } = useEnabledPlugins()   // GET /plugins/me

  useEffect(() => {
    if (!enabledPlugins) return
    loadPlugins(enabledPlugins).then(() => setPluginsReady(true))
  }, [enabledPlugins])

  if (!pluginsReady) return <LoadingScreen />

  // All registries + hooks are now populated by plugin side effects.
  const widgets = getWidgets()
  const providers = hooks.run_jsx.app_providers()   // [{ Component }] (descriptor hook, render-time)

  // Wrap the app in plugin-supplied context providers, outermost-last:
  return providers.reduceRight(
    (children, { Component }) => <Component>{children}</Component>,
    <AuthenticatedApp widgets={widgets} />
  )
}
```

Registered **pages** (2.5) and `app_routes` hook results are spread into the `<Routes>` block
inside `AuthenticatedApp`; `nav_items` feed the menu bar; `account_tabs` extend `AccountPage`;
slot hooks like `process_actions` are embedded inline (`<div>{hooks.run_jsx.process_actions(
processId)}</div>`). Gating on `pluginsReady` ensures every dataset type, layer type, widget,
page, and hook callback is registered before any saved layout is restored or any process output
is rendered.

### 3.3 Plugin SDK package

To help plugin authors, provide a small npm package (or a documented template repo) that
re-exports the registration APIs at stable paths. This avoids coupling plugin source to the
host's internal file structure.

**Package: `nagelfluh-plugin-sdk`**

```js
// index.js — all registration APIs a plugin needs
export { registerDatasetType }      from 'nagelfluh/datamodel/datasetRegistry'
export { registerWidget }           from 'nagelfluh/widgets/widgetRegistry'
export { registerPage }             from 'nagelfluh/plugins/pageRegistry'
export { registerHook, hooks, useHook } from 'nagelfluh/plugins/hooks'
export { registerLayerType,
         registerAxisQuantityKind }  from 'nagelfluh/plotRegistry'
```

These resolve via Module Federation to the host's own modules, so there is no separate bundle
— the SDK is a pure re-export shim. Plugin authors install it as a dev dependency. **The same SDK
is used by every plugin** regardless of where it's built (Process or backend server).

The SDK also ships the **Vite federation preset** the build harness uses (§ 4.5): it reads the
host's shared-singleton versions (injected into the build by the runner) and emits the MF `shared`
config pinned to them. This is why a plugin author writes no MF/Vite config — the preset, applied
at build time, guarantees the plugin federates against the host's exact versions.

---

## Phase 4 — Backend Plugin Registry

### 4.1 `Plugin` model

**New file: `backend/models/plugin.py`**

**Identity is split from version**: a `Plugin` is the stable identity (by MF remote `name`); each
installed/updated build is an **immutable, content-addressed** `PluginVersion`. The `Plugin` row
just points at the currently-active version.

```python
class Plugin(Base):
    """Stable plugin identity. Code lives in immutable PluginVersion rows (below)."""
    __tablename__ = "plugins"

    id                = Column(UUID, primary_key=True, default=uuid4)
    name              = Column(String(255), unique=True, nullable=False)   # MF remote name
    display_name      = Column(String(255), nullable=False)
    description       = Column(Text, nullable=True)
    latest_version_id = Column(UUID, ForeignKey("plugin_versions.id", use_alter=True),
                               nullable=True)            # newest installed version; what new
                                                         # enables and upgrades pin to
    created_at        = Column(DateTime, default=datetime.utcnow)
    created_by        = Column(Integer, ForeignKey("users.id"), nullable=True)

    latest_version = relationship("PluginVersion", foreign_keys=[latest_version_id],
                                  post_update=True)
    versions       = relationship("PluginVersion", back_populates="plugin",
                                  foreign_keys="PluginVersion.plugin_id",
                                  cascade="all, delete-orphan")
    user_plugins   = relationship("UserPlugin", back_populates="plugin",
                                  cascade="all, delete-orphan")


class PluginVersion(Base):
    """One built version of a plugin: a thin reference to a build Process's output dataset."""
    __tablename__ = "plugin_versions"

    id                = Column(UUID, primary_key=True, default=uuid4)
    plugin_id         = Column(UUID, ForeignKey("plugins.id", ondelete="CASCADE"), nullable=False)
    # --- the build (a `build_frontend_plugin` Process and the dataset it produced) ---
    project_id        = Column(UUID, ForeignKey("projects.id"), nullable=False)
    process_id        = Column(String(255), nullable=False)   # the build Process
    process_version   = Column(Integer, nullable=False)       # which build (a process version)
    output_dataset_id = Column(String(255), nullable=False)   # the built dist/ directory dataset
    # --- denormalized for display / pinning / cache-busting ---
    npm_name          = Column(String(255), nullable=False)   # build input (from process params)
    npm_version       = Column(String(64),  nullable=False)   # build input
    content_hash      = Column(String(64), nullable=False, index=True)  # hash of the output dataset
    built_against     = Column(JSON, nullable=False, default=dict)  # host shared versions used
    created_at        = Column(DateTime, default=datetime.utcnow)

    plugin = relationship("Plugin", back_populates="versions", foreign_keys=[plugin_id])

    __table_args__ = (UniqueConstraint("plugin_id", "content_hash"),)
```

A `PluginVersion` is a **thin pointer** to a completed build: the `build_frontend_plugin` Process,
the version that ran, and the **output dataset** holding the built `dist/` in the project bucket
(§ 4.4). The npm source coordinates are the Process's parameters; they're denormalized here only for
display and "upgrade available" comparison. `built_against` records the host shared-singleton
versions the build pinned to, so a later host upgrade can decide whether a rebuild is warranted.

`content_hash` (sha256 over the output dataset's `path → sha256` manifest) is what the system **keys
the asset URL and per-user pinning on** — kept for cache-busting and stable pinning even though the
underlying dataset is itself immutable once its build completes. There is **no peer-dep hard-block**
anymore: compatibility is *constructed* at build time by pinning `shared` to the host's versions, so
an incompatible plugin **fails the build** (with logs) rather than being rejected at an API gate.

`name` is the Module Federation remote name (from the built package's `nagelfluh.remoteName`; a
valid JS identifier, e.g. `"skytem_plugin"`) — distinct from the npm package name and stable across
versions. **Plugin code is never loaded from an external URL at runtime** — it is always served from
the build's output dataset (§ 4.4). Versions are **never garbage-collected** while a user pins them;
a version's bytes live as long as its output dataset (i.e. its project) does.

- The runtime-served URL is the **content-addressed**, immutable
  `/plugin-assets/{content_hash}/remoteEntry.js`, which the serve endpoint resolves to the output
  dataset's files. `content_hash` pins the exact built bytes; `npm_version` is the human-facing
  version. `UniqueConstraint(plugin_id, content_hash)` makes re-registering an identical build a
  no-op.
- `latest_version_id` is the **newest** version, *not* "the version everyone runs". Each user is
  **pinned** to the specific version that was latest when they enabled the plugin (`UserPlugin`,
  § 4.2), and stays there until they explicitly upgrade. Installing a new version therefore never
  changes what already-enabled users load — it only changes what new enables and upgrades pin to.

### 4.2 `UserPlugin` model

Per-user installation/enable state in the same file or `backend/models/user_plugin.py`:

```python
class UserPlugin(Base):
    __tablename__ = "user_plugins"

    id                = Column(UUID, primary_key=True, default=uuid4)
    user_id           = Column(Integer, ForeignKey("users.id"), nullable=False)
    plugin_id         = Column(UUID, ForeignKey("plugins.id"), nullable=False)
    plugin_version_id = Column(UUID, ForeignKey("plugin_versions.id"), nullable=False)  # PINNED
    enabled           = Column(Boolean, default=True, nullable=False)
    installed_at      = Column(DateTime, default=datetime.utcnow)

    user           = relationship("User",          back_populates="plugins")
    plugin         = relationship("Plugin",        back_populates="user_plugins")
    plugin_version = relationship("PluginVersion")

    __table_args__ = (UniqueConstraint("user_id", "plugin_id"),)
```

Each user is **pinned** to one `PluginVersion`. On enable, `plugin_version_id` is set to the
plugin's `latest_version_id` *at that moment*; the user then loads exactly that version until they
upgrade (which re-pins it to the current latest). This makes plugin updates opt-in per user and is
why versions are never deleted.

Add the reverse relationship to `User`:

```python
plugins = relationship("UserPlugin", back_populates="user", cascade="all, delete-orphan")
```

### 4.3 Alembic migration

```
alembic -c backend/alembic.ini revision -m "add plugin, plugin_version, user_plugin tables"
```

The migration creates all three tables. `plugins.latest_version_id` and
`plugin_versions.plugin_id` form a **circular FK**, so the migration must create the tables first
and add `plugins.latest_version_id`'s FK with `use_alter=True` (a follow-up `ALTER`), which the
model already declares. No changes to existing tables except adding the `plugins` relationship to
`User` (pure ORM relationship, no column change).

### 4.4 API endpoints

**New file: `backend/routers/plugins.py`**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/plugins` | any user | List all installed plugins (with latest version) |
| `POST` | `/plugins/build` | project member | Start a `build_frontend_plugin` Process in a project |
| `POST` | `/plugins` | admin / project member | Register a completed build's output dataset as a plugin |
| `DELETE` | `/plugins/{id}` | admin / owner | Unregister a plugin (the build dataset is left in its project) |
| `GET` | `/plugins/me` | current user | List plugins with user's enabled state + pinned version |
| `GET` | `/plugin-assets/{hash}/{path:path}` | per visibility | Stream a content-addressed plugin file |
| `POST` | `/plugins/{id}/enable` | current user | Enable for self; pin to current latest version |
| `POST` | `/plugins/{id}/upgrade` | current user | Re-pin self to the current latest version |
| `POST` | `/plugins/{id}/disable` | current user | Disable plugin for self |

#### Build — a `build_frontend_plugin` Process (§ 4.5)

Installing a frontend plugin is, first, **running a build**. `POST /plugins/build` creates a
`build_frontend_plugin` Process (§ 4.5) in a project the caller has access to, parameterised by
`{ npm_name, npm_version }`. It runs in a pod exactly like an inversion — `npm install` + MF build
with `shared` pinned to the host's versions — and writes **one output dataset**: the built `dist/`
directory, in the project bucket. It surfaces through the normal Process machinery (state, logs,
clone-a-version). A build that can't satisfy the host's shared versions simply **fails with logs**;
there is no separate API-level dep gate. *(For a **system** plugin the admin picks the project the
build runs in; for a **user/private** plugin it runs in the user's own project — see
`user-installed-plugins-plan.md`.)*

#### Register / update — point a `Plugin` at a build output (`POST /plugins`)

`POST /plugins { process_id, process_version, scope: "system" | "user" }` registers a **completed**
build as a plugin. The backend:

1. validates the referenced **output dataset** is a built MF remote and reads its embedded
   `package.json` for `nagelfluh.remoteName` and `built_against` (the host versions the build used);
2. computes `content_hash` over the output dataset's `path → sha256` manifest;
3. upserts a `PluginVersion` referencing `(project_id, process_id, process_version,
   output_dataset_id)` with the denormalized `npm_name@npm_version` and `content_hash`, and moves
   `plugin.latest_version_id` to it. A brand-new plugin also creates the `Plugin` identity row (its
   `name` = the package's `nagelfluh.remoteName`; `scope` sets `owner_id`).

Updating is the same call pointing at a **newer build version**: a new `PluginVersion` is added and
`latest_version_id` advances. This does **not** move any already-enabled user — they stay pinned to
their version (§ 4.2) until they hit `POST /plugins/{id}/upgrade`. Rollback is re-pinning to an
earlier `PluginVersion`.

> **Why build-in-a-Process, not fetch-a-blob.** Running `npm install` is **safe inside a Process** —
> the same sandbox (resource-limited pod, no DB/secrets, registry-only egress) we already run
> untrusted inversions in — so the backend never executes plugin build scripts itself. Building from
> source against the host's exact singletons makes **compatibility constructed, not checked**, runs
> the real dependency resolver (any non-shared dep is just bundled), and yields provenance by
> construction. It also reuses the entire Process stack — state, logs, billing hooks, project
> permissions — for free.

#### Serve — stream from the build's output dataset (`GET /plugin-assets/{hash}/{path:path}`)

The serve endpoint resolves `{hash}` → the `PluginVersion` → its **output dataset**, and streams
`{dataset_dir}/{path}` from the **project bucket** via fsspec, with
`Cache-Control: public, max-age=31536000, immutable`. The URL is content-addressed, so this caching
is **correct** — a new build is a different hash (different URL), no stale cache, mid-session users
keep their hash.

**Authorization is by plugin *visibility*, not project membership**: a `system` plugin streams to
any authenticated user; a `user` plugin only to its owner (who has project access anyway). This is
the one place serving deliberately crosses the project boundary — a system plugin built in one
project is readable by everyone. The plugin's bytes live as long as the output dataset's project
does: **deleting that project deletes the plugin** (acceptable, and moot for now — projects can't
be deleted yet, so no copy-to-durable-store or project-protection logic is built).

`content_hash` is computed **once at registration** and used purely as the URL token — the serve
path does **not** re-hash per request (trusts storage; DB assumed authoritative). MF chunk URLs
resolve **relative** to `remoteEntry.js`, so this single hash-prefixed route serves the whole
bundle. (Per-file presigned URLs are avoided — a signed query string breaks MF's relative chunk
resolution.)

This is the **same route backend-plugin frontends use** (`backend-hook-system.md`); those are built
by the plugin's `setup.py` at install and served from the package's `frontend_dist/`, but resolve
through the identical `/plugin-assets/{hash}/…` path, so the frontend loads both kinds
indistinguishably.

#### Delete — uninstall identity, retain versions (`DELETE /plugins/{id}`)

Removes the `Plugin` identity and its `PluginVersion` + `UserPlugin` rows (so it disappears from
everyone's `GET /plugins/me`). It does **not** touch the build **Process** or its **output
datasets** — those are normal project artefacts that stay in their project, so a re-register or a
fresh build is always possible. There is no blob GC to run: the bytes are dataset-owned and live
and die with their project (and projects can't be deleted yet).

`GET /plugins/me` is the endpoint the frontend calls at startup. It returns the **union** of:

- backend-bundled frontend plugins from `app.state.backend_frontend_plugins`
  (`source: "backend"`, always included — see `backend-hook-system.md` § *Merging into
  `GET /plugins/me`*), and
- the current user's enabled remote plugins (`source: "remote"`, `UserPlugin.enabled = true`),

each as `{ name, display_name, remote_url, source, upgrade_available }`, where for remote plugins
`remote_url` is the **user's pinned** version URL `/plugin-assets/{pinned content_hash}/remoteEntry.js`
(from `UserPlugin.plugin_version_id`) — *not* necessarily the latest — and `upgrade_available` is
`true` when the pin differs from the plugin's `latest_version_id`. Backend bundles always serve
their current installed version and set `upgrade_available: false`. If no backend plugins ship a
frontend bundle, the `"backend"` slice is simply empty and behaviour is unchanged.

When a remote plugin is first enabled by a user who has no `UserPlugin` row yet, the POST creates
the row with `enabled=True`. The frontend relies only on `GET /plugins/me` and the two
enable/disable endpoints (which apply to remote plugins only — backend bundles are not
user-toggleable).

**Admin gating prerequisite**: the `User` model currently has **no** `is_admin`/role/permission
field (`ProjectMember` is project-scoped with no role column). Registering a plugin as **system**
scope (`POST /plugins` with `scope: "system"`, and `DELETE` of a system plugin) requires adding a
simple `is_admin` boolean to `User` first — a small migration, called out here because it is a hard
dependency, not an afterthought. Running a build (`POST /plugins/build`) is gated by ordinary
**project membership**; registering a **user**-scope plugin is owner-gated (see
`user-installed-plugins-plan.md`). Backend plugins need no such gate: installing them is itself an
admin (server) action.

---

### 4.5 The `build_frontend_plugin` Process type

A new process type registered in `nagelfluh.process_types`, run in a pod like any other:

- **Parameters**: `{ npm_name, npm_version }`. The host's shared-singleton versions are injected by
  the runner (env/mounted manifest) — the plugin does not get to choose them.
- **Run**: `npm install <npm_name>@<npm_version>` in the pod, then build it as a Module Federation
  remote whose `shared` block is pinned to the **injected host versions** (the SDK ships the Vite
  federation preset that reads them). Non-shared dependencies are bundled normally.
- **Output dataset**: `dist` — the built `remoteEntry.js` + chunks, written as a **directory
  dataset** (a new mime, e.g. `application/x-mf-remote`) to the project bucket via `storage_context`.
  The built `package.json` (carrying `nagelfluh.remoteName` and `built_against`) is included so
  registration (§ 4.4) can read it back.
- **Failure**: an unsatisfiable host-version constraint, a broken source package, or a failing build
  script surfaces as a normal **process failure with logs** — no special-casing.

Because it is an ordinary Process: project **membership** controls who can build, the **billing
hooks** (`job_pre_run`/`job_completed`) charge the build like any job, and the **pod hardening** is
the same profile as inversions — registry-only egress (`PLUGIN_NPM_REGISTRY`), no secrets,
time/resource caps, no cluster-API access.

---

## Phase 5 — Plugin Management UI

### 5.1 Plugin list widget

**New file: `frontend/src/widgets/PluginManager.js`**

A new widget (registered in `App.js`) that shows a table of all available plugins with a
toggle per row (enabled/disabled for the current user), plus the user's **pinned version** and an
**Upgrade** action when `upgrade_available` is true. On toggle/upgrade, calls the relevant
endpoint and shows a "reload required" banner (since plugins are loaded once at startup).

The widget is added to the default layout inside a settings tab or accessible from a menu —
it does not need to be in the default initial layout.

### 5.2 TanStack Query hooks

Add to `frontend/src/datamodel/useQueries.js`:

```js
export function usePlugins() {
  return useQuery({ queryKey: ['plugins'], queryFn: () => api.get('/plugins/me') })
}

export function useEnablePlugin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: id => api.post(`/plugins/${id}/enable`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plugins'] }),
  })
}

export function useDisablePlugin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: id => api.post(`/plugins/${id}/disable`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plugins'] }),
  })
}

export function useUpgradePlugin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: id => api.post(`/plugins/${id}/upgrade`),   // re-pin to current latest
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plugins'] }),
  })
}
```

---

## Phase 6 — Plugin Author Guide

### File structure for a plugin

A plugin is a plain **source** npm package — no MF/Vite config, no pre-built `dist/`. Nagelfluh's
build harness federates it (§ 4.5), so the author only writes their extension code and a manifest:

```
my-nagelfluh-plugin/
  package.json        ← npm manifest: peerDependencies + nagelfluh.remoteName/entry
  src/
    index.js          ← entry point; registers everything as side effects
    MyDataset.js
    MyLayerType.js
    MyWidget.js
```

### `package.json` for a plugin

The package publishes **source** (the build is Nagelfluh's job). Shared deps go in
`peerDependencies` (the host provides them as MF singletons — the build pins them to the host's
exact versions); any other dependency is a normal `dependency` and gets bundled. The `nagelfluh`
block names the MF remote and points at the **source** entry module.

```jsonc
{
  "name": "@skytem/nagelfluh-plugin",        // npm package name; installed by name@version
  "version": "1.2.3",                         // exact, immutable on npm
  "peerDependencies": {
    "react": "^18.2.0", "react-dom": "^18.2.0", "gladly-plot": "^0.0.15"
  },
  "dependencies": { "some-lib": "^2.0.0" },   // bundled at build time
  "devDependencies": { "nagelfluh-plugin-sdk": "^1.0.0" },
  "nagelfluh": {
    "remoteName": "skytem_plugin",            // MF remote name == Plugin.name
    "entry": "src/index.js"                   // source entry the build harness exposes
  }
}
```

Publish with `npm publish` (ideally from CI **with provenance**). The author never runs an MF
build, hosts a bundle, or worries about CORS — they publish source; the `build_frontend_plugin`
Process (§ 4.5) produces and pins the served artefact.

### `src/index.js` for a plugin

```js
import {
  registerDatasetType, registerLayerType, registerWidget,
  registerAxisQuantityKind, registerPage, registerHook,
} from 'nagelfluh-plugin-sdk'

import { MyDataset }   from './MyDataset'
import { MyLayerType } from './MyLayerType'
import { MyWidget }    from './MyWidget'
import { MyPage }      from './MyPage'

// Keyed registries
registerDatasetType('application/x-my-format', MyDataset)
registerLayerType('MyLayerType', MyLayerType)
registerWidget('MyWidget', MyWidget)
registerAxisQuantityKind('my_unit', { label: 'My Unit', scale: 'linear' })
registerPage({ path: 'my-page', title: 'My Page', component: MyPage })

// Fan-out hooks — descriptor shape (plain objects the host interprets):
registerHook('nav_items',    () => [{ menuPath: 'tools', label: 'My Page', to: '/app/plugin/my-page' }])
registerHook('account_tabs', () => [{ id: 'my-tab', title: 'My Tab', content: <MyAccountSection /> }])

// Fan-out hooks — slot shape (JSX rendered inline by the host via hooks.run_jsx):
registerHook('process_actions', (processId) => [
  <button key="my-action" onClick={() => doThing(processId)}>My Action</button>,
])
```

A host (or another plugin) renders the slot contributions by calling `hooks.run_jsx` inside a
component — `<div>{hooks.run_jsx.process_actions(processId)}</div>`. Element results are
auto-keyed and error-boundary-wrapped, so a faulty callback degrades gracefully.

Everything above is registered as a **side effect of importing `index.js`** — no React hooks at
this level, which is why the menu entry is contributed via the `nav_items` *frontend hook* rather
than the host's React-only `useRegisterMenu`.

### A backend plugin's frontend is the identical npm package

A backend plugin (see `backend-hook-system.md`) consumes **exactly this same npm source package**.
The only difference is **when/where the build runs**: instead of a `build_frontend_plugin` Process
in a project, the plugin's **`setup.py` builds the source at `pip install` time** (backend plugins
are admin-installed and thus trusted, so building during install is fine) and ships the result as
package data. At startup the backend content-addresses that built dir and serves it from the same
`/plugin-assets/{content_hash}/…` path, with `source: "backend"` — no DB registration, no per-user
enable. The build is an `npm install` (so it needs network), but it runs at `pip install` time; the
built output ships in the package, so the **running server never runs npm**.

So a plugin author writes one frontend source package, publishes it once to npm, and it can be
consumed either as a standalone frontend plugin (built in a Process) or as the frontend half of a
backend plugin (built by its `setup.py` at install).

### Installing the plugin

The author runs `npm publish` (ideally from CI with `--provenance`). To install it, an admin/user
(1) runs a `build_frontend_plugin` Process for `{ npm_name, npm_version }` in a project they can
access, then (2) registers that build's output dataset via `POST /plugins` (§ 4.4). The backend
content-addresses the output and serves it from `/plugin-assets/{content_hash}/…`. The author never
hosts a bundle or worries about CORS — they publish source; Nagelfluh builds, pins, and serves.

---

## Implementation Order

1. **Phase 1** (Vite migration) — prerequisite for everything; self-contained, no backend
   changes, can be done and tested independently.
2. **Phase 2** (registries + page registry + frontend hook system, 2.1–2.6) — pure frontend
   refactor; 2.5/2.6 add the new page and hook infrastructure. Immediately follows Phase 1.
3. **Phase 4** (plugin registry + build) — new tables + routes + the `build_frontend_plugin`
   Process type (4.5). Reuses the existing Process/job/storage stack. Requires the `is_admin`
   prerequisite (4.4) for the *system*-scope register/delete, the SDK's federation preset for the
   build harness, and `PLUGIN_NPM_REGISTRY` for the build pod's egress.
4. **Phase 3** (MF loading infrastructure) — requires Phases 1 + 2 + 4 to be complete.
5. **Phase 5** (plugin management UI) — requires Phase 3 + 4.
6. **Phase 6** (plugin SDK + author guide) — written after Phases 1–3 confirm the shared dep
   resolution works correctly end-to-end.

**Backend-plugin frontends** (`backend-hook-system.md`: `register_routers`, `frontend_bundles`,
`mount_plugin_assets`) build directly on Phases 2–3: once the frontend extension API, MF loading,
and the build harness exist, the only backend additions are the two hooks and the **`setup.py`-time
build** of the declared npm source, plus merging `app.state.backend_frontend_plugins` into
`GET /plugins/me`. No new frontend work — they ride the exact same `/plugin-assets/{hash}` path.

## Open Questions

- **Plugin trust model & npm supply chain**: Registering a *system* plugin is admin-gated; running
  a build is project-membership-gated. Building **from source in a sandboxed Process** (the same pod
  isolation as inversions: registry-only egress, no secrets/DB, resource caps) means the backend
  never executes plugin build scripts itself, and yields **provenance by construction** — the served
  bytes are demonstrably derived from the `npm_name@npm_version` source we fetched, closing the
  "published tarball ≠ source" gap without needing attestation. Residual supply-chain risk is at
  build *time*: a freshly-compromised source version. Mitigations: **pin exact versions** (no
  ranges), review-before-register, prefer **scoped names**, and point `PLUGIN_NPM_REGISTRY` at a
  private registry for locked-down deployments. `content_hash` is computed at registration and used
  only as the URL token — **not** re-verified on serve; the DB and object storage are assumed not
  adversarially modified. Letting *users* register plugins is folded in via project scoping — see
  **`user-installed-plugins-plan.md`** (private + override-by-name keeps the blast radius
  self-contained; building in the user's own project carries the access + compute accounting).
- **Backend-plugin frontend trust**: backend plugins build their frontend **from their `setup.py`
  at `pip install` time**, not in a Process — acceptable because they are admin-installed (running
  `pip install` is already a privileged, trusted server action), so there is no additional
  code-execution boundary to cross. The build is an `npm install` and needs network, but at
  `pip install`/wheel-build time — the running app server never runs npm.
- **Two distinct version axes** — both resolved:
  - *Build version*: which bytes. Each registered build is a content-addressed `PluginVersion`
    pointing at an immutable output dataset. Each user is **pinned** at enable time to the
    then-latest version and upgrades explicitly (`POST /plugins/{id}/upgrade`); `npm_version` is the
    human-facing version. Downgrade/rollback = re-pin to an earlier version.
  - *Shared-dep compatibility*: whether the plugin loads in this host. **Constructed at build
    time** — the build pins `shared` to the host's exact versions, so an incompatible plugin
    **fails the build** (with logs) instead of being rejected at an API gate. `built_against` records
    those versions, so a later host upgrade can flag versions that warrant a **rebuild** (a new
    `PluginVersion`); users stay pinned until they upgrade. MF's runtime check is the final backstop.
- **Offline / air-gapped**: built assets live in project buckets (frontend plugins) or the
  package's `frontend_dist/` (backend plugins) and are served from `/plugin-assets/{hash}/…`, never
  re-fetched — backend plugins need no registry access at app startup (built during `pip install`).
  The only registry need is at **build** time (the Process pod, or `pip install`); point
  `PLUGIN_NPM_REGISTRY` at an internal mirror (Verdaccio / Artifactory) for air-gapped deployments.
- **Storage**: frontend-plugin bytes live in **project buckets** as ordinary output datasets (no new
  system store, no GC — they share the dataset/project lifecycle). Backend-plugin bytes live in the
  package's **`frontend_dist/`** on disk (built once at `pip install`); the backend content-addresses
  them for the URL and streams from the package dir — no system bucket or build cache needed. Open:
  whether to dedup a build dataset when the identical `(npm source, host versions)` is rebuilt in a
  *different* project.
