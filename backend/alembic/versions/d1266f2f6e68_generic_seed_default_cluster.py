"""generic seed override for default cluster

Revision ID: d1266f2f6e68
Revises: 9623bab8493d
Create Date: 2026-07-15
"""
from alembic import op
import sqlalchemy as sa
import json
import os

revision = 'd1266f2f6e68'
down_revision = '9623bab8493d'
branch_labels = None
depends_on = None

DEFAULT_ID = 'default-cluster-00000000-0000-0000-0000-000000000000'


def upgrade() -> None:
    """Generic follow-up to f6a7b8c9d0e1 (initial, now-stale seed) / 5ebf42871eb0 (which
    migrated the seeded row's kubeconfig into cluster_type/provider_config), per Design
    decision 7 in docs/plans/registry-backend-hooks.md: mirror 50dd9ce3311b's generic
    `<AXIS>_PROTOCOL`/`<AXIS>_CONFIG_JSON` pattern for the cluster axis, as a follow-up UPDATE
    rather than an INSERT, since the default row already exists by this point in the migration
    chain. Uses CLUSTER_TYPE (matching Cluster.cluster_type's actual field name, and the same
    var name backend/bin/nagelfluh-bootstrap-provision already uses) rather than
    CLUSTER_PROTOCOL.

    If CLUSTER_TYPE/CLUSTER_CONFIG_JSON are both set, an operator has made a deliberate,
    authoritative choice that should win over whatever cluster_type/provider_config the earlier
    fallback-seeding migrations already put in place, so this unconditionally overrides them on
    the default row. If either env var is unset, this is a no-op and today's already-seeded
    values (cluster_type='same-as-backend', provider_config={} from 5ebf42871eb0) stand
    unchanged.
    """
    cluster_type = os.getenv("CLUSTER_TYPE")
    config_json = os.getenv("CLUSTER_CONFIG_JSON")
    if not cluster_type or not config_json:
        return

    conn = op.get_bind()
    conn.execute(sa.text("""
        UPDATE clusters SET cluster_type = :cluster_type, provider_config = :provider_config
        WHERE id = :id
    """), {
        "id": DEFAULT_ID,
        "cluster_type": cluster_type,
        "provider_config": json.dumps(json.loads(config_json)),
    })


def downgrade() -> None:
    pass  # cannot cleanly undo — config may have been legitimately edited since
