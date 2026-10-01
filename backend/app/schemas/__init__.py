"""Schemas package."""

from app.schemas.ai import (
    ContextOverrides,
    ContextRoutingCreate,
    ContextRoutingResponse,
    ContextRoutingUpdate,
    ContextType,
    HealthCheckResult,
    HealthStatus,
    ModelInfo,
    ModelsListResponse,
    PresetCreate,
    PresetResponse,
    PresetUpdate,
    ProviderConfigCreate,
    ProviderConfigResponse,
    ProviderConfigUpdate,
    ProviderType,
    SystemPromptCreate,
    SystemPromptResponse,
    SystemPromptUpdate,
    WSCancelledResponse,
    WSCancelMessage,
    WSChatMessage,
    WSChunkResponse,
    WSCompleteResponse,
    WSErrorResponse,
)
from app.schemas.project import ProjectCreate, ProjectResponse, ProjectUpdate

__all__ = [
    # Project schemas
    "ProjectCreate",
    "ProjectResponse",
    "ProjectUpdate",
    # AI type aliases
    "ProviderType",
    "ContextType",
    "HealthStatus",
    # Provider config schemas
    "ProviderConfigCreate",
    "ProviderConfigUpdate",
    "ProviderConfigResponse",
    # Health check schemas
    "HealthCheckResult",
    # Models list schemas
    "ModelInfo",
    "ModelsListResponse",
    # Context routing schemas
    "ContextRoutingCreate",
    "ContextRoutingUpdate",
    "ContextRoutingResponse",
    # System prompt schemas
    "SystemPromptCreate",
    "SystemPromptUpdate",
    "SystemPromptResponse",
    # Preset schemas
    "PresetCreate",
    "PresetUpdate",
    "PresetResponse",
    # WebSocket message schemas
    "ContextOverrides",
    "WSChatMessage",
    "WSCancelMessage",
    "WSChunkResponse",
    "WSCompleteResponse",
    "WSCancelledResponse",
    "WSErrorResponse",
]
