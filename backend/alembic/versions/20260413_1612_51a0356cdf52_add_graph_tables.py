"""add graph tables

Revision ID: 51a0356cdf52
Revises: f7cf0c56285f
Create Date: 2026-04-13 16:12:38.068795
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "51a0356cdf52"
down_revision: str | None = "f7cf0c56285f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "graph_nodes",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("project_id", sa.String(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", sa.String(32), nullable=False),
        sa.Column("label", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("created_by", sa.String(16), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("source_step_ids", sa.JSON(), nullable=False),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("position_x", sa.Float(), nullable=True),
        sa.Column("position_y", sa.Float(), nullable=True),
        sa.Column("meta_json", sa.JSON(), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_graph_nodes_project_id", "graph_nodes", ["project_id"])
    op.create_index("ix_graph_nodes_type", "graph_nodes", ["type"])

    op.create_table(
        "graph_edges",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("project_id", sa.String(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_id", sa.String(), sa.ForeignKey("graph_nodes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_id", sa.String(), sa.ForeignKey("graph_nodes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("source_step_id", sa.String(), nullable=True),
        sa.Column("command", sa.Text(), nullable=True),
        sa.Column("tool", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("label", sa.String(255), nullable=True),
        sa.Column("meta_json", sa.JSON(), nullable=False),
    )
    op.create_index("ix_graph_edges_project_id", "graph_edges", ["project_id"])
    op.create_index("ix_graph_edges_source_id", "graph_edges", ["source_id"])
    op.create_index("ix_graph_edges_target_id", "graph_edges", ["target_id"])
    op.create_index("ix_graph_edges_kind", "graph_edges", ["kind"])

    op.create_table(
        "graph_scenarios",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("project_id", sa.String(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("color", sa.String(24), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_graph_scenarios_project_id", "graph_scenarios", ["project_id"])

    op.create_table(
        "graph_scenario_nodes",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("scenario_id", sa.String(), sa.ForeignKey("graph_scenarios.id", ondelete="CASCADE"), nullable=False),
        sa.Column("node_id", sa.String(), sa.ForeignKey("graph_nodes.id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("scenario_id", "node_id", name="uq_graph_scenario_node"),
    )
    op.create_index("ix_graph_scenario_nodes_scenario_id", "graph_scenario_nodes", ["scenario_id"])
    op.create_index("ix_graph_scenario_nodes_node_id", "graph_scenario_nodes", ["node_id"])

    op.create_table(
        "graph_scenario_edges",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("scenario_id", sa.String(), sa.ForeignKey("graph_scenarios.id", ondelete="CASCADE"), nullable=False),
        sa.Column("edge_id", sa.String(), sa.ForeignKey("graph_edges.id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("scenario_id", "edge_id", name="uq_graph_scenario_edge"),
    )
    op.create_index("ix_graph_scenario_edges_scenario_id", "graph_scenario_edges", ["scenario_id"])
    op.create_index("ix_graph_scenario_edges_edge_id", "graph_scenario_edges", ["edge_id"])


def downgrade() -> None:
    op.drop_index("ix_graph_scenario_edges_edge_id", table_name="graph_scenario_edges")
    op.drop_index("ix_graph_scenario_edges_scenario_id", table_name="graph_scenario_edges")
    op.drop_table("graph_scenario_edges")

    op.drop_index("ix_graph_scenario_nodes_node_id", table_name="graph_scenario_nodes")
    op.drop_index("ix_graph_scenario_nodes_scenario_id", table_name="graph_scenario_nodes")
    op.drop_table("graph_scenario_nodes")

    op.drop_index("ix_graph_scenarios_project_id", table_name="graph_scenarios")
    op.drop_table("graph_scenarios")

    op.drop_index("ix_graph_edges_kind", table_name="graph_edges")
    op.drop_index("ix_graph_edges_target_id", table_name="graph_edges")
    op.drop_index("ix_graph_edges_source_id", table_name="graph_edges")
    op.drop_index("ix_graph_edges_project_id", table_name="graph_edges")
    op.drop_table("graph_edges")

    op.drop_index("ix_graph_nodes_type", table_name="graph_nodes")
    op.drop_index("ix_graph_nodes_project_id", table_name="graph_nodes")
    op.drop_table("graph_nodes")
