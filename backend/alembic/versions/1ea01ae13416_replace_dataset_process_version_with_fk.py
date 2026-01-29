"""replace_dataset_process_version_with_fk

Revision ID: 1ea01ae13416
Revises: 08adf96a1437
Create Date: 2026-01-29 23:05:02.966200

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1ea01ae13416'
down_revision: Union[str, Sequence[str], None] = '08adf96a1437'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Step 1: Add new process_version_id column (nullable initially)
    op.add_column('datasets', sa.Column('process_version_id', sa.Integer(), nullable=True))

    # Step 2: Populate process_version_id by looking up ProcessVersion records
    # This requires a data migration using SQL
    op.execute("""
        UPDATE datasets
        SET process_version_id = (
            SELECT pv.id
            FROM process_versions pv
            WHERE pv.process_id = datasets.process_id
            AND pv.version = datasets.process_version
        )
    """)

    # Step 3-6: Use batch mode for SQLite compatibility
    with op.batch_alter_table('datasets', schema=None) as batch_op:
        # Make process_version_id NOT NULL
        batch_op.alter_column('process_version_id', nullable=False)

        # Create foreign key constraint
        batch_op.create_foreign_key(
            'fk_datasets_process_version_id',
            'process_versions',
            ['process_version_id'],
            ['id'],
            ondelete='CASCADE'
        )

        # Create index on process_version_id
        batch_op.create_index(
            batch_op.f('ix_datasets_process_version_id'),
            ['process_version_id'],
            unique=False
        )

        # Drop old process_version column
        batch_op.drop_column('process_version')


def downgrade() -> None:
    """Downgrade schema."""
    # Step 1: Add back process_version column (nullable initially)
    op.add_column('datasets', sa.Column('process_version', sa.Integer(), nullable=True))

    # Step 2: Populate process_version from ProcessVersion relationship
    op.execute("""
        UPDATE datasets
        SET process_version = (
            SELECT pv.version
            FROM process_versions pv
            WHERE pv.id = datasets.process_version_id
        )
    """)

    # Step 3-6: Use batch mode for SQLite compatibility
    with op.batch_alter_table('datasets', schema=None) as batch_op:
        # Make process_version NOT NULL
        batch_op.alter_column('process_version', nullable=False)

        # Drop index on process_version_id
        batch_op.drop_index(batch_op.f('ix_datasets_process_version_id'))

        # Drop foreign key constraint
        batch_op.drop_constraint('fk_datasets_process_version_id', type_='foreignkey')

        # Drop process_version_id column
        batch_op.drop_column('process_version_id')
