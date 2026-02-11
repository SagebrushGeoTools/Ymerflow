"""add_system_model

Revision ID: cd8330115470
Revises: e965b073aab8
Create Date: 2026-02-11 22:30:04.000646

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import table, column, String, LargeBinary, DateTime
import sys
import os
from datetime import datetime
import uuid
import msgpack
import msgpack_numpy as m

# Add deps/libaarhusxyz to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', 'deps', 'libaarhusxyz'))
import libaarhusxyz

# Configure msgpack to handle numpy arrays
m.patch()


# revision identifiers, used by Alembic.
revision: str = 'cd8330115470'
down_revision: Union[str, Sequence[str], None] = 'e965b073aab8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Create systems table
    op.create_table(
        'systems',
        sa.Column('id', sa.String(length=255), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('gex', sa.LargeBinary(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )

    # Parse and insert initial GEX
    gex_path = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'data', '20201231_20023_IVF_SkyTEM304_SKB.gex')
    gex = libaarhusxyz.GEX(gex_path)

    # Serialize with msgpack (handles numpy arrays automatically)
    gex_bytes = msgpack.packb(gex.gex_dict, use_bin_type=True)

    # Define table for insert
    systems = table('systems',
        column('id', String),
        column('name', String),
        column('gex', LargeBinary),
        column('created_at', DateTime)
    )

    # Insert using direct connection
    op.execute(
        systems.insert().values(
            id=str(uuid.uuid4()),
            name="SkyTEM 304",
            gex=gex_bytes,
            created_at=datetime.utcnow()
        )
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('systems')
