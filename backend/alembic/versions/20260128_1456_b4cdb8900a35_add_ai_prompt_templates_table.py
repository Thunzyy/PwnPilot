"""add_ai_prompt_templates_table

Revision ID: b4cdb8900a35
Revises: 41b26b5b4635
Create Date: 2026-01-28 14:56:31.997339
"""

import sqlalchemy as sa
from sqlalchemy.dialects import sqlite
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b4cdb8900a35'
down_revision: Union[str, None] = '41b26b5b4635'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "ai_prompt_templates" in inspector.get_table_names():
        return

    op.create_table('ai_prompt_templates',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.String(), nullable=True),
    sa.Column('type', sa.String(length=20), nullable=False),
    sa.Column('category', sa.String(length=50), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('variables', sqlite.JSON(), nullable=False),
    sa.Column('content', sa.Text(), nullable=False),
    sa.Column('file_path', sa.String(length=500), nullable=False),
    sa.Column('file_hash', sa.String(length=64), nullable=False),
    sa.Column('is_default', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "ai_prompt_templates" in inspector.get_table_names():
        op.drop_table('ai_prompt_templates')
