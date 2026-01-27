"""Seed default data

Revision ID: 1bb9f6022bec
Revises: 59e0619beed9
Create Date: 2026-01-25 17:27:59.697235

"""
from typing import Sequence, Union
from datetime import datetime
import json

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1bb9f6022bec'
down_revision: Union[str, Sequence[str], None] = '59e0619beed9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Process types definition
PROCESS_TYPES = {
    "fft": {
        "schema": {
            "type": "object",
            "properties": {
                "input_signal": {
                    "type": "string",
                    "format": "uri",
                    "x-format": "dataset",
                    "title": "Input Signal"
                },
                "window": {"type": "number", "default": 1.0},
                "overlap": {"type": "number", "default": 0.5}
            },
            "required": ["window"]
        }
    },
    "inversion": {
        "schema": {
            "type": "object",
            "properties": {
                "input_data": {
                    "type": "string",
                    "format": "uri",
                    "x-format": "dataset",
                    "title": "Input Dataset"
                },
                "regularization": {"type": "number", "default": 0.1},
                "max_iter": {"type": "integer", "default": 50}
            }
        }
    },
    "import_data": {
        "schema": {
            "type": "object",
            "properties": {
                "data_file": {
                    "type": "string",
                    "format": "uri",
                    "x-format": "upload",
                    "title": "Data File"
                },
                "file_format": {
                    "type": "string",
                    "enum": ["csv", "xyz", "json"],
                    "default": "csv",
                    "title": "File Format"
                }
            },
            "required": ["data_file"]
        }
    }
}

# Default workspace layout
DEFAULT_WORKSPACE_LAYOUT = {
    "splitType": "vertical",
    "id": "root",
    "widget": "VerticalSplit",
    "children": [
        {
            "id": "35501582-95b5-458e-b8ca-3a2b63413eac",
            "widget": "FlowView"
        },
        {
            "id": "794e8232-a793-4ff6-9372-3c94169a3eac",
            "widget": "TabSet",
            "children": [
                {
                    "id": "8658b5f1-d171-49b0-8dd9-73e46b469e5d",
                    "widget": "ProcessEditor"
                },
                {
                    "id": "d1e9273c-c3ca-4261-b14a-55cc0e45f583",
                    "widget": "PlotView"
                }
            ]
        }
    ]
}


def upgrade() -> None:
    """Seed default data."""
    # Get current timestamp
    now = datetime.utcnow().isoformat()

    # Insert default project
    op.execute(f"""
        INSERT INTO projects (id, name, created_at)
        VALUES (
            'default-project-00000000-0000-0000-0000-000000000000',
            'Default',
            '{now}'
        )
    """)

    # Insert default environment
    op.execute(f"""
        INSERT INTO environments (id, name, docker_image, packages, process_types, created_at)
        VALUES (
            'default-environment-00000000-0000-0000-0000-000000000000',
            'Default Environment',
            'nagelfluh-default:0.1',
            '{json.dumps([
                {"name": "numpy", "version": "1.24.0"},
                {"name": "pandas", "version": "2.0.0"},
                {"name": "libaarhusxyz", "version": "0.1.0"}
            ])}',
            '{json.dumps(PROCESS_TYPES)}',
            '{now}'
        )
    """)

    # Insert default workspace
    op.execute(f"""
        INSERT INTO workspaces (id, title, layout, created_at, updated_at)
        VALUES (
            'default',
            'Default',
            '{json.dumps(DEFAULT_WORKSPACE_LAYOUT)}',
            '{now}',
            '{now}'
        )
    """)


def downgrade() -> None:
    """Remove default data."""
    op.execute("DELETE FROM workspaces WHERE id = 'default'")
    op.execute("DELETE FROM environments WHERE id = 'default-environment-00000000-0000-0000-0000-000000000000'")
    op.execute("DELETE FROM projects WHERE id = 'default-project-00000000-0000-0000-0000-000000000000'")
