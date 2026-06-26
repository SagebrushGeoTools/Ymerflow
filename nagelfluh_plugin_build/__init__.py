"""Shared frontend-plugin build routine.

This package is intentionally dependency-free (stdlib only) so it can be imported from three
distinct places that converge on the *same* build code path:

1. The ``build_frontend_plugin`` process type (runs in a Kubernetes pod, or locally for tests).
2. A backend plugin's ``setup.py`` ``build_py`` command (builds at ``pip install`` time).
3. Local tests / a CLI (``python -m nagelfluh_plugin_build ...``) so the whole
   build -> register -> serve -> load flow can be exercised on a dev machine *without* a cluster.

The routine resolves ``name@version`` against a **server-local npm source directory** (never the
public registry) and runs the real ``npm``/``vite`` Module-Federation build with ``shared`` pinned
to the host's exact singleton versions.
"""

from .build import (
    build_frontend,
    HOST_SHARED_VERSIONS,
    resolve_npm_source,
    PluginBuildError,
)

__all__ = [
    "build_frontend",
    "HOST_SHARED_VERSIONS",
    "resolve_npm_source",
    "PluginBuildError",
]
