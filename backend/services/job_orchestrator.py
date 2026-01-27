from kubernetes import client
from backend.services.k8s_client import k8s_client
import json


def create_job_manifest(docker_image, process_id, version, process_type, parameters, resource_requests, deadline_seconds):
    """Create K8s Job manifest for process execution."""

    job_name = f"process-{process_id}-v{version}"

    # Get function info from environment (for now, hardcoded fake)
    function_module = "nagelfluh_runner.fake_processes"
    function_name = f"run_{process_type}"

    # Container spec
    container = client.V1Container(
        name="process",
        image=docker_image,
        command=["python", "/app/runner.py"],
        env=[
            client.V1EnvVar(name="FUNCTION_MODULE", value=function_module),
            client.V1EnvVar(name="FUNCTION_NAME", value=function_name),
            client.V1EnvVar(name="PROCESS_ID", value=str(process_id)),
            client.V1EnvVar(name="VERSION", value=str(version)),
            client.V1EnvVar(name="PARAMETERS_JSON", value=json.dumps(parameters)),
            client.V1EnvVar(name="BACKEND_URL", value="http://backend-service:8000"),
        ],
        resources=client.V1ResourceRequirements(
            requests=resource_requests,
            limits=resource_requests  # Same as requests for now
        )
    )

    # Pod template
    pod_template = client.V1PodTemplateSpec(
        metadata=client.V1ObjectMeta(
            labels={
                "app": "nagelfluh-process",
                "process_id": str(process_id),
                "version": str(version),
            }
        ),
        spec=client.V1PodSpec(
            restart_policy="Never",
            containers=[container]
        )
    )

    # Job spec
    job_spec = client.V1JobSpec(
        template=pod_template,
        backoff_limit=0,  # No retries
        active_deadline_seconds=deadline_seconds,
        ttl_seconds_after_finished=3600  # Cleanup after 1 hour
    )

    # Job with Kueue annotation
    job = client.V1Job(
        api_version="batch/v1",
        kind="Job",
        metadata=client.V1ObjectMeta(
            name=job_name,
            annotations={"kueue.x-k8s.io/queue-name": "nagelfluh-queue"}
        ),
        spec=job_spec
    )

    # Add suspend flag for Kueue
    job.spec.suspend = True

    return job, job_name


async def create_job(docker_image, process_id, version, process_type, parameters, resource_requests, deadline_seconds):
    """Create K8s job for process execution."""

    # Create manifest
    job_manifest, job_name = create_job_manifest(
        docker_image, process_id, version, process_type, parameters, resource_requests, deadline_seconds
    )

    # Create job in K8s
    k8s_client.create_job(job_manifest)

    return job_name


async def delete_job(job_name):
    """Delete K8s job (for kill operation)."""
    k8s_client.delete_job(job_name)


async def get_job_status(job_name):
    """Get current job status."""
    status = k8s_client.get_job_status(job_name)

    if status.succeeded:
        return "succeeded"
    elif status.failed:
        return "failed"
    elif status.active:
        return "running"
    else:
        return "pending"
