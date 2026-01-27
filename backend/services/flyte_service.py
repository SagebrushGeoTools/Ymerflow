"""Flyte service for submitting and monitoring process executions

Architecture Overview:
----------------------

1. Docker Images & Environments
   - Each Environment specifies a docker_image (e.g., "nagelfluh-default:0.1")
   - All images contain: wrapper.py + process implementations + environment-specific packages
   - Default environment uses "nagelfluh-default:0.1" (built via docker/build.sh)
   - Custom environments created by create_environment process (builds & pushes custom images)

2. Wrapper Task Registration
   - The same wrapper task code ships in ALL docker images
   - When a process is submitted, we ensure wrapper is registered for that image
   - Registration is on-demand and automatic (no manual pyflyte register needed)
   - Each image gets registered as a separate version: image tag -> workflow version

3. Execution Flow
   - Process → Environment → Docker Image
   - Check if wrapper registered for image → Register if needed
   - Submit workflow execution with correct image version
   - Flyte pulls image and runs wrapper task
   - Wrapper dynamically imports and calls process-specific function (e.g., flyte_tasks.processes.fft.run)

4. Why This Architecture
   - Single generic wrapper handles all process types
   - Different environments = different packages, same wrapper
   - No code duplication across images
   - Automatic registration = no manual intervention required
"""

import asyncio
import logging
import subprocess
from typing import Dict, Any, Set
import aiohttp
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.models.process import Process, ProcessVersion, ProcessState

logger = logging.getLogger(__name__)


# Track which docker images have been registered with Flyte in this session
_registered_images: Set[str] = set()


