from kubernetes_asyncio import client
from backend.services.k8s_client import k8s_clients
import json

# Name of the `kubernetes.io/dockerconfigjson` Secret created by the shared provisioning routine
# (dev/lib/provision-nagelfluh-jobs.sh) in every cluster's jobs namespace — same fixed name
# everywhere, local default cluster included, so job pods can always pull the (now always
# publicly-addressed) runner image without ImagePullBackOff. See
# docs/plans/done/remote-cluster-provisioning-and-registry.md Phase 7.
REGISTRY_PULL_SECRET_NAME = "nagelfluh-registry-pull"


def create_job_manifest(docker_image, process_id, version, process_type, parameters, resource_requests, deadline_seconds, project_id,
                         cluster, storage_base, storage_kwargs,
                         credential_strategy="static-key", expires_at=None, refresh_token=None):
    """Create K8s Job manifest for process execution.

    cluster is the Cluster resolved via get_cluster_for_process_version() from the
    k8s_cluster_id chosen and validated at process-creation time (see
    docs/plans/multi-cluster-selection.md) — it supplies the k8s connection and namespace
    the job runs in. It does NOT supply the image registry: the pod's own image is
    environment.docker_image (a fully-qualified reference baked into the environment), and
    the REGISTRY_URL/REGISTRY_AUTH env vars used by build_frontend_plugin to pull/build
    further images come from the global settings.registry_url/settings.registry_auth (see
    docs/plans/cluster-registry-global-not-per-cluster.md).

    storage_base / storage_kwargs are resolved by ProcessVersion.run_task() from the project's
    StorageBackend via its StorageProtocolHandler — the handler is the single addressing authority
    (see docs/plans/per-project-storage-routing.md). storage_kwargs are **project-scoped** (never
    the backend's admin creds) and are handed to the pod as a single STORAGE_KWARGS_JSON env var;
    fsspec dispatches on the URL scheme in storage_base (s3/gs/…), so no protocol-specific code
    lives here or in the runner. This is cluster-agnostic: nothing is mounted from a per-cluster
    k8s secret, so a pod on a remote/GKE cluster gets its credentials directly.

    credential_strategy/expires_at/refresh_token also come from run_task(): for
    credential_strategy="short-lived" it mints a fresh per-job credential (already folded into
    storage_kwargs) + an opaque refresh token so the runner can re-mint mid-job. For the default
    "static-key" strategy expires_at/refresh_token are None and the pod simply keeps using the
    project-scoped kwargs it was launched with.
    """
    from backend.config import settings

    job_name = f"process-{process_id}-v{version}"

    # Build environment variables
    env_vars = [
        client.V1EnvVar(name="PROCESS_TYPE", value=process_type),
        client.V1EnvVar(name="PROCESS_ID", value=str(process_id)),
        client.V1EnvVar(name="VERSION", value=str(version)),
        client.V1EnvVar(name="PROJECT_ID", value=str(project_id)),
        client.V1EnvVar(name="PARAMETERS_JSON", value=json.dumps(parameters)),
        client.V1EnvVar(name="BACKEND_URL", value="http://backend-service:8000"),
        client.V1EnvVar(name="STORAGE_BASE", value=storage_base),
        client.V1EnvVar(name="STORAGE_KWARGS_JSON", value=json.dumps(storage_kwargs)),
    ]

    # Add registry configuration if available (global — the runner images only exist wherever
    # docker/build.sh pushed them, so every cluster reaches the same one registry)
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

    env_vars.append(client.V1EnvVar(name="CREDENTIAL_STRATEGY", value=credential_strategy))

    if credential_strategy == "short-lived":
        # The initial minted credential is already folded into STORAGE_KWARGS_JSON above; here we
        # add only the opaque refresh token + its expiry so runner.py can fork a refresher
        # subprocess that re-mints protocol-general kwargs via the
        # /internal/.../storage-credentials/refresh endpoint before the credential expires. Injected
        # as plaintext env (not a k8s secret) — short-lived by design and unique to this job.
        env_vars.extend([
            client.V1EnvVar(name="STORAGE_CREDENTIALS_EXPIRES_AT", value=expires_at.isoformat() if expires_at else ""),
            client.V1EnvVar(name="STORAGE_REFRESH_TOKEN", value=refresh_token),
        ])

    # Container spec
    container = client.V1Container(
        name="process",
        image=docker_image,
        image_pull_policy="IfNotPresent",  # Already-present local images skip the pull; anything
                                            # missing (e.g. on a fresh remote cluster) is pulled
                                            # from the registry using image_pull_secrets below.
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
            image_pull_secrets=[client.V1LocalObjectReference(name=REGISTRY_PULL_SECRET_NAME)],
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
                      cluster, storage_base, storage_kwargs,
                      credential_strategy="static-key", expires_at=None, refresh_token=None):
    """Create K8s job for process execution on the given Cluster."""

    # Create manifest
    job_manifest, job_name = create_job_manifest(
        docker_image, process_id, version, process_type, parameters, resource_requests, deadline_seconds, project_id,
        cluster, storage_base, storage_kwargs,
        credential_strategy=credential_strategy, expires_at=expires_at, refresh_token=refresh_token
    )

    # Create job in K8s
    await k8s_clients.get(cluster).create_job(job_manifest)

    return job_name


async def delete_job(job_name, k8s_client):
    """Delete K8s job (for kill operation) on the cluster owning k8s_client."""
    await k8s_client.delete_job(job_name)


async def get_job_status(job_name, k8s_client):
    """Get current job status on the cluster owning k8s_client."""
    status = await k8s_client.get_job_status(job_name)

    if status.succeeded:
        return "succeeded"
    elif status.failed:
        return "failed"
    elif status.active:
        return "running"
    else:
        return "pending"
