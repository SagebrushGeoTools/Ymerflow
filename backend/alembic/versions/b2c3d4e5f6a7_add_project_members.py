"""add project_members table

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-04-10 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import table, column, select


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'project_members',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('project_id', sa.String(length=255), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('role', sa.String(length=50), nullable=False, server_default='member'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('project_id', 'user_id', name='uq_project_member'),
    )
    op.create_index('ix_project_members_project_id', 'project_members', ['project_id'])
    op.create_index('ix_project_members_user_id', 'project_members', ['user_id'])

    # Bootstrap: give all existing users admin access to all existing projects so no
    # data becomes inaccessible after this migration.
    bind = op.get_bind()
    projects = bind.execute(sa.text("SELECT id FROM projects")).fetchall()
    users = bind.execute(sa.text("SELECT id FROM users")).fetchall()
    now = sa.func.now()

    if projects and users:
        rows = []
        for proj in projects:
            for user in users:
                rows.append({
                    "project_id": proj[0],
                    "user_id": user[0],
                    "role": "admin",
                    "created_at": sa.text("CURRENT_TIMESTAMP"),
                })
        # Insert individually to handle CURRENT_TIMESTAMP portably
        for row in rows:
            bind.execute(
                sa.text(
                    "INSERT INTO project_members (project_id, user_id, role, created_at) "
                    "VALUES (:project_id, :user_id, :role, CURRENT_TIMESTAMP)"
                ),
                {"project_id": row["project_id"], "user_id": row["user_id"], "role": row["role"]},
            )


def downgrade() -> None:
    op.drop_index('ix_project_members_user_id', 'project_members')
    op.drop_index('ix_project_members_project_id', 'project_members')
    op.drop_table('project_members')
