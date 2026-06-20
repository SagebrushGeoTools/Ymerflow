"""Add flow_x, flow_y to processes

Revision ID: b7c8d9e0f1a2
Revises: a5b6c7d8e9f0
Create Date: 2026-06-20 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = 'b7c8d9e0f1a2'
down_revision: Union[str, Sequence[str], None] = 'a5b6c7d8e9f0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(bind, table, column):
    cols = [c['name'] for c in inspect(bind).get_columns(table)]
    return column in cols


def upgrade() -> None:
    bind = op.get_bind()
    if not _column_exists(bind, 'processes', 'flow_x'):
        op.add_column('processes', sa.Column('flow_x', sa.Float(), nullable=True))
    if not _column_exists(bind, 'processes', 'flow_y'):
        op.add_column('processes', sa.Column('flow_y', sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column('processes', 'flow_y')
    op.drop_column('processes', 'flow_x')
