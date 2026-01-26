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

    # Use batch mode for SQLite compatibility
    with op.batch_alter_table('environments', schema=None) as batch_op:
        # Add process_id column (nullable FK to processes) if it doesn't exist
        if 'process_id' not in columns:
            batch_op.add_column(sa.Column('process_id', sa.String(255), nullable=True))
            batch_op.create_foreign_key(
                'fk_environments_process_id',
                'processes',
                ['process_id'],
                ['id'],
                ondelete='CASCADE'
            )
            batch_op.create_index('ix_environments_process_id', ['process_id'])

        # Remove packages and process_types columns if they exist
        # (their data will now come from the creating process's parameters)
        if 'packages' in columns:
            batch_op.drop_column('packages')
        if 'process_types' in columns:
            batch_op.drop_column('process_types')

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
    # Use batch mode for SQLite compatibility
    with op.batch_alter_table('environments', schema=None) as batch_op:
        # Re-add packages and process_types columns
        batch_op.add_column(sa.Column('packages', sa.JSON(), nullable=False, server_default='[]'))
        batch_op.add_column(sa.Column('process_types', sa.JSON(), nullable=False, server_default='{}'))

        # Remove process_id column
        batch_op.drop_index('ix_environments_process_id')
        batch_op.drop_constraint('fk_environments_process_id', type_='foreignkey')
        batch_op.drop_column('process_id')
