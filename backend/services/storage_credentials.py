"""Shared storage-credential provisioning.

Used by every call site that needs a project's storage ready before use: project
creation, manual re-setup (`POST /project/{id}/setup-storage`), and job launch
(`ProcessVersion.run_task`). Before this existed, each call site kept its own
`is_minio_enabled()` / `setup_project_storage()` branch, which would have silently
diverged the moment a non-default `StorageBackend` existed.

This is also the future home of Phase 3's credential-strategy dispatch
(`StaticKeyStrategy` / `ShortLivedStrategy`) and Phase 4's mint-per-launch call.
"""
import asyncio
import logging

from backend.services.minio_service import (
    is_minio_enabled,
    ensure_project_k8s_secret,
    setup_project_storage,
)

logger = logging.getLogger(__name__)


async def ensure_ready(db, project, force: bool = False) -> dict:
    """Ensure a project's storage credentials exist and its K8s secret is present.

    If credentials are already stored and force is False, only the K8s secret is
    recreated (cheap; handles the "secret wiped by a cluster restart" case).
    Otherwise runs full provisioning, which mints a new credential pair and commits
    it onto `project`.

    Returns the credentials dict ({"access_key", "secret_key"}), or {} if storage is
    not enabled for this deployment.
    """
    if not is_minio_enabled():
        return {}

    if not force and project.storage_access_key and project.storage_secret_key:
        await asyncio.to_thread(
            ensure_project_k8s_secret,
            project.id, project.storage_access_key, project.storage_secret_key
        )
        return {"access_key": project.storage_access_key, "secret_key": project.storage_secret_key}

    logger.info("Running full storage setup for project %s", project.id)
    storage_result = await asyncio.to_thread(setup_project_storage, project.id)
    if storage_result.get("status") == "error":
        raise RuntimeError(f"Storage setup failed: {storage_result.get('error')}")

    creds = storage_result.get("credentials", {})
    project.storage_access_key = creds.get("access_key")
    project.storage_secret_key = creds.get("secret_key")
    project.storage_status = "ready"
    await db.commit()
    return creds
