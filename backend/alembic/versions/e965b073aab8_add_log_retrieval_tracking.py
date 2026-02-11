"""add_log_retrieval_tracking

Revision ID: e965b073aab8
Revises: 38c94590b138
Create Date: 2026-02-11 10:36:30.880038

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e965b073aab8'
down_revision: Union[str, Sequence[str], None] = '38c94590b138'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Add log retrieval tracking columns to process_versions
    op.add_column('process_versions', sa.Column('log_retrieval_state', sa.String(50), nullable=True))
    op.add_column('process_versions', sa.Column('log_last_timestamp', sa.DateTime(), nullable=True))
    op.add_column('process_versions', sa.Column('log_stream_position', sa.String(255), nullable=True))
    op.add_column('process_versions', sa.Column('log_checkpoint', sa.JSON(), nullable=True))

    # Set default state for existing rows
    op.execute("UPDATE process_versions SET log_retrieval_state = 'not_started' WHERE log_retrieval_state IS NULL")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('process_versions', 'log_checkpoint')
    op.drop_column('process_versions', 'log_stream_position')
    op.drop_column('process_versions', 'log_last_timestamp')
    op.drop_column('process_versions', 'log_retrieval_state')
