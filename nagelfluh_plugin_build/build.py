"""The shared frontend-plugin build routine.

``build_frontend(npm_name, npm_version, out_dir, shared_versions=None, npm_source_dir=None)``
resolves the npm package from a server-local source directory, installs it with ``npm install``
(pointed at that local source, NOT the public registry), generates a Module-Federation Vite config
whose ``shared`` block is pinned to the host's exact singleton versions, runs ``vite build``, and
copies the resulting MF remote (``remoteEntry.js`` + chunks + a ``package.json`` carrying
``nagelfluh.remoteName`` and ``built_against``) into ``out_dir``.

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


def _log(msg):
    print(f"[plugin-build] {msg}", flush=True)


def resolve_npm_source(npm_name, npm_version, npm_source_dir=None):
    """Resolve ``name@version`` to an installable path inside the server-local source directory.

    The admin populates ``npm_source_dir`` ahead of time, either with:
      * a packed tarball ``<safe-name>-<version>.tgz`` (output of ``npm pack``), or
      * an unpacked source directory ``<safe-name>-<version>/`` (or ``<safe-name>/``).

    Scoped names (``@scope/pkg``) are normalised the same way npm packs them:
    ``@scope/pkg`` -> ``scope-pkg``.

    Returns an absolute path (to a ``.tgz`` or a directory) that ``npm install`` can consume.
    Raises :class:`PluginBuildError` if nothing matches — we NEVER fall back to the public
    registry for the plugin source.
    """
    npm_source_dir = npm_source_dir or DEFAULT_NPM_SOURCE_DIR
    if not npm_source_dir or not os.path.isdir(npm_source_dir):
        raise PluginBuildError(
            f"Plugin npm source directory does not exist: {npm_source_dir!r}. "
            f"Set PLUGIN_NPM_SOURCE_DIR (or pass npm_source_dir) to a directory the admin has "
            f"populated with packed tarballs (`npm pack`) or source dirs."
        )

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
            _log(f"resolved {npm_name}@{npm_version} -> {c}")
            return os.path.abspath(c)

    available = sorted(os.listdir(npm_source_dir))
    raise PluginBuildError(
        f"Could not resolve {npm_name}@{npm_version} in {npm_source_dir!r}. "
        f"Tried: {[os.path.basename(c) for c in candidates]}. "
        f"Available entries: {available}. "
        f"Populate the source dir with `npm pack` tarballs or source directories."
    )


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
                   shared_versions=None, npm_source_dir=None, registry=None):
    """Build a Nagelfluh frontend plugin into ``out_dir`` as an MF remote.

    Parameters
    ----------
    npm_name, npm_version : str
        The plugin package to build, resolved against ``npm_source_dir`` (server-local).
    out_dir : str
        Where the built ``dist/`` (remoteEntry.js + chunks + package.json) is written.
    shared_versions : dict | None
        ``{pkgName: version}`` pinned into the MF ``shared`` config. Defaults to
        :data:`HOST_SHARED_VERSIONS`.
    npm_source_dir : str | None
        Server-local directory holding plugin tarballs / source dirs. Defaults to
        ``PLUGIN_NPM_SOURCE_DIR`` env or :data:`DEFAULT_NPM_SOURCE_DIR`.
    registry : str | None
        Optional npm registry for the *build toolchain / non-shared deps* only. The plugin
        SOURCE always comes from ``npm_source_dir``. Defaults to ``PLUGIN_NPM_REGISTRY`` env.

    Returns
    -------
    dict
        ``{"remote_name", "built_against", "out_dir", "npm_name", "npm_version"}``.
    """
    shared_versions = dict(shared_versions or HOST_SHARED_VERSIONS)
    registry = registry or os.environ.get("PLUGIN_NPM_REGISTRY")

    source_path = resolve_npm_source(npm_name, npm_version, npm_source_dir)
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

    # MF `shared` may only reference packages the plugin actually depends on — sharing a module the
    # plugin doesn't import fails the build. Intersect the host shared set with the plugin's declared
    # peer/regular dependencies. The recorded `built_against` reflects exactly what was pinned.
    declared = set(plugin_pkg.get("peerDependencies", {})) | set(plugin_pkg.get("dependencies", {}))
    effective_shared = {k: v for k, v in shared_versions.items() if k in declared}
    if not effective_shared:
        # Always at least share react if the plugin is a React plugin (the common case).
        effective_shared = {k: v for k, v in shared_versions.items() if k in ("react", "react-dom")}

    build_dir = tempfile.mkdtemp(prefix="nf-plugin-build-")
    try:
        _write_build_scaffold(build_dir, source_path, plugin_pkg, remote_name, entry, effective_shared)

        env = dict(os.environ)
        npm_install = ["npm", "install", "--no-audit", "--no-fund"]
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

        return {
            "remote_name": remote_name,
            "built_against": effective_shared,
            "out_dir": out_dir,
            "npm_name": npm_name,
            "npm_version": npm_version,
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
    p.add_argument("--registry", default=None, help="npm registry for build toolchain deps")
    args = p.parse_args(argv)

    result = build_frontend(
        args.npm_name, args.npm_version, args.out_dir,
        npm_source_dir=args.npm_source_dir, registry=args.registry,
    )
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
