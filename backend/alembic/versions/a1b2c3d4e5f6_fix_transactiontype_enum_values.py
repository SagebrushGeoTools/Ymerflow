"""fix transactiontype enum values

Revision ID: a1b2c3d4e5f6
Revises: 7a1b2c3d4e5f
Create Date: 2026-04-10 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '7a1b2c3d4e5f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add lowercase enum values (PostgreSQL 12+ supports this inside a transaction)
    op.execute(sa.text("ALTER TYPE transactiontype ADD VALUE IF NOT EXISTS 'credit'"))
    op.execute(sa.text("ALTER TYPE transactiontype ADD VALUE IF NOT EXISTS 'debit'"))
    op.execute(sa.text("ALTER TYPE transactiontype ADD VALUE IF NOT EXISTS 'hold'"))
    op.execute(sa.text("ALTER TYPE transactiontype ADD VALUE IF NOT EXISTS 'release'"))

    # Migrate any existing uppercase rows to lowercase
    op.execute(sa.text("UPDATE user_transactions SET type = 'credit'::transactiontype WHERE type::text = 'CREDIT'"))
    op.execute(sa.text("UPDATE user_transactions SET type = 'debit'::transactiontype WHERE type::text = 'DEBIT'"))


def downgrade() -> None:
    # PostgreSQL does not support removing enum values; downgrade is a no-op
    pass
