"""add_command_history_table

Revision ID: 309f0dad26b4
Revises: b4cdb8900a35
Create Date: 2026-01-28 16:45:32.271434
"""

import sqlalchemy as sa
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '309f0dad26b4'
down_revision: Union[str, None] = 'b4cdb8900a35'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if 'command_history' not in tables:
        op.create_table('command_history',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('project_id', sa.String(), nullable=False),
        sa.Column('session_id', sa.String(), nullable=False),
        sa.Column('command', sa.Text(), nullable=False),
        sa.Column('output', sa.Text(), nullable=True),
        sa.Column('output_preview', sa.String(length=200), nullable=True),
        sa.Column('exit_code', sa.Integer(), nullable=False),
        sa.Column('cwd', sa.String(length=500), nullable=False),
        sa.Column('duration_ms', sa.Integer(), nullable=False),
        sa.Column('executed_by', sa.String(), nullable=False),
        sa.Column('source', sa.String(length=20), nullable=False),
        sa.Column('timeline_id', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['executed_by'], ['users.id'], ),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
        sa.ForeignKeyConstraint(['session_id'], ['terminal_sessions.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['timeline_id'], ['timeline.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
        )

    indexes = {
        idx['name'] for idx in inspector.get_indexes('command_history') if idx.get('name')
    }
    if 'ix_command_history_project_created' not in indexes:
        op.create_index('ix_command_history_project_created', 'command_history', ['project_id', 'created_at'], unique=False)
    if 'ix_command_history_session' not in indexes:
        op.create_index('ix_command_history_session', 'command_history', ['session_id'], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if 'command_history' not in tables:
        return

    indexes = {
        idx['name'] for idx in inspector.get_indexes('command_history') if idx.get('name')
    }
    if 'ix_command_history_session' in indexes:
        op.drop_index('ix_command_history_session', table_name='command_history')
    if 'ix_command_history_project_created' in indexes:
        op.drop_index('ix_command_history_project_created', table_name='command_history')
    op.drop_table('command_history')
