"""Command History Model - Captures terminal commands for AI context and tracking."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class CommandHistory(Base):
    """Recorded terminal command with output and metadata."""

    __tablename__ = "command_history"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(String, ForeignKey("projects.id"), nullable=False)
    session_id: Mapped[str] = mapped_column(
        String, ForeignKey("terminal_sessions.id", ondelete="CASCADE"), nullable=False
    )

    # Command data
    command: Mapped[str] = mapped_column(Text, nullable=False)
    output: Mapped[str | None] = mapped_column(Text, nullable=True)
    output_preview: Mapped[str | None] = mapped_column(String(200), nullable=True)
    exit_code: Mapped[int] = mapped_column(Integer, nullable=False)
    cwd: Mapped[str] = mapped_column(String(500), nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)

    # Tracking
    executed_by: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    source: Mapped[str] = mapped_column(String(20), default="user")  # "user" | "ai" | "template" | "agent"
    agent_process_id: Mapped[str | None] = mapped_column(String, nullable=True)

    # Timeline link (if promoted)
    timeline_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("timeline.id", ondelete="SET NULL"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(UTC)
    )

    # Relationships
    project = relationship("Project", backref="command_history")
    session = relationship("TerminalSessionDB", backref="command_history")
    user = relationship("User", backref="executed_commands")
    timeline = relationship("Timeline", backref="command_entry")

    __table_args__ = (
        Index("ix_command_history_project_created", "project_id", "created_at"),
        Index("ix_command_history_session", "session_id"),
    )
