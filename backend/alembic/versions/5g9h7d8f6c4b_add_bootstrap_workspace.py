"""add_bootstrap_workspace

Revision ID: 5g9h7d8f6c4b
Revises: 4f8e6c9d7b3a
Create Date: 2026-01-26 12:50:00.000000

"""
from typing import Sequence, Union
from datetime import datetime
import json

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5g9h7d8f6c4b'
down_revision: Union[str, Sequence[str], None] = '4f8e6c9d7b3a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Default workspace layout
DEFAULT_WORKSPACE_LAYOUT = {
    "splitType": "vertical",
    "id": "root",
    "widget": "VerticalSplit",
    "children": [
        {
            "id": "35501582-95b5-458e-b8ca-3a2b63413eac",
            "widget": "FlowView"
        },
        {
            "id": "794e8232-a793-4ff6-9372-3c94169a3eac",
            "widget": "TabSet",
            "children": [
                {
                    "id": "8658b5f1-d171-49b0-8dd9-73e46b469e5d",
                    "widget": "ProcessEditor"
                },
                {
                    "id": "d1e9273c-c3ca-4261-b14a-55cc0e45f583",
                    "widget": "PlotView"
                }
            ]
        }
    ]
}


def upgrade() -> None:
    """Add bootstrap workspace."""
    conn = op.get_bind()

    # Check if bootstrap workspace already exists
    result = conn.execute(
        sa.text("SELECT COUNT(*) FROM workspaces WHERE id = 'default'")
    ).fetchone()

    # If it doesn't exist, create it
    if result[0] == 0:
        now = datetime.utcnow().isoformat()
        conn.execute(sa.text("""
            INSERT INTO workspaces (id, title, layout, created_at, updated_at)
            VALUES (
                'default',
                'Default',
                :layout,
                :created_at,
                :updated_at
            )
        """), {
            "layout": json.dumps(DEFAULT_WORKSPACE_LAYOUT),
            "created_at": now,
            "updated_at": now
        })


def downgrade() -> None:
    """Remove bootstrap workspace."""
    conn = op.get_bind()

    # Delete the bootstrap workspace
    conn.execute(sa.text("""
        DELETE FROM workspaces
        WHERE id = 'default'
    """))
