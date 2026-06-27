"""Unit tests for the dual-source npm resolver (nagelfluh_plugin_build.resolve_npm_source).

Covers the resolution order and PLUGIN_NPM_SOURCE_MODE handling WITHOUT network: the registry
path is monkeypatched so we assert *which* source is chosen, not that npm actually downloads.

Run: env/bin/python tests/test_npm_source_resolution.py
"""

import os
import sys
import tempfile

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import nagelfluh_plugin_build.build as build
from nagelfluh_plugin_build import resolve_npm_source, PluginBuildError


def _with_fake_registry(returns_path):
    """Patch _fetch_from_registry to avoid network; record that it was called."""
    calls = []

    def fake(npm_name, npm_version, registry, dest_dir):
        calls.append({"name": npm_name, "version": npm_version, "registry": registry})
        os.makedirs(dest_dir, exist_ok=True)
        # simulate a downloaded tarball
        p = os.path.join(dest_dir, returns_path)
        with open(p, "w") as f:
            f.write("fake")
        return p

    return fake, calls


def _make_local_tarball(d, name, version):
    safe = name.lstrip("@").replace("/", "-")
    p = os.path.join(d, f"{safe}-{version}.tgz")
    with open(p, "w") as f:
        f.write("local")
    return p


def run():
    passed = 0

    # 1. auto: local present -> local wins, registry NOT called
    with tempfile.TemporaryDirectory() as src, tempfile.TemporaryDirectory() as dl:
        local = _make_local_tarball(src, "my-plugin", "1.0.0")
        fake, calls = _with_fake_registry("downloaded.tgz")
        orig = build._fetch_from_registry
        build._fetch_from_registry = fake
        try:
            got = resolve_npm_source("my-plugin", "1.0.0", npm_source_dir=src, mode="auto", download_dir=dl)
        finally:
            build._fetch_from_registry = orig
        assert got == local, got
        assert calls == [], "registry must not be called when local matches in auto mode"
        print("OK  auto: local present -> local wins, registry not called")
        passed += 1

    # 2. auto: local absent -> falls back to registry
    with tempfile.TemporaryDirectory() as src, tempfile.TemporaryDirectory() as dl:
        fake, calls = _with_fake_registry("downloaded.tgz")
        orig = build._fetch_from_registry
        build._fetch_from_registry = fake
        try:
            got = resolve_npm_source("absent-plugin", "2.0.0", npm_source_dir=src, mode="auto", download_dir=dl)
        finally:
            build._fetch_from_registry = orig
        assert got.endswith("downloaded.tgz"), got
        assert len(calls) == 1 and calls[0]["name"] == "absent-plugin"
        print("OK  auto: local absent -> registry fallback")
        passed += 1

    # 3. local: absent -> clear error, registry NOT called
    with tempfile.TemporaryDirectory() as src:
        fake, calls = _with_fake_registry("downloaded.tgz")
        orig = build._fetch_from_registry
        build._fetch_from_registry = fake
        try:
            resolve_npm_source("absent-plugin", "2.0.0", npm_source_dir=src, mode="local")
            raise AssertionError("expected PluginBuildError in local mode with no match")
        except PluginBuildError as e:
            assert "PLUGIN_NPM_SOURCE_MODE=local" in str(e)
        finally:
            build._fetch_from_registry = orig
        assert calls == [], "registry must not be called in local mode"
        print("OK  local: absent -> clear error, registry not called")
        passed += 1

    # 4. registry: local present is IGNORED, registry used
    with tempfile.TemporaryDirectory() as src, tempfile.TemporaryDirectory() as dl:
        _make_local_tarball(src, "my-plugin", "1.0.0")
        fake, calls = _with_fake_registry("downloaded.tgz")
        orig = build._fetch_from_registry
        build._fetch_from_registry = fake
        try:
            got = resolve_npm_source("my-plugin", "1.0.0", npm_source_dir=src, mode="registry",
                                     registry="https://example.test/", download_dir=dl)
        finally:
            build._fetch_from_registry = orig
        assert got.endswith("downloaded.tgz"), got
        assert len(calls) == 1 and calls[0]["registry"] == "https://example.test/"
        print("OK  registry: local ignored, registry used (with configured registry url)")
        passed += 1

    # 5. invalid mode -> error
    try:
        resolve_npm_source("x", "1.0.0", mode="bogus")
        raise AssertionError("expected PluginBuildError for invalid mode")
    except PluginBuildError as e:
        assert "expected" in str(e)
    print("OK  invalid mode -> error")
    passed += 1

    # 6. scoped name normalisation: @scope/pkg -> scope-pkg-<ver>.tgz
    with tempfile.TemporaryDirectory() as src:
        local = _make_local_tarball(src, "@acme/widget", "3.1.0")
        got = resolve_npm_source("@acme/widget", "3.1.0", npm_source_dir=src, mode="local")
        assert got == local, got
        print("OK  scoped name normalises to scope-pkg tarball")
        passed += 1

    print(f"\nALL {passed} TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(run())
