"""add report runtime settings to app settings

Revision ID: 8a4d2c7b1e90
Revises: 6d8e2f1c4a11
Create Date: 2026-04-22 11:05:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "8a4d2c7b1e90"
down_revision: str | None = "6d8e2f1c4a11"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _table_columns(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "app_settings" not in tables:
        op.create_table(
            "app_settings",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("workspace_base_path", sa.String(), nullable=True),
            sa.Column("vault_path", sa.String(), nullable=True),
            sa.Column("vpn_path", sa.String(), nullable=True),
            sa.Column("vpn_content", sa.String(), nullable=True),
            sa.Column("vpn_platform_defaults", sa.JSON(), nullable=True),
            sa.Column("report_evaluation_lease_seconds", sa.Float(), nullable=True),
            sa.Column(
                "report_evaluation_heartbeat_interval_seconds",
                sa.Float(),
                nullable=True,
            ),
            sa.Column(
                "report_evaluation_reclaim_poll_interval_seconds",
                sa.Float(),
                nullable=True,
            ),
            sa.Column("report_evaluation_max_runtime_seconds", sa.Float(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
        )
        return

    settings_columns = _table_columns(inspector, "app_settings")
    columns_to_add = (
        (
            "report_evaluation_lease_seconds",
            sa.Column("report_evaluation_lease_seconds", sa.Float(), nullable=True),
        ),
        (
            "report_evaluation_heartbeat_interval_seconds",
            sa.Column("report_evaluation_heartbeat_interval_seconds", sa.Float(), nullable=True),
        ),
        (
            "report_evaluation_reclaim_poll_interval_seconds",
            sa.Column("report_evaluation_reclaim_poll_interval_seconds", sa.Float(), nullable=True),
        ),
        (
            "report_evaluation_max_runtime_seconds",
            sa.Column("report_evaluation_max_runtime_seconds", sa.Float(), nullable=True),
        ),
    )

    for column_name, column in columns_to_add:
        if column_name not in settings_columns:
            op.add_column("app_settings", column)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "app_settings" not in tables:
        return

    settings_columns = _table_columns(inspector, "app_settings")
    for column_name in (
        "report_evaluation_max_runtime_seconds",
        "report_evaluation_reclaim_poll_interval_seconds",
        "report_evaluation_heartbeat_interval_seconds",
        "report_evaluation_lease_seconds",
    ):
        if column_name in settings_columns:
            op.drop_column("app_settings", column_name)
