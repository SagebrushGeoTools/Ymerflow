"""Add storage_backends table and projects.storage_backend_id

Revision ID: f4a5b6c7d8e9
Revises: e2f3a4b5c6d7
Create Date: 2026-07-07
"""
from alembic import op
import sqlalchemy as sa


revision = 'f4a5b6c7d8e9'
down_revision = 'e2f3a4b5c6d7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'storage_backends',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('protocol', sa.String(32), nullable=False),
        sa.Column('endpoint', sa.String(255), nullable=True),
        sa.Column('bucket_prefix', sa.String(255), nullable=False),
        sa.Column('credential_strategy', sa.String(32), nullable=False),
        sa.Column('config', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )

    with op.batch_alter_table('projects') as batch_op:
        batch_op.add_column(sa.Column('storage_backend_id', sa.String(36), nullable=True))
        batch_op.create_foreign_key(
            'fk_projects_storage_backend_id',
            'storage_backends',
            ['storage_backend_id'],
            ['id'],
        )


def downgrade() -> None:
    with op.batch_alter_table('projects') as batch_op:
        batch_op.drop_constraint('fk_projects_storage_backend_id', type_='foreignkey')
        batch_op.drop_column('storage_backend_id')
    op.drop_table('storage_backends')
