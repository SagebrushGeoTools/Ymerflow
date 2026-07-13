"""add clusters.provisioning_status + registration token fields

Revision ID: b94dfd20b859
Revises: 604260b878e3
Create Date: 2026-07-13
"""
from alembic import op
import sqlalchemy as sa

revision = 'b94dfd20b859'
down_revision = '604260b878e3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('clusters') as batch_op:
        batch_op.add_column(sa.Column('provisioning_status', sa.String(32), nullable=False, server_default='active'))
        batch_op.add_column(sa.Column('registration_token_hash', sa.String(64), nullable=True))
        batch_op.add_column(sa.Column('registration_token_expires_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('clusters') as batch_op:
        batch_op.drop_column('registration_token_expires_at')
        batch_op.drop_column('registration_token_hash')
        batch_op.drop_column('provisioning_status')
