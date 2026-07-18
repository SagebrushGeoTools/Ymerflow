"""backfill admin credentials into default storage backend config

Revision ID: 182d880e84c7
Revises: 388de934b874
Create Date: 2026-07-09
"""
from alembic import op
import sqlalchemy as sa
import json

revision = '182d880e84c7'
down_revision = '388de934b874'
branch_labels = None
depends_on = None

DEFAULT_ID = 'f51f2357-277c-4128-806c-61d7dad491e7'


def upgrade() -> None:
    from backend.config import settings
    conn = op.get_bind()
    conn.execute(sa.text("""
        UPDATE storage_backends SET config = :config
        WHERE id = :id AND (config IS NULL OR config::text = '{}')
    """), {
        "id": DEFAULT_ID,
        "config": json.dumps({
            "admin_access_key": settings.minio_root_user,
            "admin_secret_key": settings.minio_root_password,
        }),
    })


def downgrade() -> None:
    pass  # cannot cleanly undo — config may have been legitimately edited since
