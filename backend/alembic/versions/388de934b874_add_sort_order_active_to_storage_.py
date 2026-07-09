"""add sort_order, active to storage_backends

Revision ID: 388de934b874
Revises: 5ebf42871eb0
Create Date: 2026-07-09
"""
from alembic import op
import sqlalchemy as sa

revision = '388de934b874'
down_revision = '5ebf42871eb0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('storage_backends') as batch_op:
        batch_op.add_column(sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'))
        batch_op.add_column(sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.true()))


def downgrade() -> None:
    with op.batch_alter_table('storage_backends') as batch_op:
        batch_op.drop_column('active')
        batch_op.drop_column('sort_order')
