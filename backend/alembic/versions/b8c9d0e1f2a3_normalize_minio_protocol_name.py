"""normalize minio protocol name on existing storage_backends rows

Revision ID: b8c9d0e1f2a3
Revises: a6b7c8d9e0f1
Create Date: 2026-07-07
"""
from alembic import op
import sqlalchemy as sa

revision = 'b8c9d0e1f2a3'
down_revision = 'a6b7c8d9e0f1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # Phase 1's bootstrap migration seeded protocol from settings.storage_protocol, which is
    # historically "s3" for any s3-compatible endpoint (including MinIO) — is_minio_enabled()'s
    # own check is exactly "protocol == 's3' and endpoint is not None". Phase 3 introduces 'minio'
    # as its own distinct StorageProtocolHandler registration, separate from real AWS 's3', so
    # existing rows using the old "s3-compatible + explicit endpoint" convention need remapping —
    # otherwise they'd dispatch to the (stub, NotImplementedError) S3ProtocolHandler instead of
    # MinioProtocolHandler, which would be a real behavior change for the current deployment.
    conn.execute(sa.text("""
        UPDATE storage_backends SET protocol = 'minio'
        WHERE protocol = 's3' AND endpoint IS NOT NULL
    """))


def downgrade() -> None:
    pass  # cannot distinguish "was normalized" from "always was minio" after the fact
