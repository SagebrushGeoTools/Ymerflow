"""Add clusters table and process_versions.k8s_cluster_id

Revision ID: d1e2f3a4b5c6
Revises: c9d0e1f2a3b4
Create Date: 2026-07-07
"""
from alembic import op
import sqlalchemy as sa


revision = 'd1e2f3a4b5c6'
down_revision = 'c9d0e1f2a3b4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'clusters',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('kubeconfig', sa.JSON(), nullable=True),
        sa.Column('registry_url', sa.String(255), nullable=True),
        sa.Column('registry_auth', sa.String(255), nullable=True),
        sa.Column('namespace', sa.String(255), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )

    with op.batch_alter_table('process_versions') as batch_op:
        batch_op.add_column(sa.Column('k8s_cluster_id', sa.String(36), nullable=True))
        batch_op.create_foreign_key(
            'fk_process_versions_k8s_cluster_id',
            'clusters',
            ['k8s_cluster_id'],
            ['id'],
        )


def downgrade() -> None:
    with op.batch_alter_table('process_versions') as batch_op:
        batch_op.drop_constraint('fk_process_versions_k8s_cluster_id', type_='foreignkey')
        batch_op.drop_column('k8s_cluster_id')
    op.drop_table('clusters')
