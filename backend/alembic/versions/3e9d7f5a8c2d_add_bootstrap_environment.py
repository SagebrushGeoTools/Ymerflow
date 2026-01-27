"""add_bootstrap_environment

Revision ID: 3e9d7f5a8c2d
Revises: 2d8f3a9c4b1e
Create Date: 2026-01-26 12:30:00.000000

"""
from typing import Sequence, Union
from datetime import datetime

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3e9d7f5a8c2d'
down_revision: Union[str, Sequence[str], None] = '2d8f3a9c4b1e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add bootstrap environment with process_id=NULL."""
    conn = op.get_bind()

    # Check if bootstrap environment already exists
    result = conn.execute(
        sa.text("SELECT COUNT(*) FROM environments WHERE id = 'default-environment-00000000-0000-0000-0000-000000000000'")
    ).fetchone()

    # If it doesn't exist, create it
    if result[0] == 0:
        now = datetime.utcnow().isoformat()
        conn.execute(sa.text("""
            INSERT INTO environments (id, name, docker_image, process_id, created_at)
            VALUES (
                'default-environment-00000000-0000-0000-0000-000000000000',
                'Default Environment',
                'nagelfluh-default:0.1',
                NULL,
                :created_at
            )
        """), {"created_at": now})


def downgrade() -> None:
    """Remove bootstrap environment (but only if it wasn't created by a process)."""
    conn = op.get_bind()

    # Only delete if process_id is NULL (bootstrap environment)
    conn.execute(sa.text("""
        DELETE FROM environments
        WHERE id = 'default-environment-00000000-0000-0000-0000-000000000000'
        AND process_id IS NULL
    """))
