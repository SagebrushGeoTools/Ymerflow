from kubernetes_asyncio import client
from backend.services.k8s_client import k8s_client
import json


def create_job_manifest(docker_image, process_id, version, process_type, parameters, resource_requests, deadline_seconds, project_id):
    """Create K8s Job manifest for process execution."""
    from backend.config import settings
    from backend.services.storage_service import get_storage_base_url

    job_name = f"process-{process_id}-v{version}"

    # Storage configuration
    storage_base = get_storage_base_url(project_id)

    # Build environment variables
    env_vars = [
        client.V1EnvVar(name="PROCESS_TYPE", value=process_type),
        client.V1EnvVar(name="PROCESS_ID", value=str(process_id)),
        client.V1EnvVar(name="VERSION", value=str(version)),
        client.V1EnvVar(name="PROJECT_ID", value=str(project_id)),
        client.V1EnvVar(name="PARAMETERS_JSON", value=json.dumps(parameters)),
        client.V1EnvVar(name="BACKEND_URL", value="http://backend-service:8000"),
        client.V1EnvVar(name="STORAGE_BASE", value=storage_base),
    ]

    # Add registry configuration if available
    if settings.registry_url:
        env_vars.append(client.V1EnvVar(name="REGISTRY_URL", value=settings.registry_url))
    if settings.registry_auth:
        env_vars.append(client.V1EnvVar(name="REGISTRY_AUTH", value=settings.registry_auth))

    # Add storage endpoint for MinIO
    # Note: Pods use internal k8s service name, not localhost
    if settings.storage_endpoint and settings.storage_protocol == "s3":
        # Convert localhost endpoint to internal service name for pods
        pod_endpoint = settings.storage_endpoint.replace(
            "http://localhost:9000",
            "http://minio-nagelfluh.nagelfluh-jobs.svc.cluster.local:9000"
        )
        env_vars.append(client.V1EnvVar(name="STORAGE_ENDPOINT", value=pod_endpoint))

    # Add credentials from secret if using MinIO/k8s_secrets
    # For now, we'll use a shared MinIO secret per project
    # In production, each process would have its own credentials
    if settings.storage_protocol == "s3" and settings.storage_endpoint:
        # Add AWS credentials from k8s secret
        env_vars.extend([
            client.V1EnvVar(
                name="AWS_ACCESS_KEY_ID",
                value_from=client.V1EnvVarSource(
                    secret_key_ref=client.V1SecretKeySelector(
                        name=f"project-{project_id}-storage",
                        key="access-key"
                    )
                )
            ),
            client.V1EnvVar(
                name="AWS_SECRET_ACCESS_KEY",
                value_from=client.V1EnvVarSource(
                    secret_key_ref=client.V1SecretKeySelector(
                        name=f"project-{project_id}-storage",
                        key="secret-key"
                    )
                )
            ),
        ])

    # Container spec
    container = client.V1Container(
        name="process",
        image=docker_image,
        image_pull_policy="IfNotPresent",  # Use local images from minikube
        command=["python", "/app/runner.py"],
        env=env_vars,
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


async def create_job(docker_image, process_id, version, process_type, parameters, resource_requests, deadline_seconds, project_id):
    """Create K8s job for process execution."""

    # Create manifest
    job_manifest, job_name = create_job_manifest(
        docker_image, process_id, version, process_type, parameters, resource_requests, deadline_seconds, project_id
    )

    # Create job in K8s
    await k8s_client.create_job(job_manifest)

    return job_name


async def delete_job(job_name):
    """Delete K8s job (for kill operation)."""
    await k8s_client.delete_job(job_name)


async def get_job_status(job_name):
    """Get current job status."""
    status = await k8s_client.get_job_status(job_name)

    if status.succeeded:
        return "succeeded"
    elif status.failed:
        return "failed"
    elif status.active:
        return "running"
    else:
        return "pending"
