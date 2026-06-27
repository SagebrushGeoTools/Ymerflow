"""The shared frontend-plugin build routine.

``build_frontend(npm_name, npm_version, out_dir, shared_versions=None, npm_source_dir=None,
registry=None, mode=None)`` resolves the npm package — from a server-local source directory and/or
the public npm registry (see :func:`resolve_npm_source` and ``PLUGIN_NPM_SOURCE_MODE``) — installs
it with ``npm install``, generates a Module-Federation Vite config whose ``shared`` block is pinned
to the host's exact singleton versions, runs ``vite build``, and copies the resulting MF remote
(``remoteEntry.js`` + chunks + a ``package.json`` carrying ``nagelfluh.remoteName`` and
``built_against``) into ``out_dir``.

Source resolution supports BOTH delivery mechanisms (see docs/plans/plugin-npm-source-resolution-plan.md):
  * a server-local directory the admin populates (``.tgz`` tarballs or source dirs) — used for
    tests and air-gapped deployments, and
  * the public npm registry (or a configured private mirror) — the production default.
``PLUGIN_NPM_SOURCE_MODE`` (``auto`` | ``local`` | ``registry``) chooses between them; ``auto`` is
local-first then registry.

Everything here is stdlib-only so it can be imported by the backend, the pod runner, and a
plugin ``setup.py`` without dragging in heavy dependencies.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile


class PluginBuildError(Exception):
    """A frontend-plugin build failed. The message is suitable for surfacing in logs/UI."""
    pass


# Host shared-singleton versions injected into every plugin build's MF `shared` config.
# These mirror frontend/vite.config.js. Kept here as the single source of truth so the build
# pins plugins to exactly what the host ships. Callers may override via `shared_versions`.
HOST_SHARED_VERSIONS = {
    "react": "18.2.0",
    "react-dom": "18.2.0",
    "@tanstack/react-query": "5.90.19",
}

# Build toolchain versions used to scaffold the build (NOT shared with the host bundle).
_BUILD_TOOLCHAIN = {
    "vite": "^8.1.0",
    "@vitejs/plugin-react": "^6.0.3",
    "@module-federation/vite": "^1.16.10",
}

# Default server-local npm source directory (admin-populated, e.g. via `npm pack`).
# Overridable per call and via the PLUGIN_NPM_SOURCE_DIR environment variable.
DEFAULT_NPM_SOURCE_DIR = os.environ.get(
    "PLUGIN_NPM_SOURCE_DIR", "/var/lib/nagelfluh/plugin-npm-source"
)

# Public npm registry used when resolving from the registry (or a configured private mirror).
DEFAULT_NPM_REGISTRY = "https://registry.npmjs.org"

# Source resolution mode: "auto" (local-first then registry), "local" (local only — error if
# absent), or "registry" (registry only — ignore the local dir). Overridable per call and via env.
DEFAULT_NPM_SOURCE_MODE = os.environ.get("PLUGIN_NPM_SOURCE_MODE", "auto")


def _log(msg):
    print(f"[plugin-build] {msg}", flush=True)


def _resolve_local(npm_name, npm_version, npm_source_dir):
    """Return an absolute local path (``.tgz`` or source dir) for ``name@version``, or ``None``.

    The admin populates ``npm_source_dir`` ahead of time, either with:
      * a packed tarball ``<safe-name>-<version>.tgz`` (output of ``npm pack``), or
      * an unpacked source directory ``<safe-name>-<version>/`` (or ``<safe-name>/``).

    Scoped names (``@scope/pkg``) are normalised the same way npm packs them: ``scope-pkg``.
    """
    if not npm_source_dir or not os.path.isdir(npm_source_dir):
        return None
    # npm pack naming: @scope/name -> scope-name-<version>.tgz
    safe = npm_name.lstrip("@").replace("/", "-")
    candidates = [
        os.path.join(npm_source_dir, f"{safe}-{npm_version}.tgz"),
        os.path.join(npm_source_dir, f"{safe}-v{npm_version}.tgz"),
        os.path.join(npm_source_dir, f"{safe}-{npm_version}"),
        os.path.join(npm_source_dir, safe),
    ]
    for c in candidates:
        if os.path.exists(c):
            return os.path.abspath(c)
    return None


def _fetch_from_registry(npm_name, npm_version, registry, dest_dir):
    """Download ``name@version`` from the npm registry as a tarball via ``npm pack``.

    Returns the absolute path of the downloaded ``.tgz`` (which downstream treats exactly like an
    admin-placed local tarball, so the rest of the build pipeline is identical for both sources).
    """
    os.makedirs(dest_dir, exist_ok=True)
    spec = f"{npm_name}@{npm_version}"
    cmd = ["npm", "pack", spec, "--no-audit", "--no-fund", "--pack-destination", dest_dir]
    if registry:
        cmd += ["--registry", registry]
    try:
        _run(cmd, cwd=dest_dir)
    except PluginBuildError as e:
        raise PluginBuildError(
            f"Failed to fetch {spec} from the npm registry "
            f"({registry or DEFAULT_NPM_REGISTRY}). Verify the package name/version is published "
            f"and the registry is reachable.\n{e}"
        )
    tarballs = [f for f in os.listdir(dest_dir) if f.endswith(".tgz")]
    if not tarballs:
        raise PluginBuildError(f"`npm pack {spec}` produced no tarball in {dest_dir!r}.")
    tarballs.sort(key=lambda f: os.path.getmtime(os.path.join(dest_dir, f)))
    return os.path.join(dest_dir, tarballs[-1])


def resolve_npm_source(npm_name, npm_version, npm_source_dir=None, mode=None,
                       registry=None, download_dir=None):
    """Resolve ``name@version`` to an installable tarball/dir path, from a server-local directory
    and/or the public npm registry.

    ``mode`` (or ``PLUGIN_NPM_SOURCE_MODE``):
      * ``"auto"`` (default) — try the server-local source dir first, then the registry.
      * ``"local"`` — server-local ONLY; raise if absent (offline / air-gapped / tests).
      * ``"registry"`` — registry ONLY; ignore the local dir.

    For the registry path, the package is downloaded via ``npm pack`` into ``download_dir`` (a temp
    dir is created if not given) and the resulting tarball path is returned, so downstream handling
    is identical to a local tarball.

    Returns an absolute path (a ``.tgz`` or a directory) that ``npm install`` can consume.
    """
    mode = (mode or DEFAULT_NPM_SOURCE_MODE or "auto").lower()
    if mode not in ("auto", "local", "registry"):
        raise PluginBuildError(
            f"Invalid npm source mode {mode!r} (PLUGIN_NPM_SOURCE_MODE); expected "
            f"'auto', 'local', or 'registry'."
        )
    npm_source_dir = npm_source_dir or DEFAULT_NPM_SOURCE_DIR
    registry = registry or os.environ.get("PLUGIN_NPM_REGISTRY") or DEFAULT_NPM_REGISTRY

    if mode in ("auto", "local"):
        local = _resolve_local(npm_name, npm_version, npm_source_dir)
        if local:
            _log(f"resolved {npm_name}@{npm_version} -> {local} (local source dir)")
            return local
        if mode == "local":
            available = (
                sorted(os.listdir(npm_source_dir)) if os.path.isdir(npm_source_dir)
                else "(directory does not exist)"
            )
            raise PluginBuildError(
                f"Could not resolve {npm_name}@{npm_version} in local source dir "
                f"{npm_source_dir!r} (PLUGIN_NPM_SOURCE_MODE=local). Available: {available}. "
                f"Populate the dir with `npm pack` tarballs/source dirs, or use mode 'auto'/'registry'."
            )
        _log(f"{npm_name}@{npm_version} not found locally; falling back to registry (mode=auto)")

    # mode == "registry", or "auto" with no local match
    if download_dir is None:
        download_dir = tempfile.mkdtemp(prefix="nf-plugin-fetch-")
    tarball = _fetch_from_registry(npm_name, npm_version, registry, download_dir)
    _log(f"resolved {npm_name}@{npm_version} -> {tarball} (registry {registry})")
    return tarball


def _read_pkg_manifest(source_path):
    """Read the plugin's package.json from a resolved source path (tarball or dir)."""
    if os.path.isdir(source_path):
        pkg_path = os.path.join(source_path, "package.json")
        if os.path.exists(pkg_path):
            with open(pkg_path) as f:
                return json.load(f)
        raise PluginBuildError(f"No package.json in source dir {source_path!r}")

    # Tarball — read package/package.json without extracting everything.
    import tarfile

    with tarfile.open(source_path, "r:*") as tar:
        member = None
        for name in ("package/package.json", "./package/package.json"):
            try:
                member = tar.getmember(name)
                break
            except KeyError:
                continue
        if member is None:
            raise PluginBuildError(f"No package/package.json in tarball {source_path!r}")
        f = tar.extractfile(member)
        return json.loads(f.read().decode("utf-8"))


