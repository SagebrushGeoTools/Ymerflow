"""Shared helpers for write-only secret fields in the admin API (StorageBackend.config,
Cluster.provider_config, Cluster.registry_auth). Secrets are never sent to the browser in
plaintext — GET/list responses substitute MASKED for each set field. On Save/Test Connection, any
field still equal to MASKED means "leave unchanged" and is resolved back to the stored value here,
rather than being persisted (or tested against) literally."""

MASKED = "****"


def mask_config(config):
    return {k: MASKED for k in (config or {})}


def mask_secret(value):
    return MASKED if value else None


def resolve_config(submitted, stored):
    stored = stored or {}
    resolved = dict(submitted or {})
    for key, value in resolved.items():
        if value == MASKED:
            if key not in stored:
                raise ValueError(
                    f"cannot restore masked value for {key!r}: no existing value stored"
                )
            resolved[key] = stored[key]
    return resolved


def resolve_secret(submitted, stored):
    if submitted == MASKED:
        if not stored:
            raise ValueError("cannot restore masked value: no existing value stored")
        return stored
    return submitted
