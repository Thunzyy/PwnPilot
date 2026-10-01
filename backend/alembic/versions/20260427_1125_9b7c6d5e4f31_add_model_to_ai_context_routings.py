"""add model override to ai context routings

Revision ID: 9b7c6d5e4f31
Revises: 1c2d3e4f5a67
Create Date: 2026-04-27 11:25:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "9b7c6d5e4f31"
down_revision: str | Sequence[str] | None = "1c2d3e4f5a67"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "ai_context_routings" not in tables:
        return

    columns = {column["name"] for column in inspector.get_columns("ai_context_routings")}
    if "model" not in columns:
        op.add_column(
            "ai_context_routings",
            sa.Column("model", sa.String(length=100), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "ai_context_routings" not in tables:
        return

    columns = {column["name"] for column in inspector.get_columns("ai_context_routings")}
    if "model" in columns:
        op.drop_column("ai_context_routings", "model")
