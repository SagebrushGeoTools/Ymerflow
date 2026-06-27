"""Backend plugin setup.

Demonstrates the Phase 5.9 pattern: the npm frontend source is built at ``pip install`` time via a
custom ``build_py`` command that calls the shared ``ymerflow_plugin_build.build_frontend`` routine
— the SAME code path the ``build_frontend_plugin`` Process uses. The built MF remote is shipped as
``frontend_dist/`` package data; the running server never runs npm.

``ymerflow_plugin_build`` (the ymerflow-plugin-sdk package) must be importable at build time; it is
declared in ``install_requires`` and pulled from its git URL, so install this plugin into an env
where that dependency has been resolved.

The frontend source lives in ``frontend/`` next to this setup.py. To build it we pack that source
into a temporary server-local npm source dir and resolve it by name@version, mirroring how the
admin populates ``PLUGIN_NPM_SOURCE_DIR`` in production.
"""

import json
import os
import subprocess
import tempfile

from setuptools import setup, find_packages
from setuptools.command.build_py import build_py

HERE = os.path.dirname(os.path.abspath(__file__))
FRONTEND_SRC = os.path.join(HERE, "frontend")
FRONTEND_DIST = os.path.join(HERE, "test_backend_plugin", "frontend_dist")


def _build_frontend():
    # The shared build routine is the standalone ymerflow-plugin-sdk package, pip-installed from its
    # git URL (declared in install_requires below). No local repo checkout is consulted.
    try:
        from ymerflow_plugin_build import build_frontend
    except ImportError as e:
        raise RuntimeError(
            "ymerflow_plugin_build is required to build this plugin's frontend. Install it first:\n"
            "  pip install 'git+https://github.com/SagebrushGeoTools/Ymerflow-plugin-sdk.git'\n"
            "(or set NAGELFLUH_SKIP_FRONTEND_BUILD=1 for a metadata-only install)."
        ) from e

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
    install_requires=[
        # Build harness used by build_py above; consumed via git URL (no local deps/ checkout).
        "ymerflow-plugin-build @ git+https://github.com/SagebrushGeoTools/Ymerflow-plugin-sdk.git",
    ],
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
