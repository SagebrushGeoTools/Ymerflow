"""add_geography_url_to_datasets

Revision ID: 6692e6840e40
Revises: 1bb9f6022bec
Create Date: 2026-01-26 11:12:06.614576

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6692e6840e40'
down_revision: Union[str, Sequence[str], None] = '1bb9f6022bec'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add geography_url column to datasets table."""
    op.add_column('datasets', sa.Column('geography_url', sa.String(length=500), nullable=True))


def downgrade() -> None:
    """Remove geography_url column from datasets table."""
    op.drop_column('datasets', 'geography_url')
