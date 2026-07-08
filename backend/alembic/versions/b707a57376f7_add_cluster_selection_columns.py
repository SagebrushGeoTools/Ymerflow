"""add sort_order, active, max_runtime_seconds to clusters

Revision ID: b707a57376f7
Revises: f6a7b8c9d0e1
Create Date: 2026-07-08
"""
from alembic import op
import sqlalchemy as sa

revision = 'b707a57376f7'
down_revision = 'f6a7b8c9d0e1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('clusters') as batch_op:
        batch_op.add_column(sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'))
        batch_op.add_column(sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.true()))
        batch_op.add_column(sa.Column('max_runtime_seconds', sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('clusters') as batch_op:
        batch_op.drop_column('max_runtime_seconds')
        batch_op.drop_column('active')
        batch_op.drop_column('sort_order')