class FlyteService:
    """Service for interacting with Flyte API"""

    @staticmethod
    async def _ensure_workflow_registered(docker_image: str) -> None:
        """
        Ensure the wrapper workflow is registered for the specified docker image.

        This checks if we've already registered the image in this session, and if not,
        registers the flyte_tasks.wrapper module with Flyte using the specified image.

        Args:
            docker_image: Docker image tag (e.g., "nagelfluh-default:0.1")
        """
        global _registered_images

        if docker_image in _registered_images:
            logger.debug(f"Workflow already registered for image: {docker_image}")
            return

        logger.info(f"Registering wrapper workflow for image: {docker_image}")

        try:
            # Use pyflyte register via docker run to register the workflow
            # This ensures we're using the exact code from the image
            cmd = [
                "docker", "run", "--rm",
                "--network", "host",  # Allow container to reach Flyte API
                docker_image,
                "pyflyte", "register",
                "--image", docker_image,
                "--project", "nagelfluh",
                "--domain", "development",
                "--version", docker_image.replace(":", "-"),  # Use image tag as version
                "flyte_tasks.wrapper"
            ]

            # Run registration (synchronous subprocess in executor)
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                lambda: subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=60
                )
            )

            if result.returncode != 0:
                logger.error(f"Flyte registration failed: {result.stderr}")
                raise Exception(f"Failed to register workflow: {result.stderr}")

            logger.info(f"Successfully registered workflow for image: {docker_image}")
            logger.debug(f"Registration output: {result.stdout}")

            # Mark as registered for this session
            _registered_images.add(docker_image)

        except subprocess.TimeoutExpired:
            logger.error("Flyte registration timed out")
            raise Exception("Workflow registration timed out")
        except Exception as e:
            logger.error(f"Failed to register workflow: {e}", exc_info=True)
            raise

    @staticmethod
    async def submit_and_monitor(
        process: Process,
        version: ProcessVersion,
        db: AsyncSession
    ) -> None:
        """
        Submit process to Flyte and monitor execution until completion.

        This function:
        1. Builds the task specification
        2. Submits the workflow to Flyte
        3. Streams logs from Flyte's stdout/stderr capture
        4. Polls for execution status
        5. Fetches any remaining logs on completion/failure
        6. Updates process state based on Flyte execution status

        Args:
            process: Process model
            version: ProcessVersion model with execution_token and timeout_seconds
            db: Database session
        """
        try:
            # Transition to RUNNING state
            await version.update_state(db, ProcessState.RUNNING)

            # Get docker image from environment
            docker_image = process.environment.docker_image
            logger.info(f"Process will run with image: {docker_image}")

            # Ensure wrapper workflow is registered for this image
            await FlyteService._ensure_workflow_registered(docker_image)

            # Build task specification
            spec = FlyteService._build_spec(process.type, version.parameters)

            # Get timeout (use version-specific or default)
            timeout = version.timeout_seconds or settings.default_process_timeout

            # Submit to Flyte
            logger.info(f"Submitting process {process.id} v{version.version} to Flyte")
            execution_id = await FlyteService._submit_workflow(
                spec=spec,
                execution_token=version.execution_token,
                timeout_seconds=timeout,
                docker_image=docker_image
            )

            if not execution_id:
                raise Exception("Failed to get execution ID from Flyte")

            logger.info(f"Flyte execution started: {execution_id}")

            # Monitor execution and stream logs
            final_status = await FlyteService._monitor_execution(
                execution_id=execution_id,
                version=version,
                db=db,
                timeout_seconds=timeout
            )

            # Fetch any remaining logs
            await FlyteService._fetch_remaining_logs(execution_id, version, db)

            # Handle completion based on status
            if final_status == "SUCCEEDED":
                await version.update_state(db, ProcessState.DONE, version.outputs)
                logger.info(f"Process {process.id} v{version.version} completed successfully")
            elif final_status == "TIMED_OUT":
                await version.update_state(db, ProcessState.FAILED)
                await version.add_log_entry(db, f"Process execution timed out after {timeout} seconds")
                logger.error(f"Process {process.id} v{version.version} timed out")
            elif final_status in ["FAILED", "ABORTED"]:
                await version.update_state(db, ProcessState.FAILED)
                await version.add_log_entry(db, f"Process failed with status: {final_status}")
                logger.error(f"Process {process.id} v{version.version} failed: {final_status}")
            else:
                await version.update_state(db, ProcessState.FAILED)
                await version.add_log_entry(db, f"Process ended with unknown status: {final_status}")
                logger.error(f"Process {process.id} v{version.version} unknown status: {final_status}")

        except Exception as e:
            logger.error(f"Error in Flyte execution: {e}", exc_info=True)
            await version.update_state(db, ProcessState.FAILED)
            await version.add_log_entry(db, f"Execution error: {str(e)}")

    @staticmethod
    def _build_spec(process_type: str, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """
        Build task specification for Flyte

        Args:
            process_type: Process type (e.g., "fft", "inversion")
            parameters: Process parameters

        Returns:
            Spec dict: {"flyte_tasks.processes.<type>.run": parameters}
        """
        module_path = f"flyte_tasks.processes.{process_type}.run"
        return {module_path: parameters}

    @staticmethod
    async def _submit_workflow(
        spec: Dict[str, Any],
        execution_token: str,
        timeout_seconds: int,
        docker_image: str
    ) -> str:
        """
        Submit workflow to Flyte API

        Args:
            spec: Task specification
            execution_token: Execution token for backend API
            timeout_seconds: Timeout in seconds
            docker_image: Docker image that was registered

        Returns:
            Execution ID
        """
        try:
            # Convert image tag to version (e.g., "nagelfluh-default:0.1" -> "nagelfluh-default-0.1")
            version = docker_image.replace(":", "-")

            # Build Flyte execution request
            execution_request = {
                "project": "nagelfluh",
                "domain": "development",
                "name": f"execution-{datetime.utcnow().timestamp()}",
                "spec": {
                    "launchPlan": {
                        "project": "nagelfluh",
                        "domain": "development",
                        "name": "flyte_tasks.wrapper.execute_process_workflow",
                        "version": version
                    },
                    "inputs": {
                        "spec": spec,
                        "execution_token": execution_token,
                        "backend_url": settings.backend_url,
                        "timeout_seconds": timeout_seconds
                    }
                }
            }

            # Submit to Flyte admin API
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{settings.flyte_endpoint}/api/v1/executions",
                    json=execution_request,
                    timeout=aiohttp.ClientTimeout(total=30)
                ) as response:
                    if response.status != 200:
                        error_text = await response.text()
                        logger.error(f"Flyte API error: {response.status} - {error_text}")
                        raise Exception(f"Flyte submission failed: {response.status}")

                    result = await response.json()
                    execution_id = result.get("id", {}).get("name")
                    return execution_id

        except Exception as e:
            logger.error(f"Failed to submit to Flyte: {e}", exc_info=True)
            raise

    @staticmethod
    async def _fetch_logs(
        execution_id: str,
        version: ProcessVersion,
        db: AsyncSession,
        seen_logs: Set[str]
    ) -> None:
        """
        Fetch logs from Flyte and add new ones to the database

        Args:
            execution_id: Flyte execution ID
            version: ProcessVersion to add logs to
            db: Database session
            seen_logs: Set of log line hashes we've already seen
        """
        try:
            async with aiohttp.ClientSession() as session:
                # Fetch logs from Flyte
                # API format: /api/v1/task_logs/{project}/{domain}/{name}/{execution_id}
                async with session.get(
                    f"{settings.flyte_endpoint}/api/v1/task_logs/nagelfluh/development/{execution_id}",
                    timeout=aiohttp.ClientTimeout(total=10)
                ) as response:
                    if response.status != 200:
                        return

                    logs = await response.json()

                    # Process log lines
                    for log_entry in logs.get("lines", []):
                        message = log_entry.get("message", "").strip()
                        if not message:
                            continue

                        # Create a hash to track if we've seen this log
                        log_hash = f"{log_entry.get('timestamp', '')}:{message}"

                        if log_hash not in seen_logs:
                            seen_logs.add(log_hash)
                            await version.add_log_entry(db, message)

        except Exception as e:
            logger.warning(f"Failed to fetch logs from Flyte: {e}")

    @staticmethod
    async def _fetch_remaining_logs(
        execution_id: str,
        version: ProcessVersion,
        db: AsyncSession
    ) -> None:
        """
        Fetch any remaining logs after execution completes

        Args:
            execution_id: Flyte execution ID
            version: ProcessVersion to add logs to
            db: Database session
        """
        # Use empty set since we want all remaining logs
        await FlyteService._fetch_logs(execution_id, version, db, set())

    @staticmethod
    async def _monitor_execution(
        execution_id: str,
        version: ProcessVersion,
        db: AsyncSession,
        timeout_seconds: int
    ) -> str:
        """
        Monitor Flyte execution until completion, streaming logs

        Args:
            execution_id: Flyte execution ID
            version: ProcessVersion to monitor
            db: Database session
            timeout_seconds: Process timeout in seconds

        Returns:
            Final execution status
        """
        poll_interval = 2  # Poll every 2 seconds
        max_polls = timeout_seconds // poll_interval if timeout_seconds else 3600
        polls = 0
        seen_logs: Set[str] = set()

        while polls < max_polls:
            try:
                # Fetch new logs
                await FlyteService._fetch_logs(execution_id, version, db, seen_logs)

                # Poll Flyte API for status
                async with aiohttp.ClientSession() as session:
                    async with session.get(
                        f"{settings.flyte_endpoint}/api/v1/executions/{execution_id}",
                        timeout=aiohttp.ClientTimeout(total=10)
                    ) as response:
                        if response.status != 200:
                            logger.warning(f"Failed to poll Flyte status: {response.status}")
                            await asyncio.sleep(poll_interval)
                            polls += 1
                            continue

                        result = await response.json()
                        status = result.get("closure", {}).get("phase")

                        # Terminal states
                        if status in ["SUCCEEDED", "FAILED", "ABORTED", "TIMED_OUT"]:
                            return status

                        # Still running
                        await asyncio.sleep(poll_interval)
                        polls += 1

            except Exception as e:
                logger.error(f"Error polling Flyte: {e}")
                await asyncio.sleep(poll_interval)
                polls += 1

        # Monitoring timeout reached (distinct from task timeout)
        logger.error(f"Monitoring timeout reached for execution {execution_id}")
        return "TIMED_OUT"


# Singleton instance (not needed yet, but following pattern)
flyte_service = FlyteService()
