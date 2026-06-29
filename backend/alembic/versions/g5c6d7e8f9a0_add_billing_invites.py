"""Add billing_invites table

Revision ID: g5c6d7e8f9a0
Revises: f4b5c6d7e8a9
Branch Labels: None
depends_on: None
"""
from alembic import op
import sqlalchemy as sa


revision = 'g5c6d7e8f9a0'
down_revision = 'a9b0c1d2e3f4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'billing_invites',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('token', sa.String(64), nullable=False),
        sa.Column('template_id', sa.String(64), nullable=False),
        sa.Column('target_email', sa.String(255), nullable=True),
        sa.Column('created_by_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=True),
        sa.Column('accepted_at', sa.DateTime(), nullable=True),
        sa.Column('accepted_by_id', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['template_id'], ['billing_plan_templates.id']),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.id']),
        sa.ForeignKeyConstraint(['accepted_by_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('token', name='uq_billing_invite_token'),
    )
    op.create_index('ix_billing_invites_template_id', 'billing_invites', ['template_id'])
    op.create_index('ix_billing_invites_token', 'billing_invites', ['token'])


def downgrade() -> None:
    op.drop_index('ix_billing_invites_token', table_name='billing_invites')
    op.drop_index('ix_billing_invites_template_id', table_name='billing_invites')
    op.drop_table('billing_invites')
