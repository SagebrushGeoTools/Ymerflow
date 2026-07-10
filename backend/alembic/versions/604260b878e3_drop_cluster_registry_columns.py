"""drop registry_url, registry_auth from clusters (registry is now a global setting)

Revision ID: 604260b878e3
Revises: 182d880e84c7
Create Date: 2026-07-10
"""
from alembic import op
import sqlalchemy as sa

revision = '604260b878e3'
down_revision = '182d880e84c7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('clusters') as batch_op:
        batch_op.drop_column('registry_url')
        batch_op.drop_column('registry_auth')


def downgrade() -> None:
    with op.batch_alter_table('clusters') as batch_op:
        batch_op.add_column(sa.Column('registry_url', sa.String(255), nullable=True))
        batch_op.add_column(sa.Column('registry_auth', sa.String(255), nullable=True))
