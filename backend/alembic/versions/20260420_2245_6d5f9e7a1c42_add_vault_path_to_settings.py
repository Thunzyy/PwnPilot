"""add vault_path to settings

Revision ID: 6d5f9e7a1c42
Revises: a7f4d2c1b9e3
Create Date: 2026-04-20 22:45:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "6d5f9e7a1c42"
down_revision: str | None = "a7f4d2c1b9e3"
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
    if "vault_path" not in settings_columns:
        op.add_column(
            "app_settings",
            sa.Column("vault_path", sa.String(), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "app_settings" not in tables:
        return

    settings_columns = _table_columns(inspector, "app_settings")
    if "vault_path" in settings_columns:
        op.drop_column("app_settings", "vault_path")
