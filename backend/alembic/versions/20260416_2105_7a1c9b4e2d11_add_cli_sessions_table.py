"""add cli sessions table

Revision ID: 7a1c9b4e2d11
Revises: 0f3e4f1f7c2a
Create Date: 2026-04-16 21:05:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "7a1c9b4e2d11"
down_revision: str | None = "0f3e4f1f7c2a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "cli_sessions" in tables:
        return
    if not {"ai_conversations", "ai_provider_configs"}.issubset(tables):
        return

    op.create_table(
        "cli_sessions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "conversation_id",
            sa.String(),
            sa.ForeignKey("ai_conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "provider_config_id",
            sa.Integer(),
            sa.ForeignKey("ai_provider_configs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "terminal_session_id",
            sa.String(length=100),
            sa.ForeignKey("terminal_sessions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("cli_command", sa.String(length=500), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="running"),
        sa.Column("working_directory", sa.String(length=500), nullable=True),
        sa.Column("last_imported_at", sa.DateTime(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("exited_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "cli_sessions" in tables:
        op.drop_table("cli_sessions")
