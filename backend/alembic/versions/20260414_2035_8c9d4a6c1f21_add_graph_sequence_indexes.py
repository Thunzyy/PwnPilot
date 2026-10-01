"""add sequence indexes to graph nodes and edges

Revision ID: 8c9d4a6c1f21
Revises: 51a0356cdf52
Create Date: 2026-04-14 20:35:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "8c9d4a6c1f21"
down_revision: str | None = "51a0356cdf52"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "graph_nodes",
        sa.Column("sequence_index", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "graph_edges",
        sa.Column("sequence_index", sa.Integer(), nullable=False, server_default="0"),
    )

    op.execute(
        sa.text(
            """
            WITH ordered AS (
                SELECT
                    id,
                    ROW_NUMBER() OVER (
                        PARTITION BY project_id
                        ORDER BY created_at ASC, id ASC
                    ) AS sequence_index
                FROM graph_nodes
            )
            UPDATE graph_nodes
            SET sequence_index = (
                SELECT ordered.sequence_index
                FROM ordered
                WHERE ordered.id = graph_nodes.id
            )
            """
        )
    )
    op.execute(
        sa.text(
            """
            WITH ordered AS (
                SELECT
                    id,
                    ROW_NUMBER() OVER (
                        PARTITION BY project_id
                        ORDER BY created_at ASC, id ASC
                    ) AS sequence_index
                FROM graph_edges
            )
            UPDATE graph_edges
            SET sequence_index = (
                SELECT ordered.sequence_index
                FROM ordered
                WHERE ordered.id = graph_edges.id
            )
            """
        )
    )

    op.create_index("ix_graph_nodes_sequence_index", "graph_nodes", ["sequence_index"])
    op.create_index("ix_graph_edges_sequence_index", "graph_edges", ["sequence_index"])
    op.create_index(
        "ix_graph_nodes_project_sequence_index",
        "graph_nodes",
        ["project_id", "sequence_index"],
    )
    op.create_index(
        "ix_graph_edges_project_sequence_index",
        "graph_edges",
        ["project_id", "sequence_index"],
    )


def downgrade() -> None:
    op.drop_index("ix_graph_edges_project_sequence_index", table_name="graph_edges")
    op.drop_index("ix_graph_nodes_project_sequence_index", table_name="graph_nodes")
    op.drop_index("ix_graph_edges_sequence_index", table_name="graph_edges")
    op.drop_index("ix_graph_nodes_sequence_index", table_name="graph_nodes")
    op.drop_column("graph_edges", "sequence_index")
    op.drop_column("graph_nodes", "sequence_index")
