"""add_storage_credentials_to_projects

Revision ID: f3a4b5c6d7e8
Revises: e1f2a3b4c5d6
Create Date: 2026-05-16 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'f3a4b5c6d7e8'
down_revision: Union[str, None] = 'e1f2a3b4c5d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('projects', sa.Column('storage_access_key', sa.String(255), nullable=True))
    op.add_column('projects', sa.Column('storage_secret_key', sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column('projects', 'storage_secret_key')
    op.drop_column('projects', 'storage_access_key')
