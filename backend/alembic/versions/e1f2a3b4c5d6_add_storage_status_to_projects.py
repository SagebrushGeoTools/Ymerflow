"""Add storage_status to projects

Revision ID: e1f2a3b4c5d6
Revises: d2e3f4a5b6c7
Create Date: 2026-05-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = 'e1f2a3b4c5d6'
down_revision: Union[str, Sequence[str], None] = 'd2e3f4a5b6c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(bind, table, column):
    cols = [c['name'] for c in inspect(bind).get_columns(table)]
    return column in cols


def upgrade() -> None:
    bind = op.get_bind()
    if not _column_exists(bind, 'projects', 'storage_status'):
        op.add_column('projects', sa.Column('storage_status', sa.String(32), nullable=True))


def downgrade() -> None:
    op.drop_column('projects', 'storage_status')
