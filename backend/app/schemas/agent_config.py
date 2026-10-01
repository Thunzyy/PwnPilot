"""Pydantic schemas for agent configuration CRUD."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.agent_process import AgentType


class AgentConfigCreate(BaseModel):
    """Request body to create an agent configuration."""

    agent_type: AgentType
    display_name: str = Field(min_length=1, max_length=100)
    binary_path: str | None = None
    default_model: str | None = None
    max_turns: int = Field(default=50, ge=1, le=500)
    api_key: str | None = None
    env_vars: dict[str, str] | None = None
    project_id: str | None = None
    is_default: bool = False
    system_prompt: str | None = None
    description: str | None = None
    is_template: bool = False
    command_template: str | None = None


class AgentConfigUpdate(BaseModel):
    """Request body to update an agent configuration (all fields optional)."""

    display_name: str | None = Field(default=None, min_length=1, max_length=100)
    binary_path: str | None = None
    default_model: str | None = None
    max_turns: int | None = Field(default=None, ge=1, le=500)
    api_key: str | None = None
    env_vars: dict[str, str] | None = None
    is_default: bool | None = None
    system_prompt: str | None = None
    description: str | None = None
    command_template: str | None = None


class AgentConfigResponse(BaseModel):
    """Response schema for an agent configuration (secrets masked)."""

    id: int
    user_id: str
    project_id: str | None
    agent_type: AgentType
    display_name: str
    binary_path: str | None
    default_model: str | None
    max_turns: int
    has_api_key: bool
    has_env_vars: bool
    env_var_keys: list[str]
    is_default: bool
    system_prompt: str | None
    description: str | None
    is_template: bool
    command_template: str | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class BinaryVerifyResult(BaseModel):
    """Result of verifying an agent binary exists."""

    config_id: int
    binary_path: str
    found: bool
    resolved_path: str | None = None
