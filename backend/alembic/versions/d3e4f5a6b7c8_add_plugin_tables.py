"""Add plugin, plugin_version, user_plugin tables

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-06-25
"""
from alembic import op
import sqlalchemy as sa


revision = 'd3e4f5a6b7c8'
down_revision = 'c2d3e4f5a6b7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if 'plugins' in sa.inspect(bind).get_table_names():
        return  # tables already exist from pre-plugin-system migration

    # plugins table — created without the circular FK first
    op.create_table(
        'plugins',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('display_name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('latest_version_id', sa.String(36), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name'),
    )

    # plugin_versions table
    op.create_table(
        'plugin_versions',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('plugin_id', sa.String(36), nullable=False),
        sa.Column('project_id', sa.String(255), nullable=False),
        sa.Column('process_id', sa.String(255), nullable=False),
        sa.Column('process_version', sa.Integer(), nullable=False),
        sa.Column('output_dataset_id', sa.String(255), nullable=False),
        sa.Column('npm_name', sa.String(255), nullable=False),
        sa.Column('npm_version', sa.String(64), nullable=False),
        sa.Column('content_hash', sa.String(64), nullable=False),
        sa.Column('built_against', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['plugin_id'], ['plugins.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('plugin_id', 'content_hash'),
    )
    op.create_index('ix_plugin_versions_content_hash', 'plugin_versions', ['content_hash'])

    # Add the circular FK from plugins.latest_version_id → plugin_versions.id
    with op.batch_alter_table('plugins') as batch_op:
        batch_op.create_foreign_key(
            'fk_plugin_latest_version',
            'plugin_versions',
            ['latest_version_id'],
            ['id'],
        )

    # user_plugins table
    op.create_table(
        'user_plugins',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('plugin_id', sa.String(36), nullable=False),
        sa.Column('plugin_version_id', sa.String(36), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False),
        sa.Column('installed_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['plugin_id'], ['plugins.id']),
        sa.ForeignKeyConstraint(['plugin_version_id'], ['plugin_versions.id']),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'plugin_id'),
    )


def downgrade() -> None:
    op.drop_table('user_plugins')
    with op.batch_alter_table('plugins') as batch_op:
        batch_op.drop_constraint('fk_plugin_latest_version', type_='foreignkey')
    op.drop_index('ix_plugin_versions_content_hash', table_name='plugin_versions')
    op.drop_table('plugin_versions')
    op.drop_table('plugins')
