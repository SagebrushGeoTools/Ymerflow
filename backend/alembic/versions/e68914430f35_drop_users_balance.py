"""Drop users.balance (superseded by the billing plugin's own user_balances table)

users.balance was left NOT NULL with no default after balance-tracking moved out of core — this
broke both e2f3a4b5c6d7's admin-seed INSERT and, more importantly, plain user signup on any
install without the billing plugin, since backend/models/user.py's User model has no `balance`
column at all and never populates one. The billing plugin cannot own this drop itself (its own
CLAUDE.md hard rule: "Billing migrations may only add schema. Never drop tables or columns" — so
uninstalling billing never loses data), so core does it here instead. Defensive existence check
because some environments may have already had it dropped by an older copy of the billing
plugin's migration (before that plugin's own drop_column call was removed in favor of this one).

Revision ID: e68914430f35
Revises: d3e4f5a6b7c8
Create Date: 2026-07-18
"""
from alembic import op
import sqlalchemy as sa


revision = 'e68914430f35'
down_revision = 'd3e4f5a6b7c8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if 'balance' in [c['name'] for c in sa.inspect(bind).get_columns('users')]:
        op.drop_column('users', 'balance')


def downgrade() -> None:
    op.add_column('users', sa.Column('balance', sa.Numeric(10, 2), nullable=False, server_default='0'))
