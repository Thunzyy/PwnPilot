"""make ai_conversations.project_id nullable for global chats

Revision ID: b2d3e4f5a601
Revises: 7a1c9b4e2d11
Create Date: 2026-04-18 00:10:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "b2d3e4f5a601"
down_revision: str | None = "7a1c9b4e2d11"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "ai_conversations" not in set(inspector.get_table_names()):
        return

    # SQLite needs batch_alter_table to change column nullability.
    with op.batch_alter_table("ai_conversations") as batch_op:
        batch_op.alter_column(
            "project_id",
            existing_type=sa.String(),
            nullable=True,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "ai_conversations" not in set(inspector.get_table_names()):
        return

    with op.batch_alter_table("ai_conversations") as batch_op:
        batch_op.alter_column(
            "project_id",
            existing_type=sa.String(),
            nullable=False,
        )
