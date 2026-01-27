"""Flyte task wrapper for Nagelfluh processes"""

import importlib
import logging
from datetime import timedelta
from flytekit import task, workflow

logger = logging.getLogger(__name__)


@task(timeout=timedelta(hours=2), retries=0)
def execute_process(
    spec: dict,
    execution_token: str,
    backend_url: str,
    timeout_seconds: int
) -> dict:
    """
    Generic wrapper task that dynamically calls process-specific functions.

    This task receives a specification dictionary with a single key-value pair where:
    - Key is the module path and function name (e.g., "flyte_tasks.processes.fft.run")
    - Value is the parameters dict to pass to that function

    Args:
        spec: {"flyte_tasks.processes.<type>.run": {...params}}
        execution_token: Authentication token for backend API access
        backend_url: Backend URL for API calls (e.g., http://localhost:8000)
        timeout_seconds: Maximum runtime in seconds (overrides task default)

    Returns:
        {"status": "success"} on successful execution

    Raises:
        Exception: If the process function fails
    """
    from flyte_tasks.utils.backend_client import BackendClient

    logger.info(f"Starting process execution with spec: {list(spec.keys())}")
    logger.info(f"Backend URL: {backend_url}, Timeout: {timeout_seconds}s")

    # Create backend client for API communication
    client = BackendClient(backend_url, execution_token)

    try:
        # Extract module path and params from spec
        # Spec format: {"module.path.function": {...params}}
        module_func_path, params = next(iter(spec.items()))
        logger.info(f"Executing: {module_func_path}")

        # Split into module path and function name
        # e.g., "flyte_tasks.processes.fft.run" -> ("flyte_tasks.processes.fft", "run")
        module_path, func_name = module_func_path.rsplit(".", 1)

        # Dynamically import the module
        logger.info(f"Importing module: {module_path}")
        module = importlib.import_module(module_path)

        # Get the function from the module
        func = getattr(module, func_name)
        logger.info(f"Calling function: {func_name}")

        # Call the process function with params and backend client
        func(params, client)

        logger.info("Process execution completed successfully")
        return {"status": "success"}

    except Exception as e:
        logger.error(f"Process execution failed: {e}", exc_info=True)
        raise


@workflow
def execute_process_workflow(
    spec: dict,
    execution_token: str,
    backend_url: str,
    timeout_seconds: int
) -> dict:
    """
    Workflow wrapper for the execute_process task.

    This provides a Flyte workflow that can be triggered via the Flyte API.

    Args:
        spec: Process specification dict
        execution_token: Authentication token
        backend_url: Backend URL
        timeout_seconds: Timeout in seconds

    Returns:
        Task execution result
    """
    return execute_process(
        spec=spec,
        execution_token=execution_token,
        backend_url=backend_url,
        timeout_seconds=timeout_seconds
    )
