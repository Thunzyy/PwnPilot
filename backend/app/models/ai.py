"""AI-related database models."""
import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, LargeBinary, String, Text
from sqlalchemy.dialects.sqlite import JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utc_now() -> datetime:
    """Return the current UTC timestamp as a timezone-aware datetime."""
    return datetime.now(UTC)


class AIProviderConfig(Base):
    """Configuration for an AI provider."""

    __tablename__ = "ai_provider_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    provider_type: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    # Connection settings
    base_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    api_key_encrypted: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    custom_headers: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=30)

    # Model defaults
    default_model: Mapped[str] = mapped_column(String(100), nullable=False)

    # Generation parameters
    temperature: Mapped[float] = mapped_column(Float, default=0.7)
    max_tokens: Mapped[int] = mapped_column(Integer, default=2048)
    top_p: Mapped[float] = mapped_column(Float, default=1.0)
    frequency_penalty: Mapped[float] = mapped_column(Float, default=0.0)
    presence_penalty: Mapped[float] = mapped_column(Float, default=0.0)

    # Health status
    last_health_check: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    health_status: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # CLI provider settings
    cli_command: Mapped[str | None] = mapped_column(String(500), nullable=True)
    cli_args_template: Mapped[str | None] = mapped_column(Text, nullable=True)
    cli_interactive_args: Mapped[str | None] = mapped_column(Text, nullable=True)
    cli_env: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    working_directory: Mapped[str | None] = mapped_column(String(500), nullable=True)
    parse_mode: Mapped[str | None] = mapped_column(String(20), nullable=True)
    supports_streaming: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    supports_resume: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    session_flag: Mapped[str | None] = mapped_column(String(100), nullable=True)
    detected_version: Mapped[str | None] = mapped_column(String(100), nullable=True)
    detected_models: Mapped[list | None] = mapped_column(JSON, nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utc_now, onupdate=utc_now
    )

    # Relationships
    user = relationship("User", back_populates="ai_providers")
    routings = relationship("AIContextRouting", back_populates="provider_config")
    presets = relationship("AIPreset", back_populates="provider_config")
    cli_sessions = relationship("CLISession", back_populates="provider_config")


class AIContextRouting(Base):
    """Routes context types to specific providers."""

    __tablename__ = "ai_context_routings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    project_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("projects.id"), nullable=True
    )
    context_type: Mapped[str] = mapped_column(String(20), nullable=False)
    provider_config_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("ai_provider_configs.id"), nullable=False
    )
    model: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Relationships
    user = relationship("User", back_populates="ai_routings")
    project = relationship("Project", back_populates="ai_routings")
    provider_config = relationship("AIProviderConfig", back_populates="routings")


class AISystemPrompt(Base):
    """Custom system prompts per context type."""

    __tablename__ = "ai_system_prompts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    context_type: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utc_now, onupdate=utc_now
    )

    # Relationships
    user = relationship("User", back_populates="ai_prompts")


class AIPreset(Base):
    """Saved model + parameter combinations."""

    __tablename__ = "ai_presets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    provider_config_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("ai_provider_configs.id"), nullable=False
    )
    model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    temperature: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    top_p: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    # Relationships
    user = relationship("User", back_populates="ai_presets")
    provider_config = relationship("AIProviderConfig", back_populates="presets")


class AIConversation(Base):
    """A chat conversation within a project."""

    __tablename__ = "ai_conversations"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id"), nullable=False
    )
    project_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("projects.id"), nullable=True
    )
    title: Mapped[str] = mapped_column(String, default="New Chat")
    pinned: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    model: Mapped[str | None] = mapped_column(String, nullable=True)
    provider_config_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("ai_provider_configs.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utc_now, onupdate=utc_now
    )

    # Relationships
    messages = relationship(
        "AIChatMessage", back_populates="conversation", cascade="all, delete-orphan"
    )
    cli_sessions = relationship(
        "CLISession", back_populates="conversation", cascade="all, delete-orphan"
    )
    user = relationship("User", foreign_keys=[user_id])


