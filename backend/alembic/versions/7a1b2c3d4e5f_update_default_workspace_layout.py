"""update_default_workspace_layout

Revision ID: 7a1b2c3d4e5f
Revises: cd8330115470
Create Date: 2026-02-21 00:00:00.000000

"""
from typing import Sequence, Union
import json

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7a1b2c3d4e5f'
down_revision: Union[str, Sequence[str], None] = 'cd8330115470'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_LAYOUT = {"splitType": "vertical", "id": "root", "widget": "VerticalSplit", "children": [{"id": "35501582-95b5-458e-b8ca-3a2b63413eac", "widget": "FlowView"}, {"id": "794e8232-a793-4ff6-9372-3c94169a3eac", "widget": "TabSet", "children": [{"id": "8658b5f1-d171-49b0-8dd9-73e46b469e5d", "widget": "ProcessEditor"}, {"id": "222219fe-87f7-4788-8ebb-32c4c1156277", "widget": "MapView", "layoutConfig": {"elements": [{"type": "GeoJSON", "params": {"dataset": "imported_data", "defaultColor": "red", "highlightColor": "darkred", "opacity": 0.6}}]}}, {"id": "0003354d-7fa5-4253-97d0-4f516ebaabf1", "widget": "MapView", "layoutConfig": {"elements": [{"type": "GeoJSON", "params": {"dataset": "imported_data", "defaultColor": "red", "highlightColor": "darkred", "opacity": 0.6}}]}}, {"id": "41b923f1-7fb6-4a3a-b5b8-f4d5e0b7bb9f", "widget": "Export"}, {"id": "018fe659-a0ff-4827-b8bd-3532eb7c9b17", "widget": "ProcessLog"}, {"id": "8bd40b33-823b-4d60-91a4-e2927d69e419", "widget": "PlotView", "layoutConfig": {"layers": [{"ResistivityCurtain": {"topo_column": "topo", "cmin": 1, "cmax": 1000, "dataset": "smooth_model"}}], "axes": {"xaxis_bottom": {"label": "Distance (m)", "scale": "linear", "min": 0, "max": 1}, "yaxis_left": {"label": "Elevation (m)", "scale": "linear", "min": 0, "max": 1}, "log_resistivity": {"colorbar": "none", "label": "Resistivity (\u03a9m)", "scale": "log", "colorscale": "turbo", "min": 4.62577331661684, "max": 288106.18409690063}}}}]}]}


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("""
        UPDATE workspaces
        SET layout = :layout
        WHERE id = 'default'
    """), {"layout": json.dumps(NEW_LAYOUT)})


def downgrade() -> None:
    old_layout = {"splitType": "vertical", "id": "root", "widget": "VerticalSplit", "children": [{"id": "35501582-95b5-458e-b8ca-3a2b63413eac", "widget": "FlowView"}, {"id": "794e8232-a793-4ff6-9372-3c94169a3eac", "widget": "TabSet", "children": [{"id": "8658b5f1-d171-49b0-8dd9-73e46b469e5d", "widget": "ProcessEditor"}, {"id": "d1e9273c-c3ca-4261-b14a-55cc0e45f583", "widget": "PlotView"}]}]}
    conn = op.get_bind()
    conn.execute(sa.text("""
        UPDATE workspaces
        SET layout = :layout
        WHERE id = 'default'
    """), {"layout": json.dumps(old_layout)})
