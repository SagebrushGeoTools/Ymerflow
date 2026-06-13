# Plugin System Plan

## Goal

Make the Nagelfluh frontend pluggable at runtime: plugins can register new dataset types, layer
types, widget types, and quantity kinds without modifying or rebuilding the main application.
Plugins are installed into the database and enabled/disabled per user.

## Architecture Summary

- **Build system**: Migrate from CRA (`react-scripts`) to Vite + `@module-federation/vite`
- **Plugin format**: Vite library builds compiled as Module Federation remotes (`remoteEntry.js`)
- **Shared deps**: React, react-dom, gladly-plot declared as MF singletons — one instance shared
  between host and all plugins
- **Registries**: Four explicit registries (dataset types, layer types, quantity kinds, widgets)
  replacing hardcoded switch statements and plain objects
- **Plugin lifecycle**: Admin installs a plugin (URL to `remoteEntry.js`) → stored in DB →
  users enable/disable per-account → frontend loads enabled plugins at startup via MF container API

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
  // plugins: [{ id, name, remote_url }]
  const remotes = plugins.map(p => ({
    name: p.name,
    entry: p.remote_url,   // URL to remoteEntry.js
  }))

  await ensureInit(remotes)

  await Promise.all(
    plugins.map(p => loadRemote(`${p.name}/index`))
    // each plugin's index.js calls registerDatasetType / registerWidget / etc. as side effects
  )
}
```

### 3.2 Gate rendering on plugin load

In `App.js`, fetch the user's enabled plugins from the API before rendering the layout:

```js
function App() {
  const [pluginsReady, setPluginsReady] = useState(false)
  const { data: enabledPlugins } = useEnabledPlugins()   // new TanStack Query hook

  useEffect(() => {
    if (!enabledPlugins) return
    loadPlugins(enabledPlugins).then(() => setPluginsReady(true))
  }, [enabledPlugins])

  if (!pluginsReady) return <LoadingScreen />

  const widgets = getWidgets()
  return <LayoutProvider widgets={widgets} ... />
}
```

This ensures all dataset types, layer types, and widgets are registered before any saved
layout is restored or any process output is rendered.

### 3.3 Plugin SDK package

To help plugin authors, provide a small npm package (or a documented template repo) that
re-exports the registration APIs at stable paths. This avoids coupling plugin source to the
host's internal file structure.

**Package: `nagelfluh-plugin-sdk`**

```js
// index.js — all registration APIs a plugin needs
export { registerDatasetType }    from 'nagelfluh/datamodel/datasetRegistry'
export { registerWidget }         from 'nagelfluh/widgets/widgetRegistry'
export { registerLayerType,
         registerAxisQuantityKind } from 'nagelfluh/plotRegistry'
```

These resolve via Module Federation to the host's own modules, so there is no separate bundle
— the SDK is a pure re-export shim. Plugin authors install it as a dev dependency and mark it
as external in their Vite config.

---

## Phase 4 — Backend Plugin Registry

### 4.1 `Plugin` model

**New file: `backend/models/plugin.py`**

```python
class Plugin(Base):
    __tablename__ = "plugins"

    id           = Column(UUID, primary_key=True, default=uuid4)
    name         = Column(String(255), unique=True, nullable=False)   # MF remote name
    display_name = Column(String(255), nullable=False)
    description  = Column(Text, nullable=True)
    remote_url   = Column(String(1024), nullable=False)               # URL to remoteEntry.js
    version      = Column(String(64), nullable=True)
    created_at   = Column(DateTime, default=datetime.utcnow)
    created_by   = Column(Integer, ForeignKey("users.id"), nullable=True)

    user_plugins  = relationship("UserPlugin", back_populates="plugin",
                                 cascade="all, delete-orphan")
```

`name` is the Module Federation remote name (must be a valid JS identifier, e.g.
`"skytem_plugin"`). `remote_url` points to the plugin's hosted `remoteEntry.js`.

### 4.2 `UserPlugin` model

Per-user installation/enable state in the same file or `backend/models/user_plugin.py`:

```python
class UserPlugin(Base):
    __tablename__ = "user_plugins"

    id           = Column(UUID, primary_key=True, default=uuid4)
    user_id      = Column(Integer, ForeignKey("users.id"), nullable=False)
    plugin_id    = Column(UUID, ForeignKey("plugins.id"), nullable=False)
    enabled      = Column(Boolean, default=True, nullable=False)
    installed_at = Column(DateTime, default=datetime.utcnow)

    user   = relationship("User",   back_populates="plugins")
    plugin = relationship("Plugin", back_populates="user_plugins")

    __table_args__ = (UniqueConstraint("user_id", "plugin_id"),)
