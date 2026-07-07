from kubernetes_asyncio import client
from backend.services.k8s_client import k8s_client
import json


def create_job_manifest(docker_image, process_id, version, process_type, parameters, resource_requests, deadline_seconds, project_id,
                         credential_strategy="static-key", credentials=None, expires_at=None, refresh_token=None):
    """Create K8s Job manifest for process execution.

    credential_strategy/credentials/expires_at/refresh_token come from ProcessVersion.run_task(),
    which resolves the project's StorageBackend and (for credential_strategy="short-lived") mints a
    fresh per-job credential + opaque refresh token — see
    docs/plans/done/short-lived-storage-credentials-04-runner-refresh-loop.md. For the default
    "static-key" strategy these are all None and behavior is unchanged: the pod gets its credentials
    from the persistent per-project k8s secret, as it always has.
    """
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

    # Frontend-plugin build configuration. The host's shared-singleton versions are injected here
    # (the plugin does not get to choose them); the source mode + local source dir + registry are
    # passed through so build_frontend_plugin resolves the plugin per PLUGIN_NPM_SOURCE_MODE
    # (local-first, registry, or both).
    # Volumes / mounts injected for specific process types (e.g. the plugin npm source dir).
    extra_volumes = []
    extra_volume_mounts = []

    if process_type == "build_frontend_plugin":
        try:
            from ymerflow_plugin_build import HOST_SHARED_VERSIONS
            shared_versions = HOST_SHARED_VERSIONS
        except Exception:
            shared_versions = {}
        env_vars.append(client.V1EnvVar(
            name="PLUGIN_SHARED_VERSIONS", value=json.dumps(shared_versions)))
        source_mode = getattr(settings, "plugin_npm_source_mode", None)
        if source_mode:
            env_vars.append(client.V1EnvVar(
                name="PLUGIN_NPM_SOURCE_MODE", value=source_mode))
        npm_source_dir = getattr(settings, "plugin_npm_source_dir", None)
        if npm_source_dir:
            env_vars.append(client.V1EnvVar(
                name="PLUGIN_NPM_SOURCE_DIR", value=npm_source_dir))
        if getattr(settings, "plugin_npm_registry", None):
            env_vars.append(client.V1EnvVar(
                name="PLUGIN_NPM_REGISTRY", value=settings.plugin_npm_registry))

        # Mount the admin-populated, server-local npm source directory into the build pod so the
        # build can resolve name@version from it (it never fetches plugin source from the public
        # registry). Without this, resolve_npm_source() raises PluginBuildError in-pod because the
        # directory is absent. The volume source is configurable; "" / "none" disables it (the local
        # build path used by tests does not need it).
        vol_type = (getattr(settings, "plugin_npm_source_volume_type", "") or "").lower()
        vol_source = getattr(settings, "plugin_npm_source_volume_source", None)
        if npm_source_dir and vol_type in ("pvc", "hostpath") and vol_source:
            vol_name = "plugin-npm-source"
            if vol_type == "pvc":
                volume = client.V1Volume(
                    name=vol_name,
                    persistent_volume_claim=client.V1PersistentVolumeClaimVolumeSource(
                        claim_name=vol_source, read_only=True),
                )
            else:  # hostpath
                volume = client.V1Volume(
                    name=vol_name,
                    host_path=client.V1HostPathVolumeSource(
                        path=vol_source, type="Directory"),
                )
            extra_volumes.append(volume)
            extra_volume_mounts.append(client.V1VolumeMount(
                name=vol_name, mount_path=npm_source_dir, read_only=True))

    # Add storage endpoint for MinIO
    # Note: Pods use internal k8s service name, not localhost
    if settings.storage_endpoint and settings.storage_protocol == "s3":
        # Convert localhost endpoint to internal service name for pods
        pod_endpoint = settings.storage_endpoint.replace(
            "http://localhost:9000",
            "http://minio-nagelfluh.nagelfluh-jobs.svc.cluster.local:9000"
        )
        env_vars.append(client.V1EnvVar(name="STORAGE_ENDPOINT", value=pod_endpoint))

    env_vars.append(client.V1EnvVar(name="CREDENTIAL_STRATEGY", value=credential_strategy))

    if credential_strategy == "short-lived":
        # Per-job minted credential + opaque refresh token, injected directly as plaintext env
        # vars (not a k8s secret) — these are short-lived by design and unique to this job, so
        # there is no persistent secret object to reuse. runner.py writes them to a local
        # credentials file and forks a refresher subprocess that re-mints via the
        # /internal/.../storage-credentials/refresh endpoint before they expire.
        env_vars.extend([
            client.V1EnvVar(name="STORAGE_ACCESS_KEY", value=credentials.get("access_key", "")),
            client.V1EnvVar(name="STORAGE_SECRET_KEY", value=credentials.get("secret_key", "")),
            client.V1EnvVar(name="STORAGE_CREDENTIALS_EXPIRES_AT", value=expires_at.isoformat() if expires_at else ""),
            client.V1EnvVar(name="STORAGE_REFRESH_TOKEN", value=refresh_token),
        ])
    elif settings.storage_protocol == "s3" and settings.storage_endpoint:
        # Add credentials from secret if using MinIO/k8s_secrets
        # For now, we'll use a shared MinIO secret per project
        # In production, each process would have its own credentials
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
        command=["python", "-u", "/app/runner.py"],
        env=env_vars,
        volume_mounts=extra_volume_mounts or None,
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
            containers=[container],
            volumes=extra_volumes or None,
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
            labels={"kueue.x-k8s.io/queue-name": "nagelfluh-queue"}
        ),
        spec=job_spec
    )

    # Add suspend flag for Kueue
    job.spec.suspend = True

    return job, job_name


async def create_job(docker_image, process_id, version, process_type, parameters, resource_requests, deadline_seconds, project_id,
                      credential_strategy="static-key", credentials=None, expires_at=None, refresh_token=None):
    """Create K8s job for process execution."""

    # Create manifest
    job_manifest, job_name = create_job_manifest(
        docker_image, process_id, version, process_type, parameters, resource_requests, deadline_seconds, project_id,
        credential_strategy=credential_strategy, credentials=credentials, expires_at=expires_at, refresh_token=refresh_token
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