def _shared_block(shared_versions):
    """Render the MF `shared` config object as a JS literal pinned to host versions."""
    entries = []
    for name, version in shared_versions.items():
        entries.append(
            f"    {json.dumps(name)}: {{ singleton: true, requiredVersion: {json.dumps(version)} }}"
        )
    return "{\n" + ",\n".join(entries) + "\n  }"


def _write_build_scaffold(build_dir, source_path, plugin_pkg, remote_name, entry, shared_versions):
    """Write package.json + vite.config.js into a scratch build directory."""
    # The scaffold package.json depends on the plugin source (installed locally) plus the
    # build toolchain. The plugin's own non-shared deps come along transitively.
    scaffold_pkg = {
        "name": "nagelfluh-plugin-build-scaffold",
        "version": "0.0.0",
        "private": True,
        "type": "module",
        "dependencies": {
            plugin_pkg["name"]: source_path,
        },
        "devDependencies": dict(_BUILD_TOOLCHAIN),
    }
    with open(os.path.join(build_dir, "package.json"), "w") as f:
        json.dump(scaffold_pkg, f, indent=2)

    # The MF remote re-exposes the plugin's source entry module. We import the package by name
    # and re-export through a tiny shim so the federation `exposes` map points at local source.
    shim = (
        f"// Auto-generated by nagelfluh_plugin_build — re-exposes the plugin entry.\n"
        f"export * from {json.dumps(plugin_pkg['name'] + '/' + entry.lstrip('./'))};\n"
        f"import {json.dumps(plugin_pkg['name'] + '/' + entry.lstrip('./'))};\n"
    )
    os.makedirs(os.path.join(build_dir, "src"), exist_ok=True)
    with open(os.path.join(build_dir, "src", "index.js"), "w") as f:
        f.write(shim)

    # Vite requires an HTML entry; the real output is remoteEntry.js. main.js just imports the shim.
    with open(os.path.join(build_dir, "src", "main.js"), "w") as f:
        f.write("// HTML entry placeholder — the MF remoteEntry.js is the real build output.\n"
                "import './index.js'\n")
    with open(os.path.join(build_dir, "index.html"), "w") as f:
        f.write(
            "<!DOCTYPE html>\n<html><head><meta charset=\"UTF-8\" />"
            f"<title>{remote_name}</title></head>\n"
            "<body><div id=\"root\"></div>"
            "<script type=\"module\" src=\"/src/main.js\"></script></body></html>\n"
        )

    vite_config = f"""import {{ defineConfig }} from 'vite'
import react from '@vitejs/plugin-react'
import {{ federation }} from '@module-federation/vite'

export default defineConfig({{
  plugins: [
    react(),
    federation({{
      name: {json.dumps(remote_name)},
      filename: 'remoteEntry.js',
      dts: false,
      exposes: {{
        './index': './src/index.js',
      }},
      shared: {_shared_block(shared_versions)},
    }}),
  ],
  build: {{
    target: 'esnext',
    outDir: 'dist',
    emptyOutDir: true,
  }},
}})
"""
    with open(os.path.join(build_dir, "vite.config.js"), "w") as f:
        f.write(vite_config)

    # The package.json that ships INSIDE dist/, read at registration time.
    dist_manifest = {
        "name": plugin_pkg["name"],
        "version": plugin_pkg.get("version", "0.0.0"),
        "nagelfluh": {
            "remoteName": remote_name,
            "entry": entry,
        },
        "built_against": shared_versions,
    }
    with open(os.path.join(build_dir, "plugin-manifest.json"), "w") as f:
        json.dump(dist_manifest, f, indent=2)


