"""replace clusters.kubeconfig with cluster_type + provider_config

Revision ID: 5ebf42871eb0
Revises: b707a57376f7
Create Date: 2026-07-09
"""
from alembic import op
import sqlalchemy as sa

revision = '5ebf42871eb0'
down_revision = 'b707a57376f7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('clusters') as batch_op:
        batch_op.add_column(sa.Column('cluster_type', sa.String(32), nullable=False, server_default='kubeconfig'))
        batch_op.add_column(sa.Column('provider_config', sa.JSON(), nullable=False, server_default='{}'))

    # Lightweight sa.table() construct (not raw string interpolation) so the JSON column's
    # bind/result processing is handled correctly on both SQLite and Postgres.
    clusters = sa.table(
        'clusters',
        sa.column('id', sa.String),
        sa.column('kubeconfig', sa.JSON),
        sa.column('cluster_type', sa.String),
        sa.column('provider_config', sa.JSON),
    )

    conn = op.get_bind()
    for row in conn.execute(sa.select(clusters.c.id, clusters.c.kubeconfig)):
        if row.kubeconfig is None:
            values = {"cluster_type": "same-as-backend", "provider_config": {}}
        else:
            values = {"cluster_type": "kubeconfig", "provider_config": {"kubeconfig": row.kubeconfig}}
        conn.execute(clusters.update().where(clusters.c.id == row.id).values(**values))

    with op.batch_alter_table('clusters') as batch_op:
        batch_op.drop_column('kubeconfig')


def downgrade() -> None:
    with op.batch_alter_table('clusters') as batch_op:
        batch_op.add_column(sa.Column('kubeconfig', sa.JSON(), nullable=True))

    clusters = sa.table(
        'clusters',
        sa.column('id', sa.String),
        sa.column('kubeconfig', sa.JSON),
        sa.column('cluster_type', sa.String),
        sa.column('provider_config', sa.JSON),
    )

    conn = op.get_bind()
    for row in conn.execute(sa.select(clusters.c.id, clusters.c.cluster_type, clusters.c.provider_config)):
        kubeconfig = row.provider_config.get('kubeconfig') if row.cluster_type == 'kubeconfig' else None
        conn.execute(clusters.update().where(clusters.c.id == row.id).values(kubeconfig=kubeconfig))

    with op.batch_alter_table('clusters') as batch_op:
        batch_op.drop_column('provider_config')
        batch_op.drop_column('cluster_type')
