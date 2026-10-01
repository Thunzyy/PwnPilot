"""add report evaluation task leases

Revision ID: 6d8e2f1c4a11
Revises: 4c6f1a2b9d30
Create Date: 2026-04-22 09:15:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "6d8e2f1c4a11"
down_revision: str | None = "4c6f1a2b9d30"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "report_evaluation_tasks",
        sa.Column("lease_expires_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "report_evaluation_tasks",
        sa.Column("heartbeat_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "report_evaluation_tasks",
        sa.Column(
            "lease_version",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.create_index(
        "ix_report_evaluation_tasks_status_lease_expires",
        "report_evaluation_tasks",
        ["status", "lease_expires_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_report_evaluation_tasks_status_lease_expires",
        table_name="report_evaluation_tasks",
    )
    op.drop_column("report_evaluation_tasks", "lease_version")
    op.drop_column("report_evaluation_tasks", "heartbeat_at")
    op.drop_column("report_evaluation_tasks", "lease_expires_at")
