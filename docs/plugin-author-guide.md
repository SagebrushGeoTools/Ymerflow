# Plugin Author Guide

Nagelfluh is pluggable at runtime. A plugin is a plain **npm source package** — no Module
Federation config, no pre-built `dist/`. Nagelfluh *builds* it (running the real `npm`/`vite`
resolver) against the host's exact shared-dependency versions, then serves and loads it. You write
only your extension code and a small manifest.

There are two delivery mechanisms that converge on the **same frontend artifact**:

| | Frontend plugin | Backend plugin |
|---|---|---|
| Packaged as | npm source package | pip-installed Python package (also ships an npm frontend source) |
| Built | in a `build_frontend_plugin` Process (pod), output dataset in the project bucket | at `pip install` time, from the plugin's `setup.py` |
| Can provide | frontend extensions only | frontend extensions **and** backend models/hooks/routers |

Both register through the **same** `registerHook` API and serve content-addressed from
`/plugin-assets/{content_hash}/…`.

---

## File structure

```
my-nagelfluh-plugin/
  package.json        ← npm manifest: peerDependencies + nagelfluh.remoteName/entry
  src/
    index.js          ← entry point; registers everything as side effects
    MyDataset.js
    MyLayerType.js
    MyWidget.js
```

## `package.json`

Shared deps go in `peerDependencies` (the host provides them as MF singletons — the build pins them
to the host's exact versions); any other dependency is a normal `dependency` and gets bundled. The
`nagelfluh` block names the MF remote and points at the **source** entry module.

```jsonc
{
  "name": "@skytem/nagelfluh-plugin",
  "version": "1.2.3",
  "peerDependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "dependencies": { "some-lib": "^2.0.0" },
  "devDependencies": { "nagelfluh-plugin-sdk": "^1.0.0" },
  "nagelfluh": {
    "remoteName": "skytem_plugin",   // MF remote name == Plugin.name
    "entry": "src/index.js"          // source entry the build harness exposes
  }
}
```

You never write a Vite or Module-Federation config: the build harness
(`nagelfluh_plugin_build`) owns it. It scaffolds a `vite.config.js` whose `shared` block is pinned
to the host's exact singleton versions injected at build time.

The SDK also ships that same Module-Federation config as a reusable preset,
`nagelfluh-plugin-sdk/vite-preset` (`nagelfluhFederation({ name, entry })` plus the pure
`sharedConfig` / `hostSharedVersions` helpers). The preset is the documented, single source of truth
for the federation `shared` shape; `tests/test_vite_preset_consistency.py` asserts it and the
harness emit an identical `shared` block (and that the SDK's `DEFAULT_SHARED` equals the harness's
`HOST_SHARED_VERSIONS`), so the two can never silently drift. Use the preset directly only if you
build your plugin yourself outside the harness — for the normal flow (a `build_frontend_plugin`
Process, or a backend plugin's `setup.py`) the harness generates the config for you.

## `src/index.js`

Everything is registered as a **side effect of importing `index.js`** through a single API,
`registerHook`. The host's collectors translate each hook's results into whatever internal
structure they need (Maps, gladly-plot calls, router entries).

```js
import { registerHook } from 'nagelfluh-plugin-sdk'

import { MyDataset }   from './MyDataset'
import { MyLayerType } from './MyLayerType'
import { MyWidget }    from './MyWidget'
import { MyPage }      from './MyPage'

registerHook('dataset_types',  () => [{ mimeType: 'application/x-my-format', cls: MyDataset }])
registerHook('layer_types',    () => [{ name: 'MyLayerType', layerClass: MyLayerType }])
registerHook('widgets',        () => [{ name: 'MyWidget', component: MyWidget }])
registerHook('quantity_kinds', () => [{ name: 'my_unit', descriptor: { label: 'My Unit', scale: 'linear' } }])
registerHook('pages',          () => [{ path: 'my-page', title: 'My Page', component: MyPage }])
registerHook('nav_items',      () => [{ menuPath: 'tools', label: 'My Page', to: '/app/plugin/my-page' }])
```

### Available hook points

| Hook | Shape | Each callback returns |
|---|---|---|
| `dataset_types` | keyed | `[{ mimeType, cls }]` |
| `widgets` | keyed | `[{ name, component }]` |
| `layer_types` | keyed | `[{ name, layerClass }]` |
| `quantity_kinds` | keyed | `[{ name, descriptor }]` |
| `pages` | keyed | `[{ path, component, title }]` |
| `app_providers` | jsx | `[{ Component }]` |
| `app_routes` | jsx | `[{ path, element }]` |
| `nav_items` | jsx | `[{ menuPath, label, to \| onSelect }]` |
| `account_tabs` | jsx | `[{ id, title, content }]` |
| `process_actions` | jsx slot | `[<button .../>, …]` |
| `plot_overlays` | jsx slot | `[<Overlay .../>, …]` |

---

## Distributing & building

### As a frontend plugin (built in a Process)

1. Make your package resolvable to the build. The build resolves `name@version` from a
   **server-local directory and/or the public npm registry**, controlled by
   `PLUGIN_NPM_SOURCE_MODE` (`auto` = local-first then registry; `local`; `registry`):
   - **Published to npm** (`auto`/`registry`): just `npm publish` and reference it by `name@version`.
   - **Server-local** (`auto`/`local`, for testing or air-gapped): drop a tarball in
     `PLUGIN_NPM_SOURCE_DIR`:
     ```bash
     npm pack ./my-nagelfluh-plugin       # -> skytem-nagelfluh-plugin-1.2.3.tgz
     cp skytem-nagelfluh-plugin-1.2.3.tgz "$PLUGIN_NPM_SOURCE_DIR"/
     ```
   In `auto` mode a local file overrides the registry for that exact `name@version`.

2. A user starts a build and registers it:
   ```
   POST /plugins/build  { project_id, environment_id, npm_name, npm_version }
   # poll the returned process until done, then:
   POST /plugins        { process_id, process_version, scope: "user" }
   ```
   `POST /plugins/build` runs a `build_frontend_plugin` Process; its output dataset (the built
   `dist/`) lands in the project bucket. `POST /plugins` reads the built `package.json` for
   `nagelfluh.remoteName` + `built_against`, computes a `content_hash`, and creates the
   `Plugin` + `PluginVersion` rows.

3. A user enables it: `POST /plugins/{id}/enable` pins them to the current latest version. From then
   on `GET /plugins/me` lists it with `source: "remote"` and a `base_url` of
   `/plugin-assets/{content_hash}/`, and the frontend MF-loads it at startup.

You can also build locally without a cluster (for testing) — the build routine is standalone:
```bash
python -m nagelfluh_plugin_build @skytem/nagelfluh-plugin 1.2.3 ./out --source "$PLUGIN_NPM_SOURCE_DIR"
```

### As the frontend half of a backend plugin (built at `pip install`)

A backend plugin consumes **exactly the same** npm source package. Its `setup.py` builds the source
at install time via a `build_py` command that calls the shared routine and ships the result as
package data:

```python
from setuptools import setup
from setuptools.command.build_py import build_py
from nagelfluh_plugin_build import build_frontend

class BuildWithFrontend(build_py):
    def run(self):
        build_frontend(npm_name='@skytem/nagelfluh-plugin', npm_version='1.2.3',
                       out_dir='my_backend_plugin/frontend_dist')
        super().run()

setup(
    name='my-backend-plugin',
    cmdclass={'build_py': BuildWithFrontend},
    package_data={'my_backend_plugin': ['frontend_dist/**/*']},
    entry_points={'nagelfluh.hooks': [
        'frontend_bundles = my_backend_plugin:frontend_bundles',
        'register_routers = my_backend_plugin:register_routers',
    ]},
)
```

The running server never runs npm — the built output ships in the package and is content-addressed
and served from the identical `/plugin-assets/{content_hash}/…` path, so the frontend loads both
kinds indistinguishably.
