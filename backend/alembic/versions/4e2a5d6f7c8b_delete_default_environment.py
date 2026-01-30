"""delete_default_environment

Revision ID: 4e2a5d6f7c8b
Revises: 0d18a3ac0094
Create Date: 2026-01-30 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4e2a5d6f7c8b'
down_revision: Union[str, Sequence[str], None] = '0d18a3ac0094'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Delete the Default Environment (bootstrap environment).

    The bootstrap environment is no longer needed as users can create
    custom environments using the create_environment process.
    """
    conn = op.get_bind()

    # Delete the bootstrap environment
    conn.execute(sa.text("""
        DELETE FROM environments
        WHERE id = 'default-environment-00000000-0000-0000-0000-000000000000'
    """))


def downgrade() -> None:
    """Restore the Default Environment (bootstrap environment)."""
    from datetime import datetime

    conn = op.get_bind()

    # Check if bootstrap environment already exists
    result = conn.execute(
        sa.text("SELECT COUNT(*) FROM environments WHERE id = 'default-environment-00000000-0000-0000-0000-000000000000'")
    ).fetchone()

    # If it doesn't exist, recreate it
    if result[0] == 0:
        now = datetime.utcnow().isoformat()
        conn.execute(sa.text("""
            INSERT INTO environments (id, name, docker_image, process_id, created_at)
            VALUES (
                'default-environment-00000000-0000-0000-0000-000000000000',
                'Default Environment',
                'python:3.11',
                NULL,
                :created_at
            )
        """), {"created_at": now})
