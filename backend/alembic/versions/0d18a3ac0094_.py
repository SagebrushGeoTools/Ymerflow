"""empty message

Revision ID: 0d18a3ac0094
Revises: 1ea01ae13416
Create Date: 2026-01-29 23:47:43.277906

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import sqlite

# revision identifiers, used by Alembic.
revision: str = '0d18a3ac0094'
down_revision: Union[str, Sequence[str], None] = '1ea01ae13416'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Check if outputs column exists before dropping it
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    existing_columns = [col['name'] for col in inspector.get_columns('process_versions')]

    # Drop outputs column from process_versions if it exists (SQLite-compatible)
    if 'outputs' in existing_columns:
        with op.batch_alter_table('process_versions', schema=None) as batch_op:
            batch_op.drop_column('outputs')

    # Change type column from VARCHAR to Enum in user_transactions (SQLite-compatible)
    # Note: SQLite doesn't have native ENUM, so this just validates values at the app level
    with op.batch_alter_table('user_transactions', schema=None) as batch_op:
        batch_op.alter_column('type',
                   existing_type=sa.VARCHAR(length=6),
                   type_=sa.Enum('credit', 'debit', 'hold', 'release', name='transactiontype'),
                   existing_nullable=False)


def downgrade() -> None:
    """Downgrade schema."""
    # Restore type column to VARCHAR in user_transactions (SQLite-compatible)
    with op.batch_alter_table('user_transactions', schema=None) as batch_op:
        batch_op.alter_column('type',
                   existing_type=sa.Enum('credit', 'debit', 'hold', 'release', name='transactiontype'),
                   type_=sa.VARCHAR(length=6),
                   existing_nullable=False)

    # Restore outputs column to process_versions
    with op.batch_alter_table('process_versions', schema=None) as batch_op:
        batch_op.add_column(sa.Column('outputs', sqlite.JSON(), nullable=False))
