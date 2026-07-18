"""generic seed override for default storage backend

Revision ID: 9623bab8493d
Revises: 50dd9ce3311b
Create Date: 2026-07-15
"""
from alembic import op
import sqlalchemy as sa
import json
import os

revision = '9623bab8493d'
down_revision = '50dd9ce3311b'
branch_labels = None
depends_on = None

DEFAULT_ID = 'f51f2357-277c-4128-806c-61d7dad491e7'


def upgrade() -> None:
    """Generic follow-up to a6b7c8d9e0f1 (initial seed) / 182d880e84c7 (MinIO admin-creds
    backfill), per Design decision 7 in docs/plans/registry-backend-hooks.md: mirror
    50dd9ce3311b's generic `<AXIS>_PROTOCOL`/`<AXIS>_CONFIG_JSON` pattern for storage, as a
    follow-up UPDATE rather than an INSERT, since the default row already exists by this point
    in the migration chain.

    If STORAGE_PROTOCOL/STORAGE_CONFIG_JSON are both set, an operator has made a deliberate,
    authoritative choice that should win over whatever the earlier fallback-seeding migrations
    already put in place, so this unconditionally overrides protocol/config on the default row
    (no `WHERE config IS NULL OR config = '{}'` guard like 182d880e84c7 uses). If either env var
    is unset, this is a no-op and today's already-seeded values stand unchanged.
    """
    protocol = os.getenv("STORAGE_PROTOCOL")
    config_json = os.getenv("STORAGE_CONFIG_JSON")
    if not protocol or not config_json:
        return

    conn = op.get_bind()
    conn.execute(sa.text("""
        UPDATE storage_backends SET protocol = :protocol, config = :config
        WHERE id = :id
    """), {
        "id": DEFAULT_ID,
        "protocol": protocol,
        "config": json.dumps(json.loads(config_json)),
    })


def downgrade() -> None:
    pass  # cannot cleanly undo — config may have been legitimately edited since