```

Add the reverse relationship to `User`:

```python
plugins = relationship("UserPlugin", back_populates="user", cascade="all, delete-orphan")
```

### 4.3 Alembic migration

```
alembic -c backend/alembic.ini revision -m "add plugin and user_plugin tables"
```

The migration creates both tables. No changes to existing tables except adding the `plugins`
relationship to `User` (no column change required, pure ORM relationship).

### 4.4 API endpoints

**New file: `backend/routers/plugins.py`**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/plugins` | any user | List all installed plugins |
| `POST` | `/plugins` | admin | Register a new plugin |
| `DELETE` | `/plugins/{id}` | admin | Remove a plugin (and all user records) |
| `GET` | `/plugins/me` | current user | List plugins with user's enabled state |
| `POST` | `/plugins/{id}/enable` | current user | Enable plugin for self |
| `POST` | `/plugins/{id}/disable` | current user | Disable plugin for self |

`GET /plugins/me` is the endpoint the frontend calls at startup. It returns the list of plugins
where `enabled = true` for the current user, with `remote_url` and `name` fields.

When a plugin is first enabled by a user who has no `UserPlugin` row yet, the POST creates the
row with `enabled=True`. The frontend relies only on `GET /plugins/me` and the two
enable/disable endpoints.

Admin status can initially be a simple `is_admin` boolean on the `User` model, or reuse the
existing permissions pattern if one exists.

---

## Phase 5 — Plugin Management UI

### 5.1 Plugin list widget

**New file: `frontend/src/widgets/PluginManager.js`**

A new widget (registered in `App.js`) that shows a table of all available plugins with a
toggle per row (enabled/disabled for the current user). On toggle, calls the enable/disable
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
```

---

## Phase 6 — Plugin Author Guide

### File structure for a plugin

```
my-nagelfluh-plugin/
  vite.config.js
  package.json
  src/
    index.js          ← entry point; registers everything as side effects
    MyDataset.js
    MyLayerType.js
    MyWidget.js
```

### `vite.config.js` for a plugin

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { federation } from '@module-federation/vite'

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'my_plugin',            // must match Plugin.name in DB
      filename: 'remoteEntry.js',
      exposes: {
        './index': './src/index.js',
      },
      shared: {
        react:         { singleton: true, requiredVersion: '^18.2.0' },
        'react-dom':   { singleton: true, requiredVersion: '^18.2.0' },
        'gladly-plot': { singleton: true, requiredVersion: '^0.0.15' },
      },
    }),
  ],
  build: {
    target: 'esnext',
    outDir: 'dist',
  },
})
```

### `src/index.js` for a plugin

```js
import { registerDatasetType }      from 'nagelfluh-plugin-sdk'
import { registerLayerType }        from 'nagelfluh-plugin-sdk'
import { registerWidget }           from 'nagelfluh-plugin-sdk'
import { registerAxisQuantityKind } from 'nagelfluh-plugin-sdk'

import { MyDataset }   from './MyDataset'
import { MyLayerType } from './MyLayerType'
import { MyWidget }    from './MyWidget'

registerDatasetType('application/x-my-format', MyDataset)
registerLayerType('MyLayerType', MyLayerType)
registerWidget('MyWidget', MyWidget)
registerAxisQuantityKind('my_unit', { label: 'My Unit', scale: 'linear' })
```

### Serving the plugin

The built `dist/remoteEntry.js` (and its chunks) must be served from a stable HTTPS URL
accessible by the user's browser. Options:

- Static hosting (S3, GCS, nginx) — simplest
- Self-hosted alongside a custom environment Docker image's companion web server
- The Nagelfluh backend could optionally serve plugin assets if uploaded (future extension)

The admin registers the plugin by POSTing `{ name, display_name, remote_url }` to
`POST /plugins` where `remote_url` is the URL to `remoteEntry.js`.

---

## Implementation Order

1. **Phase 1** (Vite migration) — prerequisite for everything; self-contained, no backend
   changes, can be done and tested independently.
2. **Phase 2** (registries) — pure frontend refactor, no new behaviour, immediately follows
   Phase 1.
3. **Phase 4** (backend plugin registry) — can be done in parallel with Phases 1–2; purely
   additive (new tables + routes).
4. **Phase 3** (MF loading infrastructure) — requires Phases 1 + 2 + 4 to be complete.
5. **Phase 5** (plugin management UI) — requires Phase 3 + 4.
6. **Phase 6** (plugin SDK + author guide) — written after Phases 1–3 confirm the shared dep
   resolution works correctly end-to-end.

## Open Questions

- **Plugin trust model**: Should any authenticated user be able to register a plugin, or only
  admins? A user-submitted `remote_url` pointing to malicious JS would run in every enabled
  user's browser. Admin-only registration is strongly recommended.
- **Plugin versioning**: `Plugin.version` is informational only in this plan. If strict version
  pinning is needed (e.g. a plugin built against gladly 0.0.15 loaded by a host running
  0.0.20), Module Federation's `requiredVersion` constraint will reject mismatches. Decide
  whether to surface this as a hard error or a warning.
- **Offline / air-gapped**: If plugin assets must be served from the same host as the backend,
  add an upload endpoint that stores plugin JS in MinIO and serves it via the backend. The
  `remote_url` would then point to a local `/plugin-assets/{id}/remoteEntry.js` endpoint.
