"""add report profile to reports

Revision ID: f2a6b3c4d5e6
Revises: 8a4d2c7b1e90
Create Date: 2026-04-22 12:35:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f2a6b3c4d5e6"
down_revision: Union[str, None] = "8a4d2c7b1e90"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("reports") as batch_op:
        batch_op.add_column(
            sa.Column(
                "profile",
                sa.String(length=32),
                nullable=False,
                server_default="hybrid",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("reports") as batch_op:
        batch_op.drop_column("profile")
