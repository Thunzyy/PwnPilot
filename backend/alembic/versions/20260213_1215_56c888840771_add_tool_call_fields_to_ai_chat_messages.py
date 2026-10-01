"""add tool call fields to ai_chat_messages

Revision ID: 56c888840771
Revises: e7b1c3f25b7a
Create Date: 2026-02-13 12:15:22.734917
"""

import sqlalchemy as sa
from sqlalchemy.dialects import sqlite
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '56c888840771'
down_revision: Union[str, None] = 'e7b1c3f25b7a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "ai_chat_messages" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("ai_chat_messages")}

    if 'tool_call_id' not in columns:
        op.add_column('ai_chat_messages', sa.Column('tool_call_id', sa.String(), nullable=True))
    if 'tool_name' not in columns:
        op.add_column('ai_chat_messages', sa.Column('tool_name', sa.String(), nullable=True))
    if 'tool_args' not in columns:
        op.add_column('ai_chat_messages', sa.Column('tool_args', sqlite.JSON(), nullable=True))
    if 'tool_result' not in columns:
        op.add_column('ai_chat_messages', sa.Column('tool_result', sqlite.JSON(), nullable=True))
    if 'tool_duration_ms' not in columns:
        op.add_column('ai_chat_messages', sa.Column('tool_duration_ms', sa.Integer(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "ai_chat_messages" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("ai_chat_messages")}

    if 'tool_duration_ms' in columns:
        op.drop_column('ai_chat_messages', 'tool_duration_ms')
    if 'tool_result' in columns:
        op.drop_column('ai_chat_messages', 'tool_result')
    if 'tool_args' in columns:
        op.drop_column('ai_chat_messages', 'tool_args')
    if 'tool_name' in columns:
        op.drop_column('ai_chat_messages', 'tool_name')
    if 'tool_call_id' in columns:
        op.drop_column('ai_chat_messages', 'tool_call_id')
