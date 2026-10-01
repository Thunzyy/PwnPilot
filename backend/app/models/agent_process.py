"""SQLAlchemy model for persisted agent process records.

Each row represents a CLI agent subprocess (Claude Code, Codex, custom)
launched by PwnPilot.  The record stores the tmux session name, PID, and
status so the process manager can recover after a backend restart.

The in-memory ``AgentProcess`` dataclass (managed by the process manager)
is the runtime object that holds the asyncio task and streaming state.
This model provides crash-recovery persistence only -- the process manager
reconciles DB rows with live tmux sessions on startup.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AgentProcessRecord(Base):
    """Persistent record of an agent subprocess for crash recovery."""

    __tablename__ = "agent_processes"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    project_id: Mapped[str] = mapped_column(
        String, ForeignKey("projects.id"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id"), nullable=False
    )
    agent_type: Mapped[str] = mapped_column(String, nullable=False)
    tmux_session: Mapped[str] = mapped_column(
        String, nullable=False, unique=True
    )
    pid: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(
        String, nullable=False, default="starting"
    )
    mcp_config_path: Mapped[str | None] = mapped_column(
        String, nullable=True
    )
    prompt: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )
    stopped_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True
    )
    exit_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