def _run(cmd, cwd, env=None):
    _log("$ " + " ".join(cmd) + f"   (cwd={cwd})")
    proc = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True)
    if proc.stdout:
        print(proc.stdout, flush=True)
    if proc.stderr:
        print(proc.stderr, file=sys.stderr, flush=True)
    if proc.returncode != 0:
        raise PluginBuildError(
            f"Command failed ({proc.returncode}): {' '.join(cmd)}\n{proc.stderr[-2000:]}"
        )


def build_frontend(npm_name, npm_version, out_dir,
                   shared_versions=None, npm_source_dir=None, registry=None, mode=None):
    """Build a Nagelfluh frontend plugin into ``out_dir`` as an MF remote.

    Parameters
    ----------
    npm_name, npm_version : str
        The plugin package to build, resolved via :func:`resolve_npm_source` (server-local dir
        and/or the npm registry, per ``mode``).
    out_dir : str
        Where the built ``dist/`` (remoteEntry.js + chunks + package.json) is written.
    shared_versions : dict | None
        ``{pkgName: version}`` pinned into the MF ``shared`` config. Defaults to
        :data:`HOST_SHARED_VERSIONS`.
    npm_source_dir : str | None
        Server-local directory holding plugin tarballs / source dirs. Defaults to
        ``PLUGIN_NPM_SOURCE_DIR`` env or :data:`DEFAULT_NPM_SOURCE_DIR`.
    registry : str | None
        npm registry used to fetch the plugin source (in ``registry``/``auto`` mode) AND the build
        toolchain / non-shared deps. Defaults to ``PLUGIN_NPM_REGISTRY`` env or
        :data:`DEFAULT_NPM_REGISTRY`.
    mode : str | None
        ``"auto"`` | ``"local"`` | ``"registry"``. Defaults to ``PLUGIN_NPM_SOURCE_MODE`` env or
        ``"auto"``.

    Returns
    -------
    dict
        ``{"remote_name", "built_against", "out_dir", "npm_name", "npm_version", "source"}``.
    """
    shared_versions = dict(shared_versions or HOST_SHARED_VERSIONS)
    registry = registry or os.environ.get("PLUGIN_NPM_REGISTRY") or DEFAULT_NPM_REGISTRY
    mode = mode or DEFAULT_NPM_SOURCE_MODE

    build_dir = tempfile.mkdtemp(prefix="nf-plugin-build-")
    try:
        # Resolve the plugin source (local tarball/dir or registry download). Registry downloads
        # land under build_dir so they are cleaned up with everything else.
        source_path = resolve_npm_source(
            npm_name, npm_version,
            npm_source_dir=npm_source_dir, mode=mode, registry=registry,
            download_dir=os.path.join(build_dir, "_download"),
        )
        plugin_pkg = _read_pkg_manifest(source_path)

        if plugin_pkg.get("name") != npm_name:
            raise PluginBuildError(
                f"Resolved source declares name {plugin_pkg.get('name')!r} but {npm_name!r} requested."
            )

        nf = plugin_pkg.get("nagelfluh") or {}
        remote_name = nf.get("remoteName")
        if not remote_name:
            raise PluginBuildError(
                f"Plugin {npm_name!r} package.json has no nagelfluh.remoteName — cannot build an MF remote."
            )
        entry = nf.get("entry", "src/index.js")

        # MF `shared` may only reference packages the plugin actually depends on — sharing a module
        # the plugin doesn't import fails the build. Intersect the host shared set with the plugin's
        # declared peer/regular deps. The recorded `built_against` reflects exactly what was pinned.
        declared = set(plugin_pkg.get("peerDependencies", {})) | set(plugin_pkg.get("dependencies", {}))
        effective_shared = {k: v for k, v in shared_versions.items() if k in declared}
        if not effective_shared:
            # Always at least share react if the plugin is a React plugin (the common case).
            effective_shared = {k: v for k, v in shared_versions.items() if k in ("react", "react-dom")}

        _write_build_scaffold(build_dir, source_path, plugin_pkg, remote_name, entry, effective_shared)

        env = dict(os.environ)
        # --prefer-offline: use the npm cache when present, only hitting the network for misses.
        # The runner image warms this cache at build time, so an in-pod build of a baked plugin
        # needs no registry egress.
        npm_install = ["npm", "install", "--no-audit", "--no-fund", "--prefer-offline"]
        if registry:
            npm_install += ["--registry", registry]
        _run(npm_install, cwd=build_dir, env=env)

        _run(["npx", "--no-install", "vite", "build"], cwd=build_dir, env=env)

        dist = os.path.join(build_dir, "dist")
        if not os.path.exists(os.path.join(dist, "remoteEntry.js")):
            raise PluginBuildError(
                f"Build produced no remoteEntry.js in {dist} — federation build failed."
            )

        # Embed the manifest package.json into dist/ so registration can read remoteName +
        # built_against back. Written from Python (robust against vite temp-dir __dirname quirks).
        shutil.copyfile(
            os.path.join(build_dir, "plugin-manifest.json"),
            os.path.join(dist, "package.json"),
        )

        # Copy dist/ -> out_dir
        if os.path.exists(out_dir):
            shutil.rmtree(out_dir)
        shutil.copytree(dist, out_dir)
        _log(f"wrote built remote '{remote_name}' to {out_dir}")

        # Report which delivery mechanism actually supplied the source (registry downloads land
        # under build_dir/_download; anything else came from the local source dir).
        source_kind = "registry" if source_path.startswith(os.path.join(build_dir, "_download")) else "local"

        return {
            "remote_name": remote_name,
            "built_against": effective_shared,
            "out_dir": out_dir,
            "npm_name": npm_name,
            "npm_version": npm_version,
            "source": source_kind,
        }
    finally:
        shutil.rmtree(build_dir, ignore_errors=True)


def main(argv=None):
    """CLI: ``python -m nagelfluh_plugin_build <name> <version> <out_dir> [--source DIR]``."""
    import argparse

    p = argparse.ArgumentParser(description="Build a Nagelfluh frontend plugin (MF remote).")
    p.add_argument("npm_name")
    p.add_argument("npm_version")
    p.add_argument("out_dir")
    p.add_argument("--source", dest="npm_source_dir", default=None,
                   help="Server-local npm source dir (default: PLUGIN_NPM_SOURCE_DIR)")
    p.add_argument("--mode", choices=["auto", "local", "registry"], default=None,
                   help="Source resolution mode (default: PLUGIN_NPM_SOURCE_MODE or 'auto')")
    p.add_argument("--registry", default=None,
                   help="npm registry for plugin source (registry/auto mode) + build toolchain "
                        "(default: PLUGIN_NPM_REGISTRY or registry.npmjs.org)")
    args = p.parse_args(argv)

    result = build_frontend(
        args.npm_name, args.npm_version, args.out_dir,
        npm_source_dir=args.npm_source_dir, registry=args.registry, mode=args.mode,
    )
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
