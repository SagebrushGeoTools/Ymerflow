"""Add billing_plan_templates, billing_plan_versions, billing_contracts, billing_periods

Revision ID: f4b5c6d7e8a9
Revises: e2f3a4b5c6d7
Create Date: 2026-06-29
"""
from alembic import op
import sqlalchemy as sa


revision = 'f4b5c6d7e8a9'
down_revision = 'e2f3a4b5c6d7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == 'postgresql'

    # Create billing_period_status enum for PostgreSQL
    if is_pg:
        op.execute(sa.text("CREATE TYPE billing_period_status AS ENUM ('open', 'closed')"))

    op.create_table(
        'billing_plan_templates',
        sa.Column('id', sa.String(64), nullable=False),
        sa.Column('invite_only', sa.Boolean(), nullable=False, server_default='false'),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'billing_plan_versions',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('template_id', sa.String(64), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('contractual_text', sa.Text(), nullable=True),
        sa.Column('period_fee', sa.Numeric(10, 2), nullable=False, server_default='0'),
        sa.Column('period_months', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('auto_prolong', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('submission_fee_per_job', sa.Numeric(10, 4), nullable=True),
        sa.Column('cpu_rate_per_core_second', sa.Numeric(14, 10), nullable=True),
        sa.Column('memory_rate_per_gb_second', sa.Numeric(14, 10), nullable=True),
        sa.Column('included_compute_credit', sa.Numeric(10, 4), nullable=True),
        sa.Column('hard_cap_compute', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('storage_rate_per_gb_day', sa.Numeric(14, 10), nullable=True),
        sa.Column('included_storage_credit', sa.Numeric(10, 4), nullable=True),
        sa.Column('hard_cap_storage', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('max_compute_credit', sa.Numeric(10, 4), nullable=True),
        sa.Column('max_storage_credit', sa.Numeric(10, 4), nullable=True),
        sa.ForeignKeyConstraint(['template_id'], ['billing_plan_templates.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('template_id', 'version', name='uq_plan_version'),
    )
    op.create_index('ix_billing_plan_versions_template_id', 'billing_plan_versions', ['template_id'])

    op.create_table(
        'billing_contracts',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('plan_version_id', sa.Integer(), nullable=False),
        sa.Column('contract_start', sa.DateTime(), nullable=False),
        sa.Column('contract_end', sa.DateTime(), nullable=True),
        sa.Column('assigned_by_user_id', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['plan_version_id'], ['billing_plan_versions.id']),
        sa.ForeignKeyConstraint(['assigned_by_user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_billing_contracts_user_id', 'billing_contracts', ['user_id'])
    op.create_index('ix_billing_contracts_contract_end', 'billing_contracts', ['contract_end'])

    if is_pg:
        op.create_table(
            'billing_periods',
            sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
            sa.Column('contract_id', sa.Integer(), nullable=False),
            sa.Column('period_start', sa.DateTime(), nullable=False),
            sa.Column('period_end', sa.DateTime(), nullable=True),
            sa.Column('cpu_core_seconds_used', sa.Numeric(20, 6), nullable=False, server_default='0'),
            sa.Column('memory_gb_seconds_used', sa.Numeric(20, 6), nullable=False, server_default='0'),
            sa.Column('storage_gb_days_used', sa.Numeric(20, 6), nullable=False, server_default='0'),
            sa.Column('compute_credit_used', sa.Numeric(10, 4), nullable=False, server_default='0'),
            sa.Column('subscription_fee_charged', sa.Numeric(10, 2), nullable=False, server_default='0'),
            sa.Column('overage_charged', sa.Numeric(10, 4), nullable=False, server_default='0'),
            sa.Column('storage_charged', sa.Numeric(10, 4), nullable=False, server_default='0'),
            sa.Column('status', sa.Enum('open', 'closed', name='billing_period_status', create_type=False), nullable=False, server_default='open'),
            sa.ForeignKeyConstraint(['contract_id'], ['billing_contracts.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
        )
    else:
        op.create_table(
            'billing_periods',
            sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
            sa.Column('contract_id', sa.Integer(), nullable=False),
            sa.Column('period_start', sa.DateTime(), nullable=False),
            sa.Column('period_end', sa.DateTime(), nullable=True),
            sa.Column('cpu_core_seconds_used', sa.Numeric(20, 6), nullable=False, server_default='0'),
            sa.Column('memory_gb_seconds_used', sa.Numeric(20, 6), nullable=False, server_default='0'),
            sa.Column('storage_gb_days_used', sa.Numeric(20, 6), nullable=False, server_default='0'),
            sa.Column('compute_credit_used', sa.Numeric(10, 4), nullable=False, server_default='0'),
            sa.Column('subscription_fee_charged', sa.Numeric(10, 2), nullable=False, server_default='0'),
            sa.Column('overage_charged', sa.Numeric(10, 4), nullable=False, server_default='0'),
            sa.Column('storage_charged', sa.Numeric(10, 4), nullable=False, server_default='0'),
            sa.Column('status', sa.String(16), nullable=False, server_default='open'),
            sa.ForeignKeyConstraint(['contract_id'], ['billing_contracts.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
        )

    op.create_index('ix_billing_periods_contract_id', 'billing_periods', ['contract_id'])
    op.create_index('ix_billing_periods_contract_status', 'billing_periods', ['contract_id', 'status'])


def downgrade() -> None:
    op.drop_index('ix_billing_periods_contract_status', table_name='billing_periods')
    op.drop_index('ix_billing_periods_contract_id', table_name='billing_periods')
    op.drop_table('billing_periods')
    op.drop_index('ix_billing_contracts_contract_end', table_name='billing_contracts')
    op.drop_index('ix_billing_contracts_user_id', table_name='billing_contracts')
    op.drop_table('billing_contracts')
    op.drop_index('ix_billing_plan_versions_template_id', table_name='billing_plan_versions')
    op.drop_table('billing_plan_versions')
    op.drop_table('billing_plan_templates')

    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        op.execute(sa.text("DROP TYPE IF EXISTS billing_period_status"))
