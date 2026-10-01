"""add report artifacts

Revision ID: a8b7c6d5e4f2
Revises: 9b7c6d5e4f31
Create Date: 2026-04-30 21:05:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a8b7c6d5e4f2"
down_revision: str | Sequence[str] | None = "9b7c6d5e4f31"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "report_artifacts",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("project_id", sa.String(), nullable=False),
        sa.Column("report_id", sa.String(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=False),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("report_revision", sa.Integer(), nullable=False),
        sa.Column("graph_node_count", sa.Integer(), nullable=False),
        sa.Column("graph_edge_count", sa.Integer(), nullable=False),
        sa.Column("accepted_command_count", sa.Integer(), nullable=False),
        sa.Column("accepted_command_ids", sa.JSON(), nullable=False),
        sa.Column("manifest_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["report_id"], ["reports.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_report_artifacts_project_id",
        "report_artifacts",
        ["project_id"],
        unique=False,
    )
    op.create_index(
        "ix_report_artifacts_report_id",
        "report_artifacts",
        ["report_id"],
        unique=False,
    )
    op.create_index(
        "ix_report_artifacts_sha256",
        "report_artifacts",
        ["sha256"],
        unique=False,
    )
    op.create_index(
        "ix_report_artifacts_project_created",
        "report_artifacts",
        ["project_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_report_artifacts_project_created", table_name="report_artifacts")
    op.drop_index("ix_report_artifacts_sha256", table_name="report_artifacts")
    op.drop_index("ix_report_artifacts_report_id", table_name="report_artifacts")
    op.drop_index("ix_report_artifacts_project_id", table_name="report_artifacts")
    op.drop_table("report_artifacts")
