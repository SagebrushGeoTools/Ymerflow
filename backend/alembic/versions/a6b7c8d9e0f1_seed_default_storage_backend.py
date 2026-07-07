"""seed default storage backend from config.env

Revision ID: a6b7c8d9e0f1
Revises: f4a5b6c7d8e9
Create Date: 2026-07-07
"""
from alembic import op
import sqlalchemy as sa
from datetime import datetime

revision = 'a6b7c8d9e0f1'
down_revision = 'f4a5b6c7d8e9'
branch_labels = None
depends_on = None

DEFAULT_ID = 'default-storage-backend-00000000-0000-0000-0000-000000000000'


def upgrade() -> None:
    from backend.config import settings
    conn = op.get_bind()

    exists = conn.execute(
        sa.text("SELECT COUNT(*) FROM storage_backends WHERE id = :id"),
        {"id": DEFAULT_ID},
    ).scalar()

    if not exists:
        conn.execute(sa.text("""
            INSERT INTO storage_backends
                (id, name, protocol, endpoint, bucket_prefix, credential_strategy, config, created_at)
            VALUES
                (:id, 'Default Storage Backend', :protocol, :endpoint, :bucket_prefix,
                 'static-key', '{}', :created_at)
        """), {
            "id": DEFAULT_ID,
            "protocol": settings.storage_protocol,
            "endpoint": settings.storage_endpoint,
            "bucket_prefix": settings.storage_bucket_prefix,
            "created_at": datetime.utcnow().isoformat(),
        })

    conn.execute(sa.text("""
        UPDATE projects SET storage_backend_id = :id WHERE storage_backend_id IS NULL
    """), {"id": DEFAULT_ID})


def downgrade() -> None:
    pass  # cannot cleanly undo a backfill
