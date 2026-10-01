"""add cli provider columns

Revision ID: 0f3e4f1f7c2a
Revises: 8c9d4a6c1f21
Create Date: 2026-04-16 19:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import sqlite


# revision identifiers, used by Alembic.
revision: str = "0f3e4f1f7c2a"
down_revision: str | None = "8c9d4a6c1f21"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _table_columns(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "ai_provider_configs" in tables:
        provider_columns = _table_columns(inspector, "ai_provider_configs")

        if "cli_command" not in provider_columns:
            op.add_column("ai_provider_configs", sa.Column("cli_command", sa.String(length=500), nullable=True))
        if "cli_args_template" not in provider_columns:
            op.add_column("ai_provider_configs", sa.Column("cli_args_template", sa.Text(), nullable=True))
        if "cli_interactive_args" not in provider_columns:
            op.add_column("ai_provider_configs", sa.Column("cli_interactive_args", sa.Text(), nullable=True))
        if "cli_env" not in provider_columns:
            op.add_column("ai_provider_configs", sa.Column("cli_env", sqlite.JSON(), nullable=True))
        if "working_directory" not in provider_columns:
            op.add_column("ai_provider_configs", sa.Column("working_directory", sa.String(length=500), nullable=True))
        if "parse_mode" not in provider_columns:
            op.add_column("ai_provider_configs", sa.Column("parse_mode", sa.String(length=20), nullable=True))
        if "supports_streaming" not in provider_columns:
            op.add_column(
                "ai_provider_configs",
                sa.Column("supports_streaming", sa.Boolean(), nullable=False, server_default="0"),
            )
        if "supports_resume" not in provider_columns:
            op.add_column(
                "ai_provider_configs",
                sa.Column("supports_resume", sa.Boolean(), nullable=False, server_default="0"),
            )
        if "session_flag" not in provider_columns:
            op.add_column("ai_provider_configs", sa.Column("session_flag", sa.String(length=100), nullable=True))
        if "detected_version" not in provider_columns:
            op.add_column("ai_provider_configs", sa.Column("detected_version", sa.String(length=100), nullable=True))
        if "detected_models" not in provider_columns:
            op.add_column("ai_provider_configs", sa.Column("detected_models", sqlite.JSON(), nullable=True))

    if "ai_chat_messages" in tables:
        message_columns = _table_columns(inspector, "ai_chat_messages")

        if "source_mode" not in message_columns:
            op.add_column(
                "ai_chat_messages",
                sa.Column("source_mode", sa.String(length=32), nullable=False, server_default="api"),
            )
        if "cli_command" not in message_columns:
            op.add_column("ai_chat_messages", sa.Column("cli_command", sa.Text(), nullable=True))
        if "cli_exit_code" not in message_columns:
            op.add_column("ai_chat_messages", sa.Column("cli_exit_code", sa.Integer(), nullable=True))
        if "cli_duration_ms" not in message_columns:
            op.add_column("ai_chat_messages", sa.Column("cli_duration_ms", sa.Integer(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "ai_chat_messages" in tables:
        message_columns = _table_columns(inspector, "ai_chat_messages")

        if "cli_duration_ms" in message_columns:
            op.drop_column("ai_chat_messages", "cli_duration_ms")
        if "cli_exit_code" in message_columns:
            op.drop_column("ai_chat_messages", "cli_exit_code")
        if "cli_command" in message_columns:
            op.drop_column("ai_chat_messages", "cli_command")
        if "source_mode" in message_columns:
            op.drop_column("ai_chat_messages", "source_mode")

    if "ai_provider_configs" in tables:
        provider_columns = _table_columns(inspector, "ai_provider_configs")

        if "detected_models" in provider_columns:
            op.drop_column("ai_provider_configs", "detected_models")
        if "detected_version" in provider_columns:
            op.drop_column("ai_provider_configs", "detected_version")
        if "session_flag" in provider_columns:
            op.drop_column("ai_provider_configs", "session_flag")
        if "supports_resume" in provider_columns:
            op.drop_column("ai_provider_configs", "supports_resume")
        if "supports_streaming" in provider_columns:
            op.drop_column("ai_provider_configs", "supports_streaming")
        if "parse_mode" in provider_columns:
            op.drop_column("ai_provider_configs", "parse_mode")
        if "working_directory" in provider_columns:
            op.drop_column("ai_provider_configs", "working_directory")
        if "cli_env" in provider_columns:
            op.drop_column("ai_provider_configs", "cli_env")
        if "cli_interactive_args" in provider_columns:
            op.drop_column("ai_provider_configs", "cli_interactive_args")
        if "cli_args_template" in provider_columns:
            op.drop_column("ai_provider_configs", "cli_args_template")
        if "cli_command" in provider_columns:
            op.drop_column("ai_provider_configs", "cli_command")
