"""add_flyte_execution_fields

Revision ID: 6h8i9j0k1l2m
Revises: 3e9d7f5a8c2d
Create Date: 2026-01-26 18:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6h8i9j0k1l2m'
down_revision: Union[str, Sequence[str], None] = '3e9d7f5a8c2d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add execution_token and timeout_seconds to process_versions."""
    # Use batch mode for SQLite compatibility
    with op.batch_alter_table('process_versions', schema=None) as batch_op:
        batch_op.add_column(sa.Column('execution_token', sa.String(255), nullable=True))
        batch_op.add_column(sa.Column('timeout_seconds', sa.Integer(), nullable=True))
        batch_op.create_index('ix_process_versions_execution_token', ['execution_token'])


def downgrade() -> None:
    """Remove execution_token and timeout_seconds from process_versions."""
    with op.batch_alter_table('process_versions', schema=None) as batch_op:
        batch_op.drop_index('ix_process_versions_execution_token')
        batch_op.drop_column('execution_token')
        batch_op.drop_column('timeout_seconds')
