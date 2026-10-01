"""Pydantic schemas for Project API.

These schemas handle validation and serialization for project endpoints.
"""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# Type aliases for validation
ProjectType = Literal["htb", "thm", "real", "ctf", "custom"]
ProjectStatus = Literal["active", "paused", "completed"]


class ProjectBase(BaseModel):
    """Base schema with common project fields."""

    name: str = Field(..., min_length=1, max_length=200)
    type: ProjectType = Field(default="custom")
    status: ProjectStatus = Field(default="active")
    variables: dict[str, Any] = Field(default_factory=dict)


class ProjectCreate(ProjectBase):
    """Schema for creating a new project."""

    workspace_base: str | None = Field(
        default=None,
        description="Base directory for project workspace. Defaults to projects_root.",
    )


class ProjectUpdate(BaseModel):
    """Schema for updating an existing project. All fields optional."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    type: ProjectType | None = None
    status: ProjectStatus | None = None
    variables: dict[str, Any] | None = None


class ProjectResponse(ProjectBase):
    """Schema for project API responses."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    slug: str
    workspace_path: str
    created_at: datetime
    updated_at: datetime


class ProjectContextImportRequest(BaseModel):
    """Request schema for platform URL context import."""

    url: str = Field(..., min_length=1)


class ProjectContextImportResponse(BaseModel):
    """Response schema for enriched platform URL imports."""

    context: dict[str, str] = Field(default_factory=dict)
    source: str = "unsupported"
    messages: list[str] = Field(default_factory=list)


class ProjectVpnStatusResponse(BaseModel):
    """Resolved VPN status for a project."""

    platform_id: str
    platform_label: str
    button_label: str
    state: Literal["connected", "disconnected", "missing", "unknown"] = "unknown"
    command: str | None = None
    disconnect_command: str | None = None
    config_path: str = ""
    source_label: str = "missing"
    reason: str | None = None
    connected_process_pid: int | None = None
    connected_process_name: str | None = None
    connected_process_command: str | None = None
