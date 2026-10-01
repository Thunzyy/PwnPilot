"""add report evaluation tasks

Revision ID: 4c6f1a2b9d30
Revises: 9f2c1d4a7b10
Create Date: 2026-04-21 23:45:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "4c6f1a2b9d30"
down_revision: str | None = "9f2c1d4a7b10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "report_evaluation_tasks",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("project_id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("proposal_id", sa.String(), nullable=True),
        sa.Column("trigger_type", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["proposal_id"], ["report_update_proposals.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_report_evaluation_tasks_project_id",
        "report_evaluation_tasks",
        ["project_id"],
        unique=False,
    )
    op.create_index(
        "ix_report_evaluation_tasks_user_id",
        "report_evaluation_tasks",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_report_evaluation_tasks_proposal_id",
        "report_evaluation_tasks",
        ["proposal_id"],
        unique=False,
    )
    op.create_index(
        "ix_report_evaluation_tasks_status",
        "report_evaluation_tasks",
        ["status"],
        unique=False,
    )
    op.create_index(
        "ix_report_evaluation_tasks_project_status_created",
        "report_evaluation_tasks",
        ["project_id", "status", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_report_evaluation_tasks_project_status_created",
        table_name="report_evaluation_tasks",
    )
    op.drop_index("ix_report_evaluation_tasks_status", table_name="report_evaluation_tasks")
    op.drop_index("ix_report_evaluation_tasks_proposal_id", table_name="report_evaluation_tasks")
    op.drop_index("ix_report_evaluation_tasks_user_id", table_name="report_evaluation_tasks")
    op.drop_index("ix_report_evaluation_tasks_project_id", table_name="report_evaluation_tasks")
    op.drop_table("report_evaluation_tasks")
