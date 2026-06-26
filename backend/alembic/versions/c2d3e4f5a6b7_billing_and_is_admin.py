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
    # Create user_balances table
    op.create_table(
        'user_balances',
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('balance', sa.Numeric(10, 2), nullable=False, server_default='0'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id'),
    )

    # Migrate existing balance data from users table
    op.execute(
        "INSERT INTO user_balances (user_id, balance) "
        "SELECT id, COALESCE(balance, 0) FROM users"
    )

    # Add is_admin column to users
    op.add_column('users', sa.Column('is_admin', sa.Boolean(), nullable=False, server_default='0'))

    # Remove balance column from users
    op.drop_column('users', 'balance')

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
    # Re-add balance column to users
    op.add_column('users', sa.Column('balance', sa.Numeric(10, 2), nullable=False, server_default='0'))

    # Copy data back
    op.execute(
        "UPDATE users SET balance = (SELECT balance FROM user_balances WHERE user_balances.user_id = users.id)"
    )

    # Drop user_balances table
    op.drop_table('user_balances')

    # Remove is_admin
    op.drop_column('users', 'is_admin')

    # Re-add cost columns
    op.add_column('process_versions', sa.Column('max_reserved_cost', sa.Numeric(10, 4), nullable=True))
    op.add_column('process_versions', sa.Column('actual_cost', sa.Numeric(10, 4), nullable=True))
