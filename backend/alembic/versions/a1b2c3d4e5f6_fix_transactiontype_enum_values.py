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
    # ALTER TYPE ADD VALUE cannot run inside a transaction on PostgreSQL < 12,
    # and even on 12+ it blocks until all connections release the type lock.
    # Use autocommit_block to run it outside the migration transaction.
    # All statements run in autocommit mode so each is its own transaction.
    # The UPDATE must see the committed ADD VALUE results, which requires a
    # fresh transaction — impossible inside the outer Alembic transaction.
    with op.get_context().autocommit_block():
        op.execute(sa.text("ALTER TYPE transactiontype ADD VALUE IF NOT EXISTS 'credit'"))
        op.execute(sa.text("ALTER TYPE transactiontype ADD VALUE IF NOT EXISTS 'debit'"))
        op.execute(sa.text("ALTER TYPE transactiontype ADD VALUE IF NOT EXISTS 'hold'"))
        op.execute(sa.text("ALTER TYPE transactiontype ADD VALUE IF NOT EXISTS 'release'"))
        op.execute(sa.text("UPDATE user_transactions SET type = 'credit'::transactiontype WHERE type::text = 'CREDIT'"))
        op.execute(sa.text("UPDATE user_transactions SET type = 'debit'::transactiontype WHERE type::text = 'DEBIT'"))


def downgrade() -> None:
    # PostgreSQL does not support removing enum values; downgrade is a no-op
    pass