class CLISession(Base):
    """Interactive CLI session linked to a conversation and terminal session."""

    __tablename__ = "cli_sessions"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    conversation_id: Mapped[str] = mapped_column(
        String, ForeignKey("ai_conversations.id", ondelete="CASCADE"), nullable=False
    )
    provider_config_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("ai_provider_configs.id", ondelete="CASCADE"), nullable=False
    )
    terminal_session_id: Mapped[str | None] = mapped_column(
        String(100), ForeignKey("terminal_sessions.id", ondelete="SET NULL"), nullable=True
    )
    cli_command: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="running", server_default="running")
    working_directory: Mapped[str | None] = mapped_column(String(500), nullable=True)
    last_imported_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    exited_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    conversation = relationship("AIConversation", back_populates="cli_sessions")
    provider_config = relationship("AIProviderConfig", back_populates="cli_sessions")
    terminal_session = relationship("TerminalSessionDB")


class AIChatMessage(Base):
    """A single message in a conversation."""

    __tablename__ = "ai_chat_messages"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    conversation_id: Mapped[str] = mapped_column(
        String, ForeignKey("ai_conversations.id"), nullable=False
    )
    role: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, default="")
    model: Mapped[str | None] = mapped_column(String, nullable=True)
    provider: Mapped[str | None] = mapped_column(String, nullable=True)
    tokens_prompt: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_completion: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    source_mode: Mapped[str] = mapped_column(String(32), default="api", server_default="api")
    cli_command: Mapped[str | None] = mapped_column(Text, nullable=True)
    cli_exit_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cli_duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Tool call fields (for role="tool" messages)
    tool_call_id: Mapped[str | None] = mapped_column(String, nullable=True)
    tool_name: Mapped[str | None] = mapped_column(String, nullable=True)
    tool_args: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    tool_result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    tool_duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Branching tree support
    parent_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("ai_chat_messages.id"), nullable=True
    )
    sibling_index: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    # Relationships
    conversation = relationship("AIConversation", back_populates="messages")
    attachments = relationship(
        "AIAttachment", back_populates="message", cascade="all, delete-orphan"
    )
    children = relationship(
        "AIChatMessage", back_populates="parent", foreign_keys=[parent_id]
    )
    parent = relationship(
        "AIChatMessage", remote_side=[id], foreign_keys=[parent_id]
    )


class AIAttachment(Base):
    """A file attached to a chat message."""

    __tablename__ = "ai_attachments"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    message_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("ai_chat_messages.id"), nullable=True
    )
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id"), nullable=False
    )
    filename: Mapped[str] = mapped_column(String, nullable=False)
    content_type: Mapped[str] = mapped_column(String, nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_path: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    # Relationships
    message = relationship("AIChatMessage", back_populates="attachments")


class AIMemory(Base):
    """A persistent memory fact for the AI across conversations."""

    __tablename__ = "ai_memories"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id"), nullable=False
    )
    project_id: Mapped[str] = mapped_column(
        String, ForeignKey("projects.id"), nullable=False
    )
    key: Mapped[str] = mapped_column(String(100), nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utc_now, onupdate=utc_now
    )


class AIPromptTemplate(Base):
    """Prompt templates synced from JSON files."""

    __tablename__ = "ai_prompt_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("users.id"), nullable=True
    )  # NULL = system template
    type: Mapped[str] = mapped_column(String(20), nullable=False)  # "system" | "template"
    category: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    variables: Mapped[list] = mapped_column(JSON, default=list)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)  # Relative path
    file_hash: Mapped[str] = mapped_column(String(64), nullable=False)  # SHA256
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)  # Active system prompt

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utc_now, onupdate=utc_now
    )

    # Relationships
    user = relationship("User", back_populates="prompt_templates")
