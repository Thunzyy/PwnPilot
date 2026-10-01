"""add template fields to agent_configs

Revision ID: 9854614a29af
Revises: 349bc249e776
Create Date: 2026-02-15 15:20:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa  # noqa: I001

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9854614a29af"
down_revision: str | None = "349bc249e776"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "agent_configs" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("agent_configs")}

    if "system_prompt" not in columns:
        op.add_column(
            "agent_configs",
            sa.Column("system_prompt", sa.Text(), nullable=True),
        )
    if "description" not in columns:
        op.add_column(
            "agent_configs",
            sa.Column("description", sa.String(500), nullable=True),
        )
    if "is_template" not in columns:
        op.add_column(
            "agent_configs",
            sa.Column(
                "is_template",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            ),
        )
    if "command_template" not in columns:
        op.add_column(
            "agent_configs",
            sa.Column("command_template", sa.String(2000), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "agent_configs" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("agent_configs")}

    if "command_template" in columns:
        op.drop_column("agent_configs", "command_template")
    if "is_template" in columns:
        op.drop_column("agent_configs", "is_template")
    if "description" in columns:
        op.drop_column("agent_configs", "description")
    if "system_prompt" in columns:
        op.drop_column("agent_configs", "system_prompt")
