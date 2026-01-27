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


k8s_client = K8sClient()
