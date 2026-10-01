"""add vpn platform defaults to settings

Revision ID: a7f4d2c1b9e3
Revises: c3b7d8e9f1a2
Create Date: 2026-04-20 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import sqlite


# revision identifiers, used by Alembic.
revision: str = "a7f4d2c1b9e3"
down_revision: str | None = "c3b7d8e9f1a2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _table_columns(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "app_settings" not in tables:
        return

    settings_columns = _table_columns(inspector, "app_settings")
    if "vpn_platform_defaults" not in settings_columns:
        op.add_column(
            "app_settings",
            sa.Column("vpn_platform_defaults", sqlite.JSON(), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "app_settings" not in tables:
        return

    settings_columns = _table_columns(inspector, "app_settings")
    if "vpn_platform_defaults" in settings_columns:
        op.drop_column("app_settings", "vpn_platform_defaults")
