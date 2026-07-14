"""drop clusters.registration_token_expires_at (see docs/plans/minikube-cluster-registration-ux.md)

Revision ID: 54ea11448613
Revises: b94dfd20b859
Create Date: 2026-07-14
"""
from alembic import op
import sqlalchemy as sa

revision = '54ea11448613'
down_revision = 'b94dfd20b859'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('clusters') as batch_op:
        batch_op.drop_column('registration_token_expires_at')


def downgrade() -> None:
    with op.batch_alter_table('clusters') as batch_op:
        batch_op.add_column(sa.Column('registration_token_expires_at', sa.DateTime(), nullable=True))
