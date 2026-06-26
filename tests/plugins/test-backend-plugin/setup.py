"""Backend plugin setup.

Demonstrates the Phase 5.9 pattern: the npm frontend source is built at ``pip install`` time via a
custom ``build_py`` command that calls the shared ``nagelfluh_plugin_build.build_frontend`` routine
— the SAME code path the ``build_frontend_plugin`` Process uses. The built MF remote is shipped as
``frontend_dist/`` package data; the running server never runs npm.

The frontend source lives in ``frontend/`` next to this setup.py. To build it we pack that source
into a temporary server-local npm source dir and resolve it by name@version, mirroring how the
admin populates ``PLUGIN_NPM_SOURCE_DIR`` in production.
"""

import json
import os
import subprocess
import sys
import tempfile

from setuptools import setup, find_packages
from setuptools.command.build_py import build_py

HERE = os.path.dirname(os.path.abspath(__file__))
FRONTEND_SRC = os.path.join(HERE, "frontend")
FRONTEND_DIST = os.path.join(HERE, "test_backend_plugin", "frontend_dist")


def _build_frontend():
    # Import the shared routine; fall back to adding the repo root to sys.path for in-tree installs.
    try:
        from nagelfluh_plugin_build import build_frontend
    except ImportError:
        repo_root = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
        sys.path.insert(0, repo_root)
        from nagelfluh_plugin_build import build_frontend

    with open(os.path.join(FRONTEND_SRC, "package.json")) as f:
        pkg = json.load(f)
    npm_name = pkg["name"]
    npm_version = pkg["version"]

    # Pack the frontend source into a temp server-local npm source dir, then build from it.
    src_dir = tempfile.mkdtemp(prefix="nf-backend-plugin-src-")
    subprocess.run(
        ["npm", "pack", "--pack-destination", src_dir, FRONTEND_SRC],
        check=True,
    )
    build_frontend(npm_name, npm_version, FRONTEND_DIST, npm_source_dir=src_dir)


class BuildWithFrontend(build_py):
    def run(self):
        # Only build if a build toolchain (npm) is available; skip gracefully otherwise so that
        # metadata-only installs don't hard-fail in environments without node.
        if os.environ.get("NAGELFLUH_SKIP_FRONTEND_BUILD") != "1":
            _build_frontend()
        super().run()


setup(
    name='test-backend-plugin',
    version='0.1.0',
    packages=find_packages(),
    cmdclass={'build_py': BuildWithFrontend},
    package_data={'test_backend_plugin': ['frontend_dist/**/*', 'frontend_dist/*']},
    include_package_data=True,
    entry_points={
        'nagelfluh.hooks': [
            'register_routers = test_backend_plugin:register_routers',
            'frontend_bundles = test_backend_plugin:frontend_bundles',
        ],
    },
)
