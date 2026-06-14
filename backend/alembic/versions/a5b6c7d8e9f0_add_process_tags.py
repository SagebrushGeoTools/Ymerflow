"""add_process_tags

Revision ID: a5b6c7d8e9f0
Revises: f3a4b5c6d7e8
Create Date: 2026-06-14 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'a5b6c7d8e9f0'
down_revision: Union[str, None] = 'f3a4b5c6d7e8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'process_tags',
        sa.Column('id', sa.String(255), primary_key=True),
        sa.Column('project_id', sa.String(255), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('color', sa.String(32), nullable=False, server_default='#6c757d'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
    )
    op.create_table(
        'process_version_tags',
        sa.Column('process_version_id', sa.Integer(), sa.ForeignKey('process_versions.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('tag_id', sa.String(255), sa.ForeignKey('process_tags.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('added_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('added_by', sa.String(255), nullable=False, server_default=''),
    )
    op.add_column('process_versions', sa.Column('tags_history', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('process_versions', 'tags_history')
    op.drop_table('process_version_tags')
    op.drop_table('process_tags')
