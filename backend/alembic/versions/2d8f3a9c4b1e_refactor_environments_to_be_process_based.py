"""refactor_environments_to_be_process_based

Revision ID: 2d8f3a9c4b1e
Revises: 1ce14bf0a7e1
Create Date: 2026-01-26 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2d8f3a9c4b1e'
down_revision: Union[str, Sequence[str], None] = '1ce14bf0a7e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Refactor environments to be process-based.

    - Add process_id FK to environments (nullable)
    - Remove packages and process_types columns (data will come from process parameters)
    - Bootstrap environment keeps process_id=NULL
    """
    from datetime import datetime

    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [col['name'] for col in inspector.get_columns('environments')]

    # Add process_id column (nullable FK to processes) if it doesn't exist
    if 'process_id' not in columns:
        op.add_column('environments', sa.Column('process_id', sa.String(255), nullable=True))
        op.create_foreign_key(
            'fk_environments_process_id',
            'environments',
            'processes',
            ['process_id'],
            ['id'],
            ondelete='CASCADE'
        )
        op.create_index('ix_environments_process_id', 'environments', ['process_id'])

    # Remove packages and process_types columns if they exist
    # (their data will now come from the creating process's parameters)
    if 'packages' in columns:
        op.drop_column('environments', 'packages')
    if 'process_types' in columns:
        op.drop_column('environments', 'process_types')

    # Ensure bootstrap environment exists (process_id will be NULL by default)
    # Check if it already exists
    result = conn.execute(
        sa.text("SELECT COUNT(*) FROM environments WHERE id = 'default-environment-00000000-0000-0000-0000-000000000000'")
    ).fetchone()

    # If bootstrap environment doesn't exist, create it
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


def downgrade() -> None:
    """Restore packages and process_types columns."""
    # Re-add packages and process_types columns
    op.add_column('environments', sa.Column('packages', sa.JSON(), nullable=False, server_default='[]'))
    op.add_column('environments', sa.Column('process_types', sa.JSON(), nullable=False, server_default='{}'))

    # Remove process_id column
    op.drop_index('ix_environments_process_id', 'environments')
    op.drop_constraint('fk_environments_process_id', 'environments', type_='foreignkey')
    op.drop_column('environments', 'process_id')
