"""Initial schema

Revision ID: 59e0619beed9
Revises: 
Create Date: 2026-01-25 17:27:44.790952

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '59e0619beed9'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Create users table
    op.create_table(
        'users',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('username', sa.String(length=255), nullable=False),
        sa.Column('password_hash', sa.String(length=255), nullable=False),
        sa.Column('balance', sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column('preferences', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_users_username'), 'users', ['username'], unique=True)

    # Create projects table
    op.create_table(
        'projects',
        sa.Column('id', sa.String(length=255), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )

    # Create environments table
    op.create_table(
        'environments',
        sa.Column('id', sa.String(length=255), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('docker_image', sa.String(length=255), nullable=False),
        sa.Column('packages', sa.JSON(), nullable=False),
        sa.Column('process_types', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )

    # Create workspaces table
    op.create_table(
        'workspaces',
        sa.Column('id', sa.String(length=255), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('layout', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )

    # Create uploads table
    op.create_table(
        'uploads',
        sa.Column('id', sa.String(length=255), nullable=False),
        sa.Column('filename', sa.String(length=500), nullable=False),
        sa.Column('content_type', sa.String(length=255), nullable=False),
        sa.Column('file_url', sa.String(length=500), nullable=False),
        sa.Column('uploaded_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )

    # Create processes table (depends on projects and environments)
    op.create_table(
        'processes',
        sa.Column('id', sa.String(length=255), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('type', sa.String(length=100), nullable=False),
        sa.Column('environment_id', sa.String(length=255), nullable=False),
        sa.Column('project_id', sa.String(length=255), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['environment_id'], ['environments.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_processes_environment_id'), 'processes', ['environment_id'], unique=False)
    op.create_index(op.f('ix_processes_project_id'), 'processes', ['project_id'], unique=False)

    # Create user_transactions table (depends on users and processes)
    op.create_table(
        'user_transactions',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('timestamp', sa.DateTime(), nullable=False),
        sa.Column('type', sa.Enum('CREDIT', 'DEBIT', name='transactiontype'), nullable=False),
        sa.Column('description', sa.String(length=500), nullable=False),
        sa.Column('amount', sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column('process_id', sa.String(length=255), nullable=True),
        sa.Column('process_version', sa.Integer(), nullable=True),
        sa.Column('process_name', sa.String(length=255), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['process_id'], ['processes.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_user_transactions_user_id'), 'user_transactions', ['user_id'], unique=False)
    op.create_index(op.f('ix_user_transactions_timestamp'), 'user_transactions', ['timestamp'], unique=False)

    # Create datasets table (depends on processes and projects)
    op.create_table(
        'datasets',
        sa.Column('id', sa.String(length=255), nullable=False),
        sa.Column('mime_type', sa.String(length=255), nullable=False),
        sa.Column('process_id', sa.String(length=255), nullable=False),
        sa.Column('process_name', sa.String(length=255), nullable=False),
        sa.Column('process_version', sa.Integer(), nullable=False),
        sa.Column('dataset_name', sa.String(length=255), nullable=False),
        sa.Column('project_id', sa.String(length=255), nullable=False),
        sa.Column('file_url', sa.String(length=500), nullable=True),
        sa.Column('geography_url', sa.String(length=500), nullable=True),
        sa.Column('parts', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['process_id'], ['processes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_datasets_process_id'), 'datasets', ['process_id'], unique=False)
    op.create_index(op.f('ix_datasets_process_name'), 'datasets', ['process_name'], unique=False)
    op.create_index(op.f('ix_datasets_dataset_name'), 'datasets', ['dataset_name'], unique=False)
    op.create_index(op.f('ix_datasets_project_id'), 'datasets', ['project_id'], unique=False)
    op.create_index('ix_dataset_search', 'datasets', ['project_id', 'process_name', 'dataset_name'], unique=False)

    # Create process_versions table (depends on processes)
    op.create_table(
        'process_versions',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('process_id', sa.String(length=255), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('parameters', sa.JSON(), nullable=False),
        sa.Column('outputs', sa.JSON(), nullable=False),
        sa.Column('state', sa.Enum('QUEUED', 'RUNNING', 'DONE', 'FAILED', name='processstate'), nullable=False),
        sa.Column('dependencies', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['process_id'], ['processes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('process_id', 'version', name='uq_process_version')
    )
    op.create_index(op.f('ix_process_versions_process_id'), 'process_versions', ['process_id'], unique=False)
    op.create_index(op.f('ix_process_versions_state'), 'process_versions', ['state'], unique=False)

    # Create process_logs table (depends on processes)
    op.create_table(
        'process_logs',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('process_id', sa.String(length=255), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('timestamp', sa.DateTime(), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(['process_id'], ['processes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_process_logs_process_id'), 'process_logs', ['process_id'], unique=False)
    op.create_index(op.f('ix_process_logs_timestamp'), 'process_logs', ['timestamp'], unique=False)
    op.create_index('ix_process_log_lookup', 'process_logs', ['process_id', 'version', 'timestamp'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    # Drop tables in reverse order to respect foreign key constraints
    op.drop_table('process_logs')
    op.drop_table('process_versions')
    op.drop_table('datasets')
    op.drop_table('user_transactions')
    op.drop_table('processes')
    op.drop_table('uploads')
    op.drop_table('workspaces')
    op.drop_table('environments')
    op.drop_table('projects')
    op.drop_table('users')
