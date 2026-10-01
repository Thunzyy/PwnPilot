"""SQLAlchemy model for agent MCP tool call logs."""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.sqlite import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AgentMCPLog(Base):
    """Persisted record of every MCP tool call made by an agent.

    Used for:
    - EXT-02: MCP history persistence (browsable tool call log)
    - Debugging agent behavior after the fact
    - Audit trail of what agents did in a project
    """

    __tablename__ = "agent_mcp_logs"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    project_id: Mapped[str] = mapped_column(
        String, ForeignKey("projects.id"), nullable=False
    )
    agent_process_id: Mapped[str | None] = mapped_column(
        String, nullable=True
    )
    session_id: Mapped[str] = mapped_column(String, nullable=False)
    tool_name: Mapped[str] = mapped_column(String, nullable=False)
    tool_args: Mapped[dict] = mapped_column(JSON, default=dict)
    tool_result: Mapped[str | None] = mapped_column(Text, nullable=True)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False)
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )

    __table_args__ = (
        Index("ix_agent_mcp_logs_project_id", "project_id"),
        Index("ix_agent_mcp_logs_session_id", "session_id"),
        Index("ix_agent_mcp_logs_agent_process_id", "agent_process_id"),
    )
