"""add_process_types_to_environments

Revision ID: 38c94590b138
Revises: 4e2a5d6f7c8b
Create Date: 2026-01-31 21:57:15.722188

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '38c94590b138'
down_revision: Union[str, Sequence[str], None] = '4e2a5d6f7c8b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add process_types JSON column to environments table."""
    # Add process_types column (nullable, will be populated as environments are created)
    op.add_column('environments', sa.Column('process_types', sa.JSON(), nullable=True))


def downgrade() -> None:
    """Remove process_types column from environments table."""
    op.drop_column('environments', 'process_types')
