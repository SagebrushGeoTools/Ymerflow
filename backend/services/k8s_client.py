from kubernetes import client, config
import os


class K8sClient:
    def __init__(self):
        # Auto-detect: in-cluster or local kubeconfig
        try:
            config.load_incluster_config()
        except:
            config.load_kube_config()

        self.batch_api = client.BatchV1Api()
        self.core_api = client.CoreV1Api()
        self.namespace = os.getenv('K8S_NAMESPACE', 'nagelfluh-jobs')

    def create_job(self, job_manifest):
        return self.batch_api.create_namespaced_job(self.namespace, job_manifest)

    def delete_job(self, job_name):
        return self.batch_api.delete_namespaced_job(job_name, self.namespace)

    def get_job_status(self, job_name):
        job = self.batch_api.read_namespaced_job(job_name, self.namespace)
        return job.status

    def get_pod_for_job(self, job_name):
        pods = self.core_api.list_namespaced_pod(
            self.namespace,
            label_selector=f"job-name={job_name}"
        )
        return pods.items[0] if pods.items else None

    def stream_pod_logs(self, pod_name):
        return self.core_api.read_namespaced_pod_log(
            pod_name,
            self.namespace,
            follow=True,
            _preload_content=False
        )

    def get_pod_logs(self, pod_name):
        """Get all available logs from a pod (non-streaming).

        Returns logs as a string, or None if no logs are available.
        Useful for getting logs from failed/terminated pods.
        """
        try:
            logs = self.core_api.read_namespaced_pod_log(
                pod_name,
                self.namespace,
                follow=False
            )
            return logs if logs else None
        except Exception:
            return None

    def get_pod_events(self, pod_name):
        """Get events related to a pod.

        Returns a list of event messages, or empty list if no events found.
        """
        try:
            events = self.core_api.list_namespaced_event(
                self.namespace,
                field_selector=f"involvedObject.name={pod_name}"
            )
            return [
                f"[{event.type}] {event.reason}: {event.message}"
                for event in events.items
            ]
        except Exception:
            return []

    def is_pod_container_running(self, pod_name):
        """Check if any container in the pod is running"""
        try:
            pod = self.core_api.read_namespaced_pod(pod_name, self.namespace)
            if pod.status.container_statuses:
                for container_status in pod.status.container_statuses:
                    if container_status.state.running:
                        return True
            return False
        except Exception:
            return False

    def get_pod_error_status(self, pod_name):
        """Check if pod has error conditions and return error message if any

        Returns:
            tuple: (has_error: bool, error_message: str or None)
        """
        try:
            pod = self.core_api.read_namespaced_pod(pod_name, self.namespace)

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


k8s_client = K8sClient()
