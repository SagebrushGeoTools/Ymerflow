"""Minimal setup.py to install the shared nagelfluh_plugin_build package into the runner image.

The package source is copied to ./nagelfluh_plugin_build by the Dockerfile. This keeps the runner
image self-contained without depending on the repo-root setup.py (which also pulls in `billing`).
"""

from setuptools import setup

setup(
    name="nagelfluh-plugin-build",
    version="0.1.0",
    description="Shared frontend-plugin build routine for Nagelfluh",
    packages=["nagelfluh_plugin_build"],
)
