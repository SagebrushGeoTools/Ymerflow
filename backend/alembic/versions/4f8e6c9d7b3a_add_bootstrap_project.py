"""add_bootstrap_project

Revision ID: 4f8e6c9d7b3a
Revises: 3e9d7f5a8c2d
Create Date: 2026-01-26 12:45:00.000000

"""
from typing import Sequence, Union
from datetime import datetime

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4f8e6c9d7b3a'
down_revision: Union[str, Sequence[str], None] = '3e9d7f5a8c2d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add bootstrap project."""
    conn = op.get_bind()

    # Check if bootstrap project already exists
    result = conn.execute(
        sa.text("SELECT COUNT(*) FROM projects WHERE id = 'default-project-00000000-0000-0000-0000-000000000000'")
    ).fetchone()

    # If it doesn't exist, create it
    if result[0] == 0:
        now = datetime.utcnow().isoformat()
        conn.execute(sa.text("""
            INSERT INTO projects (id, name, created_at)
            VALUES (
                'default-project-00000000-0000-0000-0000-000000000000',
                'Default',
                :created_at
            )
        """), {"created_at": now})


def downgrade() -> None:
    """Remove bootstrap project."""
    conn = op.get_bind()

    # Delete the bootstrap project
    conn.execute(sa.text("""
        DELETE FROM projects
        WHERE id = 'default-project-00000000-0000-0000-0000-000000000000'
    """))
