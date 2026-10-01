"""add graph proposals table

Revision ID: c3b7d8e9f1a2
Revises: b2d3e4f5a601
Create Date: 2026-04-19 16:15:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3b7d8e9f1a2"
down_revision: str | None = "b2d3e4f5a601"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "graph_entity_proposals",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("project_id", sa.String(), nullable=False),
        sa.Column("source_type", sa.String(length=32), nullable=False),
        sa.Column("source_id", sa.String(), nullable=True),
        sa.Column("proposed_by", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_graph_entity_proposals_project_id",
        "graph_entity_proposals",
        ["project_id"],
        unique=False,
    )
    op.create_index(
        "ix_graph_entity_proposals_source_id",
        "graph_entity_proposals",
        ["source_id"],
        unique=False,
    )
    op.create_index(
        "ix_graph_entity_proposals_status",
        "graph_entity_proposals",
        ["status"],
        unique=False,
    )
    op.create_index(
        "ix_graph_proposals_project_status",
        "graph_entity_proposals",
        ["project_id", "status"],
        unique=False,
    )
    op.create_index(
        "ix_graph_proposals_source",
        "graph_entity_proposals",
        ["project_id", "source_type", "source_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_graph_proposals_source", table_name="graph_entity_proposals")
    op.drop_index("ix_graph_proposals_project_status", table_name="graph_entity_proposals")
    op.drop_index("ix_graph_entity_proposals_status", table_name="graph_entity_proposals")
    op.drop_index("ix_graph_entity_proposals_source_id", table_name="graph_entity_proposals")
    op.drop_index("ix_graph_entity_proposals_project_id", table_name="graph_entity_proposals")
    op.drop_table("graph_entity_proposals")
