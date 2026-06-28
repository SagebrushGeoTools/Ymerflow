"""Add billing_period_id and dimension to user_transactions; add new TransactionType values

Revision ID: a9b0c1d2e3f4
Revises: f4b5c6d7e8a9
Create Date: 2026-06-29
"""
from alembic import op
import sqlalchemy as sa


revision = 'a9b0c1d2e3f4'
down_revision = 'f4b5c6d7e8a9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == 'postgresql'

    if is_pg:
        # Add new values to transactiontype enum outside a transaction
        with op.get_context().autocommit_block():
            op.execute(sa.text("ALTER TYPE transactiontype ADD VALUE IF NOT EXISTS 'included'"))
            op.execute(sa.text("ALTER TYPE transactiontype ADD VALUE IF NOT EXISTS 'overage'"))
            op.execute(sa.text("ALTER TYPE transactiontype ADD VALUE IF NOT EXISTS 'submission'"))
            op.execute(sa.text("ALTER TYPE transactiontype ADD VALUE IF NOT EXISTS 'subscription'"))

        # Create transaction_dimension enum
        op.execute(sa.text(
            "CREATE TYPE transaction_dimension AS ENUM "
            "('compute_cpu', 'compute_memory', 'storage', 'subscription', 'credit_topup')"
        ))

        op.add_column(
            'user_transactions',
            sa.Column(
                'billing_period_id',
                sa.Integer(),
                sa.ForeignKey('billing_periods.id', ondelete='SET NULL'),
                nullable=True,
            ),
        )
        op.add_column(
            'user_transactions',
            sa.Column(
                'dimension',
                sa.Enum(
                    'compute_cpu', 'compute_memory', 'storage', 'subscription', 'credit_topup',
                    name='transaction_dimension',
                    create_type=False,
                ),
                nullable=True,
            ),
        )
    else:
        # SQLite: just add the columns as plain types
        op.add_column(
            'user_transactions',
            sa.Column('billing_period_id', sa.Integer(), nullable=True),
        )
        op.add_column(
            'user_transactions',
            sa.Column('dimension', sa.String(32), nullable=True),
        )

    op.create_index(
        'ix_user_transactions_billing_period_id',
        'user_transactions',
        ['billing_period_id'],
    )


def downgrade() -> None:
    op.drop_index('ix_user_transactions_billing_period_id', table_name='user_transactions')
    op.drop_column('user_transactions', 'dimension')
    op.drop_column('user_transactions', 'billing_period_id')

    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        op.execute(sa.text("DROP TYPE IF EXISTS transaction_dimension"))
        # PostgreSQL does not support removing enum values; cannot fully downgrade transactiontype
