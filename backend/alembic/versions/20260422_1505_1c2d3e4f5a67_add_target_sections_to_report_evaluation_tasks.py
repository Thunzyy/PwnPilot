"""add target sections to report evaluation tasks

Revision ID: 1c2d3e4f5a67
Revises: f2a6b3c4d5e6
Create Date: 2026-04-22 15:05:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "1c2d3e4f5a67"
down_revision: Union[str, None] = "f2a6b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "report_evaluation_tasks",
        sa.Column("target_section_keys", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("report_evaluation_tasks", "target_section_keys")
