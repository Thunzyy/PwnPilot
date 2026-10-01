"""Pydantic schemas for Command History API."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

SourceType = Literal["user", "ai", "template", "agent"]


# =============================================================================
# Create/Input Schemas
# =============================================================================


class CommandHistoryCreate(BaseModel):
    """Schema for recording a command from shell hook."""

    command: str = Field(..., min_length=1)
    output: str | None = None
    exit_code: int
    cwd: str = Field(..., min_length=1, max_length=500)
    duration_ms: int = Field(..., ge=0)


class CommandHistoryFromAI(BaseModel):
    """Schema for executing a command from AI suggestion."""

    command: str = Field(..., min_length=1)
    session_id: str = Field(..., min_length=1)


# =============================================================================
# Response Schemas
# =============================================================================


class CommandHistoryResponse(BaseModel):
    """Schema for command history API responses (without full output)."""

    id: str
    project_id: str
    session_id: str
    session_name: str | None = None
    command: str
    output_preview: str | None
    exit_code: int
    cwd: str
    duration_ms: int
    executed_by: str
    source: SourceType
    agent_process_id: str | None = None
    timeline_id: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CommandHistoryDetailResponse(CommandHistoryResponse):
    """Schema for command history with full output."""

    output: str | None

    model_config = ConfigDict(from_attributes=True)


# =============================================================================
# List Response
# =============================================================================


class CommandHistoryListResponse(BaseModel):
    """Paginated list of commands."""

    items: list[CommandHistoryResponse]
    total: int
    limit: int
    offset: int


class CommandHistoryDetailListResponse(BaseModel):
    """Paginated list of commands with full output."""

    items: list[CommandHistoryDetailResponse]
    total: int
    limit: int
    offset: int


# =============================================================================
# Timeline Promotion
# =============================================================================


class PromoteToTimelineResponse(BaseModel):
    """Response when promoting a command to timeline."""

    timeline_id: str
    command_id: str
