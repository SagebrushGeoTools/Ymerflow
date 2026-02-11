from kubernetes_asyncio import client, config, watch
import os
import asyncio
import logging

logger = logging.getLogger(__name__)


class K8sClient:
    def __init__(self):
        self.namespace = os.getenv('K8S_NAMESPACE', 'nagelfluh-jobs')
        self._initialized = False
        self.batch_api = None
        self.core_api = None

    async def _ensure_initialized(self):
        """Lazily initialize the K8s client"""
        if self._initialized:
            return

        # Auto-detect: in-cluster or local kubeconfig
        try:
            config.load_incluster_config()
        except:
            await config.load_kube_config()

        self.batch_api = client.BatchV1Api()
        self.core_api = client.CoreV1Api()
        self._initialized = True

    async def create_job(self, job_manifest):
        await self._ensure_initialized()
        return await self.batch_api.create_namespaced_job(self.namespace, job_manifest)

    async def delete_job(self, job_name):
        await self._ensure_initialized()
        return await self.batch_api.delete_namespaced_job(job_name, self.namespace)

    async def get_job_status(self, job_name):
        await self._ensure_initialized()
        job = await self.batch_api.read_namespaced_job(job_name, self.namespace)
        return job.status

    async def get_pod_for_job(self, job_name):
        await self._ensure_initialized()
        pods = await self.core_api.list_namespaced_pod(
            self.namespace,
            label_selector=f"job-name={job_name}"
        )
        return pods.items[0] if pods.items else None

    async def stream_pod_logs(self, pod_name, since_time=None):
        """Stream logs with optional since_time for resume capability

        Args:
            pod_name: Name of the pod
            since_time: Optional RFC3339 timestamp or ISO format string to stream logs from
        """
        await self._ensure_initialized()

        kwargs = {
            "follow": True,
            "_preload_content": False
        }

        if since_time:
            # K8s expects RFC3339 format, but accepts ISO format too
            kwargs["since_time"] = since_time

        return await self.core_api.read_namespaced_pod_log(
            pod_name,
            self.namespace,
            **kwargs
        )

    async def get_pod_logs(self, pod_name, since_time=None):
        """Get all available logs from a pod (non-streaming).

        Args:
            pod_name: Name of the pod
            since_time: Optional RFC3339 timestamp or ISO format string to get logs from

        Returns logs as a string, or None if no logs are available.
        Useful for getting logs from failed/terminated pods.
        """
        await self._ensure_initialized()
        try:
            kwargs = {"follow": False}

            if since_time:
                kwargs["since_time"] = since_time

            logs = await self.core_api.read_namespaced_pod_log(
                pod_name,
                self.namespace,
                **kwargs
            )
            return logs if logs else None
        except Exception:
            return None

    async def get_pod_events(self, pod_name):
        """Get events related to a pod.

        Returns a list of event messages, or empty list if no events found.
        """
        await self._ensure_initialized()
        try:
            events = await self.core_api.list_namespaced_event(
                self.namespace,
                field_selector=f"involvedObject.name={pod_name}"
            )
            return [
                f"[{event.type}] {event.reason}: {event.message}"
                for event in events.items
            ]
        except Exception:
            return []

    async def get_job_events(self, job_name):
        """Get events related to a job.

        Returns a list of event messages, or empty list if no events found.
        Useful for diagnosing Job-level failures (quota issues, invalid config, etc.)
        """
        await self._ensure_initialized()
        try:
            events = await self.core_api.list_namespaced_event(
                self.namespace,
                field_selector=f"involvedObject.name={job_name}"
            )
            return [
                f"[{event.type}] {event.reason}: {event.message}"
                for event in events.items
            ]
        except Exception:
            return []

    async def get_job_error_status(self, job_name):
        """Check if job has error conditions and return error message if any

        Returns:
            tuple: (has_error: bool, error_message: str or None)
        """
        await self._ensure_initialized()
        try:
            job = await self.batch_api.read_namespaced_job(job_name, self.namespace)
            status = job.status

            # Check for job failures
            if status.failed and status.failed > 0:
                conditions = status.conditions or []
                for condition in conditions:
                    if condition.type == 'Failed' and condition.status == 'True':
                        error_msg = f"Job failed: {condition.reason}"
                        if condition.message:
                            error_msg += f" - {condition.message}"
                        return True, error_msg
                return True, f"Job failed ({status.failed} failed pods)"

            # Check for deadline exceeded
            if status.conditions:
                for condition in status.conditions:
                    if condition.type == 'Failed' and condition.reason == 'DeadlineExceeded':
                        return True, f"Job deadline exceeded: {condition.message or 'Timeout reached'}"

            return False, None

        except Exception as e:
            return False, None

    async def is_pod_container_running(self, pod_name):
        """Check if any container in the pod is running"""
        await self._ensure_initialized()
        try:
            pod = await self.core_api.read_namespaced_pod(pod_name, self.namespace)
            if pod.status.container_statuses:
                for container_status in pod.status.container_statuses:
                    if container_status.state.running:
                        return True
            return False
        except Exception:
            return False

    async def get_pod_error_status(self, pod_name):
        """Check if pod has error conditions and return error message if any

        Returns:
            tuple: (has_error: bool, error_message: str or None)
        """
        await self._ensure_initialized()
        try:
            pod = await self.core_api.read_namespaced_pod(pod_name, self.namespace)

            # Check container statuses for waiting states with errors
            if pod.status.container_statuses:
                for container_status in pod.status.container_statuses:
                    if container_status.state.waiting:
                        reason = container_status.state.waiting.reason
                        message = container_status.state.waiting.message

                        # Error reasons that indicate failure
                        error_reasons = [
                            'ImagePullBackOff', 'ErrImagePull',
                            'CrashLoopBackOff', 'CreateContainerConfigError',
                            'InvalidImageName', 'CreateContainerError'
                        ]

                        if reason in error_reasons:
                            error_msg = f"Container error: {reason}"
                            if message:
                                error_msg += f" - {message}"
                            return True, error_msg

                    # Check for terminated state with non-zero exit code
                    if container_status.state.terminated:
                        if container_status.state.terminated.exit_code != 0:
                            reason = container_status.state.terminated.reason
                            message = container_status.state.terminated.message
                            error_msg = f"Container terminated: {reason} (exit code {container_status.state.terminated.exit_code})"
                            if message:
                                error_msg += f" - {message}"
                            return True, error_msg

            # Check pod phase for failures
            if pod.status.phase == 'Failed':
                return True, f"Pod failed: {pod.status.reason or 'Unknown reason'}"

            return False, None

        except Exception as e:
            return False, None

    async def watch_job(self, job_name, timeout_seconds=None):
        """Watch a job for status changes using Kubernetes Watch API.

        Yields job objects as they change. Completes when job reaches terminal state
        (succeeded or failed) or timeout is reached.

        Args:
            job_name: Name of the job to watch
            timeout_seconds: Optional timeout in seconds

        Yields:
            Job objects as they are updated
        """
        await self._ensure_initialized()

        w = watch.Watch()
        try:
            # Watch for changes to the specific job
            async for event in w.stream(
                self.batch_api.list_namespaced_job,
                namespace=self.namespace,
                field_selector=f'metadata.name={job_name}',
                timeout_seconds=timeout_seconds
            ):
                job = event['object']
                event_type = event['type']

                logger.debug(f"Job {job_name} event: {event_type}, status: {job.status}")

                # Yield the job object
                yield job

                # Stop watching if job reached terminal state
                if job.status.succeeded or job.status.failed:
                    logger.info(f"Job {job_name} reached terminal state")
                    break

        except asyncio.CancelledError:
            logger.info(f"Watch for job {job_name} was cancelled")
            raise
        except Exception as e:
            logger.error(f"Error watching job {job_name}: {e}")
            raise
        finally:
            await w.close()


k8s_client = K8sClient()
