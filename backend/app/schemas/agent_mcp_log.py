"""Pydantic schemas for agent MCP tool call logs."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class MCPLogResponse(BaseModel):
    """Single MCP tool call log entry."""

    id: str
    project_id: str
    agent_process_id: str | None
    session_id: str
    tool_name: str
    tool_args: dict
    tool_result: str | None
    success: bool
    error: str | None
    duration_ms: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MCPLogListResponse(BaseModel):
    """Paginated list of MCP log entries."""

    items: list[MCPLogResponse]
    total: int
