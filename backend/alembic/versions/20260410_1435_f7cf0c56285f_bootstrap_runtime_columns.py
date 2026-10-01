"""bootstrap columns previously added at runtime

Revision ID: f7cf0c56285f
Revises: 9854614a29af
Create Date: 2026-04-10 14:35:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f7cf0c56285f"
down_revision: str | None = "9854614a29af"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _table_columns(table_name: str) -> set[str] | None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if table_name not in inspector.get_table_names():
        return None
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    knowledge_source_columns = _table_columns("knowledge_sources")
    if (
        knowledge_source_columns is not None
        and "opsec_acknowledged" not in knowledge_source_columns
    ):
        op.add_column(
            "knowledge_sources",
            sa.Column(
                "opsec_acknowledged",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("0"),
            ),
        )

    command_history_columns = _table_columns("command_history")
    if (
        command_history_columns is not None
        and "agent_process_id" not in command_history_columns
    ):
        op.add_column(
            "command_history",
            sa.Column("agent_process_id", sa.String(), nullable=True),
        )

    mcp_session_columns = _table_columns("mcp_sessions")
    if (
        mcp_session_columns is not None
        and "agent_process_id" not in mcp_session_columns
    ):
        op.add_column(
            "mcp_sessions",
            sa.Column("agent_process_id", sa.String(), nullable=True),
        )


def downgrade() -> None:
    mcp_session_columns = _table_columns("mcp_sessions")
    if (
        mcp_session_columns is not None
        and "agent_process_id" in mcp_session_columns
    ):
        op.drop_column("mcp_sessions", "agent_process_id")

    command_history_columns = _table_columns("command_history")
    if (
        command_history_columns is not None
        and "agent_process_id" in command_history_columns
    ):
        op.drop_column("command_history", "agent_process_id")

    knowledge_source_columns = _table_columns("knowledge_sources")
    if (
        knowledge_source_columns is not None
        and "opsec_acknowledged" in knowledge_source_columns
    ):
        op.drop_column("knowledge_sources", "opsec_acknowledged")
