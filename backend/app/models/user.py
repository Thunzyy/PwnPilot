import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    username: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    email: Mapped[str | None] = mapped_column(String, unique=True, nullable=True)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)

    display_name: Mapped[str | None] = mapped_column(String, nullable=True)
    team: Mapped[str | None] = mapped_column(String, nullable=True)
    timezone: Mapped[str | None] = mapped_column(String, nullable=True)
    signature: Mapped[str | None] = mapped_column(String, nullable=True)
    language: Mapped[str] = mapped_column(String, default="fr")
    notifications: Mapped[dict] = mapped_column(JSON, default=dict)
    shortcuts: Mapped[dict] = mapped_column(JSON, default=dict)

    is_super_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    # AI relationships
    ai_providers = relationship("AIProviderConfig", back_populates="user")
    ai_routings = relationship("AIContextRouting", back_populates="user")
    ai_prompts = relationship("AISystemPrompt", back_populates="user")
    ai_presets = relationship("AIPreset", back_populates="user")
    prompt_templates = relationship("AIPromptTemplate", back_populates="user")
    agent_configs = relationship("AgentConfig", back_populates="user")
