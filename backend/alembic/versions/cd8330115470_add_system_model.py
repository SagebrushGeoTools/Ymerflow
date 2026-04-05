"""add_system_model

Revision ID: cd8330115470
Revises: e965b073aab8
Create Date: 2026-02-11 22:30:04.000646

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import table, column, String, LargeBinary, DateTime
import base64
from datetime import datetime, timezone
import uuid

# Pre-serialized SkyTEM 304 GEX data (msgpack+numpy encoding of gex_dict).
# Generated from: data/20201231_20023_IVF_SkyTEM304_SKB.gex
_SKYTEM304_GEX_B64 = (
    "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VHhBcHByb3hpbWF0ZUN1cnJlbnTLQCGZmZmZmZq3UmVjZWl2ZXJQb2xhcml6YXRpb25YWVqhWrJBcHByb3hEaXBvbGVNb21lbnTLQKeDMzMzMzSoQ2hhbm5lbDLeABCsUnhDb2lsTnVtYmVyyz/wAAAAAAAArUdhdGVUaW1lU2hpZnTLvr4y8O4URTGqR2F0ZUZhY3Rvcss/764UeuFHrrlTeXN0ZW1SZXNwb25zZUNvbnZvbHV0aW9uywAAAAAAAAAAslJlbW92ZUluaXRpYWxHYXRlc8tAHAAAAAAAALlQcmltYXJ5RmllbGREYW1waW5nRmFjdG9yyz+EeuFHrhR7rlVuaWZvcm1EYXRhU1REyz+euFHrhR64rE1lYVRpbWVEZWxhecs/D3UQTVUdaadOb0dhdGVzy0BCgAAAAAAAp1JlcEZyZXHLQD4AAAAAAACtRnJvbnRHYXRlVGltZcs/Elme18b70rBUaUJMb3dQYXNzRmlsdGVyhcQCbmTDxAR0eXBlozxmOMQEa2luZMQAxAVzaGFwZZECxARkYXRhxBAAAAAAAADwPwAAAACATxJBsVRyYW5zbWl0dGVyTW9tZW50okhNtFR4QXBwcm94aW1hdGVDdXJyZW50y0BcbMzMzMzNt1JlY2VpdmVyUG9sYXJpemF0aW9uWFlaoVqyQXBwcm94RGlwb2xlTW9tZW50y0EC/KzMzMzN"
)


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

    gex_bytes = base64.b64decode(_SKYTEM304_GEX_B64)

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
