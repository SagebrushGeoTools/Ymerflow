"""Guard against drift between the SDK's documented Vite federation preset and the build harness.

The plugin author guide tells authors the build harness federates their plugin using
`nagelfluh-plugin-sdk/vite-preset`. The harness (`nagelfluh_plugin_build.build`) actually generates
its own inline `vite.config.js`, so the preset and the harness MUST emit an identical `shared`
block or the documented artefact silently diverges from what really runs.

This test evaluates the SDK preset's pure `sharedConfig(...)` in node and compares it, key-for-key,
against the JS object the harness's `_shared_block(...)` renders for the same versions. It also
asserts the SDK preset's `DEFAULT_SHARED` matches the harness's `HOST_SHARED_VERSIONS`, so the two
single-sources-of-truth can never silently drift apart.

Run with:  env/bin/python tests/test_vite_preset_consistency.py
(Requires `node` on PATH; the preset's pure helpers import without any npm deps installed.)
"""

import json
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO)

PRESET = os.path.join(REPO, "deps", "nagelfluh-plugin-sdk", "vite-preset.js")


def _eval_preset_shared(versions):
    """Run the SDK preset's sharedConfig(versions) in node and return the resulting object."""
    node = shutil.which("node")
    if not node:
        raise RuntimeError("node not found on PATH")
    script = (
        f"import {{ sharedConfig, DEFAULT_SHARED }} from {json.dumps(PRESET)};\n"
        f"const v = {json.dumps(versions)};\n"
        "process.stdout.write(JSON.stringify({shared: sharedConfig(v), default: DEFAULT_SHARED}));\n"
    )
    proc = subprocess.run(
        [node, "--input-type=module", "-e", script],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"node eval failed: {proc.stderr}")
    return json.loads(proc.stdout)


def _parse_harness_shared_block(js_literal):
    """Parse the JS object literal emitted by build._shared_block into a Python dict.

    The harness emits e.g.:
        {
          "react": { singleton: true, requiredVersion: "18.2.0" },
          ...
        }
    We extract name -> requiredVersion pairs (the only data that matters for comparison).
    """
    out = {}
    for name, version in re.findall(
        r'"([^"]+)":\s*\{\s*singleton:\s*true,\s*requiredVersion:\s*"([^"]+)"\s*\}',
        js_literal,
    ):
        out[name] = version
    return out


def main():
    from nagelfluh_plugin_build.build import _shared_block, HOST_SHARED_VERSIONS

    versions = {"react": "18.2.0", "react-dom": "18.2.0", "@tanstack/react-query": "5.90.19"}

    preset = _eval_preset_shared(versions)
    preset_shared = preset["shared"]
    preset_default = preset["default"]

    harness_block = _shared_block(versions)
    harness_shared = _parse_harness_shared_block(harness_block)

    # 1. For the same versions, both emit the same { name: { singleton, requiredVersion } } shape.
    preset_versions = {k: v["requiredVersion"] for k, v in preset_shared.items()}
    assert preset_versions == versions, preset_versions
    assert harness_shared == versions, harness_shared
    assert all(v.get("singleton") is True for v in preset_shared.values()), preset_shared
    assert "singleton: true" in harness_block, harness_block
    print("[1] preset.sharedConfig and harness._shared_block emit identical shared blocks")

    # 2. The two default/host version sets agree (neither side silently drifts).
    assert preset_default == HOST_SHARED_VERSIONS, (preset_default, HOST_SHARED_VERSIONS)
    print("[2] SDK DEFAULT_SHARED == harness HOST_SHARED_VERSIONS == %s" % HOST_SHARED_VERSIONS)

    print("\nPRESET/HARNESS CONSISTENCY OK")


if __name__ == "__main__":
    main()
