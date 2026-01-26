"""remove_root_columns_use_parts

Revision ID: 1ce14bf0a7e1
Revises: 6692e6840e40
Create Date: 2026-01-26 11:20:38.568662

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1ce14bf0a7e1'
down_revision: Union[str, Sequence[str], None] = '6692e6840e40'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Migrate root-level file_url and geography_url into parts dict, then remove columns."""
    # Get connection for data migration
    conn = op.get_bind()

    # Migrate existing data: move file_url and geography_url into parts[""]
    # First, fetch all datasets with file_url or geography_url
    datasets = conn.execute(sa.text(
        "SELECT id, mime_type, file_url, geography_url, parts FROM datasets "
        "WHERE file_url IS NOT NULL OR geography_url IS NOT NULL"
    )).fetchall()

    # Update each dataset to include root part in parts dict
    for dataset in datasets:
        dataset_id, mime_type, file_url, geography_url, parts_json = dataset

        # Parse existing parts
        import json
        parts = json.loads(parts_json) if parts_json else {}

        # Add root part if file_url or geography_url exists
        if file_url or geography_url:
            parts[""] = {}
            if mime_type:
                parts[""]["mime_type"] = mime_type
            if file_url:
                parts[""]["file_url"] = file_url
            if geography_url:
                parts[""]["geography_url"] = geography_url

        # Update the record
        conn.execute(
            sa.text("UPDATE datasets SET parts = :parts WHERE id = :id"),
            {"parts": json.dumps(parts), "id": dataset_id}
        )

    # Now drop the old columns
    op.drop_column('datasets', 'geography_url')
    op.drop_column('datasets', 'file_url')


def downgrade() -> None:
    """Restore file_url and geography_url columns from parts[""]."""
    # Re-add the columns
    op.add_column('datasets', sa.Column('file_url', sa.String(length=500), nullable=True))
    op.add_column('datasets', sa.Column('geography_url', sa.String(length=500), nullable=True))

    # Get connection for data migration
    conn = op.get_bind()

    # Migrate data back: extract parts[""] into file_url and geography_url
    datasets = conn.execute(sa.text("SELECT id, parts FROM datasets")).fetchall()

    for dataset in datasets:
        dataset_id, parts_json = dataset

        # Parse parts
        import json
        parts = json.loads(parts_json) if parts_json else {}

        # Extract root part if it exists
        root_part = parts.get("")
        if root_part:
            file_url = root_part.get("file_url")
            geography_url = root_part.get("geography_url")

            # Update the record
            if file_url or geography_url:
                conn.execute(
                    sa.text("UPDATE datasets SET file_url = :file_url, geography_url = :geography_url WHERE id = :id"),
                    {"file_url": file_url, "geography_url": geography_url, "id": dataset_id}
                )

            # Remove root part from parts dict
            del parts[""]
            conn.execute(
                sa.text("UPDATE datasets SET parts = :parts WHERE id = :id"),
                {"parts": json.dumps(parts), "id": dataset_id}
            )
