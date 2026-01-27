"""Create environment process implementation (stubbed)"""

import logging

logger = logging.getLogger(__name__)


def run(params: dict, backend_client):
    """
    Create a new environment with specified packages

    Args:
        params: Process parameters including:
            - name: Environment name
            - base_docker_image: Base image (default "python:3.11")
            - packages: Array of {name, version} packages to install
        backend_client: BackendClient for API communication
    """
    name = params.get("name", "New Environment")
    base_image = params.get("base_docker_image", "python:3.11")
    packages = params.get("packages", [])

    logger.info("Starting create environment process...")
    logger.info(f"Environment name: {name}")
    logger.info(f"Base image: {base_image}")
    logger.info(f"Installing {len(packages)} packages...")

    # TODO: Actual docker build implementation
    # For now, just log the packages
    for pkg in packages:
        pkg_name = pkg.get("name", "unknown")
        pkg_version = pkg.get("version", "latest")
        logger.info(f"  - Installing {pkg_name}=={pkg_version} (stubbed)")

    logger.info("Environment build complete (stubbed)!")

    # Note: create_environment doesn't create dataset outputs
    # The environment record is created by the backend
