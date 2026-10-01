"""
Terminal Session Models - DB persistence for sessions and viewers
"""

from datetime import UTC, datetime
from enum import Enum as PyEnum

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ViewerRoleDB(PyEnum):
    """Viewer role enum for database"""

    MASTER = "master"
    CONTROLLER = "controller"
    VIEWER = "viewer"


class TerminalSessionDB(Base):
    """Persisted terminal session for cross-restart recovery"""

    __tablename__ = "terminal_sessions"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    project_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    master_token: Mapped[str] = mapped_column(String(255))
    viewer_token: Mapped[str] = mapped_column(String(255))
    is_alive: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    viewers: Mapped[list["SessionViewerDB"]] = relationship(
        "SessionViewerDB", back_populates="session", cascade="all, delete-orphan"
    )


class SessionViewerDB(Base):
    """Connected viewer with role"""

    __tablename__ = "session_viewers"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(
        String(100), ForeignKey("terminal_sessions.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    role: Mapped[ViewerRoleDB] = mapped_column(Enum(ViewerRoleDB), default=ViewerRoleDB.VIEWER)
    connected_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    session: Mapped["TerminalSessionDB"] = relationship("TerminalSessionDB", back_populates="viewers")
