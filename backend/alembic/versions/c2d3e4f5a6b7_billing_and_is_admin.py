"""Billing tables and is_admin: move users.balance to user_balances, add is_admin

Revision ID: c2d3e4f5a6b7
Revises: b7c8d9e0f1a2
Create Date: 2026-06-25
"""
from alembic import op
import sqlalchemy as sa


revision = 'c2d3e4f5a6b7'
down_revision = 'b7c8d9e0f1a2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = [c['name'] for c in sa.inspect(bind).get_columns('users')]
    if 'is_admin' not in existing:
        op.add_column('users', sa.Column('is_admin', sa.Boolean(), nullable=False, server_default='0'))

    # Remove cost tracking columns from process_versions
    # Use try/except because they may already be absent in some environments
    try:
        op.drop_column('process_versions', 'max_reserved_cost')
    except Exception:
        pass
    try:
        op.drop_column('process_versions', 'actual_cost')
    except Exception:
        pass


def downgrade() -> None:
    # Remove is_admin
    op.drop_column('users', 'is_admin')

    # Re-add cost columns
    op.add_column('process_versions', sa.Column('max_reserved_cost', sa.Numeric(10, 4), nullable=True))
    op.add_column('process_versions', sa.Column('actual_cost', sa.Numeric(10, 4), nullable=True))
