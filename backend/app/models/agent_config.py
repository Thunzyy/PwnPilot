"""Agent configuration database model."""
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utc_now() -> datetime:
    """Return the current UTC timestamp as a timezone-aware datetime."""
    return datetime.now(UTC)


class AgentConfig(Base):
    """Persisted configuration for a CLI agent (Claude Code, Codex, custom)."""

    __tablename__ = "agent_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id"), nullable=False
    )
    project_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("projects.id"), nullable=True
    )
    agent_type: Mapped[str] = mapped_column(String(20), nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    binary_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    default_model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    max_turns: Mapped[int] = mapped_column(Integer, default=50)

    # Encrypted secrets
    api_key_encrypted: Mapped[bytes | None] = mapped_column(
        LargeBinary, nullable=True
    )
    env_vars_encrypted: Mapped[bytes | None] = mapped_column(
        LargeBinary, nullable=True
    )

    is_default: Mapped[bool] = mapped_column(Boolean, default=False)

    # Template & custom agent fields
    system_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_template: Mapped[bool] = mapped_column(Boolean, default=False)
    command_template: Mapped[str | None] = mapped_column(
        String(2000), nullable=True
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utc_now, onupdate=utc_now
    )

    # Relationships
    user = relationship("User", back_populates="agent_configs")
