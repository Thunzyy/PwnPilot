"""add agent_configs table

Revision ID: 349bc249e776
Revises: 56c888840771
Create Date: 2026-02-14 21:52:59.393969
"""

import sqlalchemy as sa
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "349bc249e776"
down_revision: Union[str, None] = "56c888840771"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "agent_configs" in inspector.get_table_names():
        return

    op.create_table(
        "agent_configs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "project_id", sa.String(), sa.ForeignKey("projects.id"), nullable=True
        ),
        sa.Column("agent_type", sa.String(20), nullable=False),
        sa.Column("display_name", sa.String(100), nullable=False),
        sa.Column("binary_path", sa.String(500), nullable=True),
        sa.Column("default_model", sa.String(100), nullable=True),
        sa.Column("max_turns", sa.Integer(), nullable=False, server_default="50"),
        sa.Column("api_key_encrypted", sa.LargeBinary(), nullable=True),
        sa.Column("env_vars_encrypted", sa.LargeBinary(), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "agent_configs" in inspector.get_table_names():
        op.drop_table("agent_configs")
