"""Add project membership, invites, and user email

Revision ID: c1d2e3f4a5b6
Revises: a1b2c3d4e5f6
Create Date: 2026-05-09 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = 'c1d2e3f4a5b6'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(bind, table, column):
    cols = [c['name'] for c in inspect(bind).get_columns(table)]
    return column in cols


def _index_exists(bind, table, index):
    idxs = [i['name'] for i in inspect(bind).get_indexes(table)]
    return index in idxs


def _table_exists(bind, table):
    return inspect(bind).has_table(table)


def upgrade() -> None:
    bind = op.get_bind()

    if not _column_exists(bind, 'users', 'email'):
        op.add_column('users', sa.Column('email', sa.String(255), nullable=True))
    if not _index_exists(bind, 'users', 'ix_users_email'):
        op.create_index('ix_users_email', 'users', ['email'], unique=True)

    if not _table_exists(bind, 'project_members'):
        op.create_table(
            'project_members',
            sa.Column('project_id', sa.String(255),
                      sa.ForeignKey('projects.id', ondelete='CASCADE'), primary_key=True),
            sa.Column('user_id', sa.Integer(),
                      sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
            sa.Column('joined_at', sa.DateTime(), nullable=False,
                      server_default=sa.text('CURRENT_TIMESTAMP')),
        )

    if not _table_exists(bind, 'project_invites'):
        op.create_table(
            'project_invites',
            sa.Column('id', sa.String(255), primary_key=True),
            sa.Column('project_id', sa.String(255),
                      sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
            sa.Column('email', sa.String(255), nullable=True),
            sa.Column('token', sa.String(255), nullable=False),
            sa.Column('invited_by_id', sa.Integer(),
                      sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False,
                      server_default=sa.text('CURRENT_TIMESTAMP')),
            sa.Column('expires_at', sa.DateTime(), nullable=False),
            sa.Column('accepted_at', sa.DateTime(), nullable=True),
        )
        op.create_index('ix_project_invites_token', 'project_invites', ['token'], unique=True)
        op.create_index('ix_project_invites_project_id', 'project_invites', ['project_id'])

    # Seed: make all existing users members of all existing projects so nobody
    # loses access after the membership gate is turned on.  Skip pairs that
    # already exist to stay idempotent.
    op.execute(sa.text(
        "INSERT INTO project_members (project_id, user_id, joined_at) "
        "SELECT p.id, u.id, CURRENT_TIMESTAMP "
        "FROM projects p CROSS JOIN users u "
        "WHERE NOT EXISTS ("
        "  SELECT 1 FROM project_members pm "
        "  WHERE pm.project_id = p.id AND pm.user_id = u.id"
        ")"
    ))


def downgrade() -> None:
    op.drop_index('ix_project_invites_project_id', 'project_invites')
    op.drop_index('ix_project_invites_token', 'project_invites')
    op.drop_table('project_invites')
    op.drop_table('project_members')
    op.drop_index('ix_users_email', 'users')
    op.drop_column('users', 'email')
