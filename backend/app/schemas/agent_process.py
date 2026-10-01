"""Pydantic schemas for agent subprocess launch and status."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

AgentType = Literal["claude_code", "codex", "custom"]
AgentStatus = Literal["starting", "running", "stopping", "stopped", "error"]
OutputMode = Literal["terminal", "chat"]


class AgentLaunchRequest(BaseModel):
    """Request body to launch an agent subprocess."""

    agent_type: AgentType
    prompt: str = Field(default="", max_length=10000)
    max_turns: int = Field(default=50, ge=1, le=500)
    project_id: str
    output_mode: OutputMode = "terminal"


class AgentLaunchFromConfigRequest(BaseModel):
    """Request body to launch an agent from a saved configuration."""

    config_id: int
    project_id: str
    prompt: str = Field(default="", max_length=10000)
    output_mode: OutputMode = "terminal"


class AgentStatusResponse(BaseModel):
    """Status snapshot of a single agent process."""

    id: str
    agent_type: AgentType
    project_id: str
    tmux_session: str
    pid: int
    status: AgentStatus
    created_at: datetime
    stopped_at: datetime | None = None
    exit_code: int | None = None
    websocket_url: str | None = None
    output_mode: str = "terminal"

    model_config = ConfigDict(from_attributes=True)


class AgentToolCallEvent(BaseModel):
    """Schema for a single agent MCP tool call event."""

    type: Literal["tool_call"] = "tool_call"
    name: str
    args: dict = Field(default_factory=dict)
    result_preview: str | None = None
    error: str | None = None
    duration_ms: int
    success: bool
    timestamp: str
    agent_id: str | None = None


class AgentListResponse(BaseModel):
    """Paginated list of agent processes."""

    agents: list[AgentStatusResponse]
    total: int
