"""merge flyte and bootstrap branches

Revision ID: 67cbcb518418
Revises: 6h8i9j0k1l2m, 5g9h7d8f6c4b
Create Date: 2026-01-27 09:04:11.043264

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '67cbcb518418'
down_revision: Union[str, Sequence[str], None] = ('6h8i9j0k1l2m', '5g9h7d8f6c4b')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
