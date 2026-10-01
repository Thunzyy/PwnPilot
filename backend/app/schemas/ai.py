"""Pydantic schemas for AI Assistant API.

These schemas handle validation and serialization for AI-related endpoints,
including provider configuration, chat messages, and WebSocket communication.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

# Type aliases for validation
ProviderType = Literal["ollama", "openai_compat", "openai", "anthropic", "cli"]
ContextType = Literal[
    "general",
    "recon",
    "exploit",
    "post",
    "terminal",
    "graph",
    "reporting",
    "chat",
]
HealthStatus = Literal["healthy", "unhealthy", "unknown"]
SourceMode = Literal["api", "cli_orchestrated", "cli_terminal"]
CLIParseMode = Literal["json", "markdown", "raw"]
ConversationExportFormat = Literal["claude", "codex", "gemini", "aider", "markdown", "json"]
CLISessionStatus = Literal["running", "idle", "exited"]


# =============================================================================
# Provider Configuration Schemas
# =============================================================================


class ProviderConfigBase(BaseModel):
    """Base schema with common provider configuration fields."""

    provider_type: ProviderType
    name: str = Field(..., min_length=1, max_length=100)
    is_enabled: bool = True

    # Connection settings
    base_url: str | None = None
    custom_headers: dict[str, str] | None = None
    timeout_seconds: int = Field(default=30, ge=5, le=300)

    # Model defaults
    default_model: str = Field(..., min_length=1, max_length=100)

    # Generation parameters
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=2048, ge=1, le=128000)
    top_p: float = Field(default=1.0, ge=0.0, le=1.0)
    frequency_penalty: float = Field(default=0.0, ge=-2.0, le=2.0)
    presence_penalty: float = Field(default=0.0, ge=-2.0, le=2.0)

    # CLI provider settings
    cli_command: str | None = Field(default=None, min_length=1, max_length=500)
    cli_args_template: str | None = None
    cli_interactive_args: str | None = None
    cli_env: dict[str, str] | None = None
    working_directory: str | None = Field(default=None, max_length=500)
    parse_mode: CLIParseMode | None = None
    supports_streaming: bool = False
    supports_resume: bool = False
    session_flag: str | None = Field(default=None, max_length=100)
    detected_version: str | None = Field(default=None, max_length=100)
    detected_models: list[str] | None = None

    @model_validator(mode="after")
    def validate_cli_provider_fields(self):
        if self.provider_type != "cli":
            return self

        if not self.cli_command:
            raise ValueError("cli_command is required for CLI providers")
        if not self.parse_mode:
            raise ValueError("parse_mode is required for CLI providers")

        return self


class ProviderConfigCreate(ProviderConfigBase):
    """Schema for creating a new provider configuration."""

    api_key: str | None = Field(default=None, description="API key (will be encrypted)")


class ProviderConfigUpdate(BaseModel):
    """Schema for updating an existing provider configuration. All fields optional."""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    is_enabled: bool | None = None

    # Connection settings
    base_url: str | None = None
    api_key: str | None = Field(default=None, description="New API key (will be encrypted)")
    custom_headers: dict[str, str] | None = None
    timeout_seconds: int | None = Field(default=None, ge=5, le=300)

    # Model defaults
    default_model: str | None = Field(default=None, min_length=1, max_length=100)

    # Generation parameters
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    max_tokens: int | None = Field(default=None, ge=1, le=128000)
    top_p: float | None = Field(default=None, ge=0.0, le=1.0)
    frequency_penalty: float | None = Field(default=None, ge=-2.0, le=2.0)
    presence_penalty: float | None = Field(default=None, ge=-2.0, le=2.0)

    # CLI provider settings
    cli_command: str | None = Field(default=None, min_length=1, max_length=500)
    cli_args_template: str | None = None
    cli_interactive_args: str | None = None
    cli_env: dict[str, str] | None = None
    working_directory: str | None = Field(default=None, max_length=500)
    parse_mode: CLIParseMode | None = None
    supports_streaming: bool | None = None
    supports_resume: bool | None = None
    session_flag: str | None = Field(default=None, max_length=100)
    detected_version: str | None = Field(default=None, max_length=100)
    detected_models: list[str] | None = None


class ProviderConfigResponse(BaseModel):
    """Schema for provider configuration API responses."""

    id: int
    user_id: str
    provider_type: ProviderType
    name: str
    is_enabled: bool

    # Connection settings (no api_key, only has_api_key)
    base_url: str | None
    has_api_key: bool = Field(description="Whether an API key is configured")
    custom_headers: dict[str, str] | None
    timeout_seconds: int

    # Model defaults
    default_model: str

    # Generation parameters
    temperature: float
    max_tokens: int
    top_p: float
    frequency_penalty: float
    presence_penalty: float

    # Health status
    last_health_check: datetime | None
    health_status: HealthStatus | None

    # CLI provider settings
    cli_command: str | None
    cli_args_template: str | None
    cli_interactive_args: str | None
    cli_env: dict[str, str] | None
    working_directory: str | None
    parse_mode: CLIParseMode | None
    supports_streaming: bool
    supports_resume: bool
    session_flag: str | None
    detected_version: str | None
    detected_models: list[str] | None

    # Timestamps
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# =============================================================================
# Health Check Schemas
# =============================================================================


class HealthCheckResult(BaseModel):
    """Result of a provider health check."""

    provider_id: int
    status: HealthStatus
    latency_ms: float | None = None
    error_message: str | None = None
    checked_at: datetime


# =============================================================================
# Models List Schemas
# =============================================================================


class ModelInfo(BaseModel):
    """Information about an available model."""

    id: str
    name: str
    context_length: int | None = None
    description: str | None = None


class ModelsListResponse(BaseModel):
    """Response containing available models for a provider."""

    provider_id: int
    provider_name: str
    models: list[ModelInfo]
    cached: bool = False


class DetectedCLIResponse(BaseModel):
    """Auto-detected CLI provider preset."""

    provider_type: Literal["cli"] = "cli"
    name: str
    default_model: str
    cli_command: str
    cli_args_template: str | None = None
    cli_interactive_args: str | None = None
    cli_env: dict[str, str] | None = None
    working_directory: str | None = None
    parse_mode: CLIParseMode
    supports_streaming: bool = False
    supports_resume: bool = False
    session_flag: str | None = None
    detected_version: str | None = None
    detected_models: list[str] | None = None


class CLIResolveRequest(BaseModel):
    """Payload for resolving a manually entered CLI command/path."""

    cli_command: str = Field(..., min_length=1, max_length=500)


# =============================================================================
# Context Routing Schemas
# =============================================================================


class ContextRoutingBase(BaseModel):
    """Base schema for context routing."""

    context_type: ContextType
    provider_config_id: int
    model: str | None = Field(default=None, min_length=1, max_length=100)


class ContextRoutingCreate(ContextRoutingBase):
    """Schema for creating a context routing."""

    project_id: str | None = None


class ContextRoutingUpdate(BaseModel):
    """Schema for updating a context routing."""

    provider_config_id: int
    model: str | None = Field(default=None, min_length=1, max_length=100)


class ContextRoutingResponse(ContextRoutingBase):
    """Schema for context routing API responses."""

    id: int
    user_id: str
    project_id: str | None

    model_config = ConfigDict(from_attributes=True)


# =============================================================================
# System Prompt Schemas
# =============================================================================


class SystemPromptBase(BaseModel):
    """Base schema for system prompts."""

    context_type: ContextType
    name: str = Field(..., min_length=1, max_length=100)
    content: str = Field(..., min_length=1)
    is_default: bool = False


class SystemPromptCreate(SystemPromptBase):
    """Schema for creating a system prompt."""

    pass


class SystemPromptUpdate(BaseModel):
    """Schema for updating a system prompt. All fields optional."""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    content: str | None = Field(default=None, min_length=1)
    is_default: bool | None = None


class SystemPromptResponse(SystemPromptBase):
    """Schema for system prompt API responses."""

    id: int
    user_id: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# =============================================================================
# Preset Schemas
# =============================================================================


class PresetBase(BaseModel):
    """Base schema for AI presets."""

    name: str = Field(..., min_length=1, max_length=100)
    provider_config_id: int
    model: str | None = None
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    max_tokens: int | None = Field(default=None, ge=1, le=128000)
    top_p: float | None = Field(default=None, ge=0.0, le=1.0)


class PresetCreate(PresetBase):
    """Schema for creating a preset."""

    pass


class PresetUpdate(BaseModel):
    """Schema for updating a preset. All fields optional."""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    provider_config_id: int | None = None
    model: str | None = None
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    max_tokens: int | None = Field(default=None, ge=1, le=128000)
    top_p: float | None = Field(default=None, ge=0.0, le=1.0)


class PresetResponse(PresetBase):
    """Schema for preset API responses."""

    id: int
    user_id: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# =============================================================================
# Conversations
# =============================================================================


class ConversationCreate(BaseModel):
    """Schema for creating a new conversation."""

    project_id: str | None = Field(default=None, min_length=1)
    title: str | None = Field(default=None, max_length=200)
    model: str | None = None
    provider_config_id: int | None = None


class ConversationUpdate(BaseModel):
    """Schema for updating a conversation."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    pinned: bool | None = None


class ConversationSummary(BaseModel):
    """Lightweight schema for sidebar listing."""

    id: str
    project_id: str | None
    title: str
    pinned: bool = False
    model: str | None
    provider_config_id: int | None = None
    updated_at: datetime
    message_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class ChatMessageResponse(BaseModel):
    """Schema for a persisted chat message."""

    id: str
    conversation_id: str
    role: str
    content: str
    model: str | None
    provider: str | None
    tokens_prompt: int | None
    tokens_completion: int | None
    error: str | None
    source_mode: SourceMode = "api"
    cli_command: str | None = None
    cli_exit_code: int | None = None
    cli_duration_ms: int | None = None
    parent_id: str | None = None
    sibling_index: int = 0
    sibling_count: int = 1
    attachments: list["AttachmentResponse"] = []
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ConversationDetail(BaseModel):
    """Full conversation with messages."""

    id: str
    project_id: str | None
    title: str
    pinned: bool = False
    model: str | None
    provider_config_id: int | None
    created_at: datetime
    updated_at: datetime
    messages: list[ChatMessageResponse] = []

    model_config = ConfigDict(from_attributes=True)


class ConversationExportResponse(BaseModel):
    """Conversation export payload for native CLIs or manual reuse."""

    conversation_id: str
    format: ConversationExportFormat
    filename: str
    content: str
    resume_command: str | None = None


class CLISessionCreate(BaseModel):
    """Create or resume an interactive CLI session for a conversation."""

    conversation_id: str
    provider_config_id: int
    cols: int = Field(default=120, ge=40, le=400)
    rows: int = Field(default=30, ge=10, le=200)


class CLISessionResponse(BaseModel):
    """Interactive CLI session metadata exposed to the frontend."""

    id: str
    conversation_id: str
    provider_config_id: int
    terminal_session_id: str | None
    terminal_name: str | None = None
    terminal_websocket_url: str | None = None
    terminal_is_alive: bool = False
    cli_command: str
    status: CLISessionStatus
    working_directory: str | None = None
    last_imported_at: datetime | None = None
    started_at: datetime
    exited_at: datetime | None = None


class CLISessionImportResponse(BaseModel):
    """Result of importing terminal command history into the conversation."""

    cli_session_id: str
    imported_commands: int = 0
    imported_messages: int = 0
    last_imported_at: datetime | None = None


# =============================================================================
# Attachments
# =============================================================================


class AttachmentResponse(BaseModel):
    """Schema for file attachment responses."""

    id: str
    filename: str
    content_type: str
    size_bytes: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# =============================================================================
# WebSocket Message Schemas
# =============================================================================


class ContextOverrides(BaseModel):
    """Optional overrides for chat context."""

    provider_id: int | None = None
    model: str | None = None
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    max_tokens: int | None = Field(default=None, ge=1, le=128000)
    system_prompt: str | None = None


class WSChatMessage(BaseModel):
    """WebSocket message for initiating a chat request."""

    type: Literal["chat"] = "chat"
    message_id: str = Field(..., description="Client-generated unique message ID")
    content: str = Field(..., min_length=1)
    context_type: ContextType = "general"
    mode: Literal["question", "agent"] = "question"
    project_id: str | None = None
    conversation_id: str | None = Field(default=None, description="Conversation to append to")
    attachment_ids: list[str] = Field(default_factory=list, description="Pre-uploaded attachment IDs")
    overrides: ContextOverrides | None = None


class WSCancelMessage(BaseModel):
    """WebSocket message for cancelling an ongoing generation."""

    type: Literal["cancel"] = "cancel"
    message_id: str = Field(..., description="ID of the message to cancel")


class WSChunkResponse(BaseModel):
    """WebSocket response for a streamed text chunk."""

    type: Literal["chunk"] = "chunk"
    message_id: str
    content: str
    index: int = Field(..., ge=0, description="Chunk sequence number")


class WSCompleteResponse(BaseModel):
    """WebSocket response when generation is complete."""

    type: Literal["complete"] = "complete"
    message_id: str
    total_tokens: int | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    model: str | None = None
    provider: str | None = None
    source_mode: SourceMode = "api"
    cli_command: str | None = None
    user_message_id: str | None = None
    assistant_message_id: str | None = None


class WSCancelledResponse(BaseModel):
    """WebSocket response when generation was cancelled."""

    type: Literal["cancelled"] = "cancelled"
    message_id: str


class WSErrorResponse(BaseModel):
    """WebSocket response for errors during generation."""

    type: Literal["error"] = "error"
    message_id: str | None = None
    code: str = Field(..., description="Error code from errors.py")
    message: str
    details: dict | None = None


class WSToolCallStart(BaseModel):
    """WebSocket event: agent started executing a tool."""

    type: Literal["tool_call_start"] = "tool_call_start"
    message_id: str
    call_id: str
    seq: int
    name: str
    args: dict = {}


class WSToolCallResult(BaseModel):
    """WebSocket event: agent tool call completed successfully."""

    type: Literal["tool_call_result"] = "tool_call_result"
    message_id: str
    call_id: str
    seq: int
    name: str
    result: dict | str | list | None = None
    duration_ms: int
    success: bool = True


class WSToolCallError(BaseModel):
    """WebSocket event: agent tool call failed."""

    type: Literal["tool_call_error"] = "tool_call_error"
    message_id: str
    call_id: str
    seq: int
    name: str
    error: str


# =============================================================================
# REST Chat API Schemas
# =============================================================================


class ChatMessageInput(BaseModel):
    """Individual message for stateless chat mode (like OpenAI messages array)."""

    role: Literal["user", "assistant", "system"]
    content: str = Field(..., min_length=1)


class RESTChatRequest(BaseModel):
    """Request body for POST /ai/chat.

    Two modes:
    - Mode 1 (conversation-based): provide `content` + `conversation_id` — server loads history
    - Mode 2 (stateless): provide `messages` array — client sends full conversation

    Either `content` or `messages` must be provided, not both.
    """

    # Mode 1: conversation-based
    content: str | None = Field(default=None, min_length=1)
    conversation_id: str | None = None

    # Mode 2: stateless messages array
    messages: list[ChatMessageInput] | None = None

    # Common required fields
    project_id: str = Field(..., min_length=1)
    context_type: ContextType = "general"
    attachment_ids: list[str] = Field(default_factory=list)
    overrides: ContextOverrides | None = None


class RESTChatResponse(BaseModel):
    """Response body for POST /ai/chat (non-streaming mode)."""

    user_message_id: str | None = None
    assistant_message_id: str | None = None
    content: str
    model: str | None = None
    provider: str | None = None
    source_mode: SourceMode = "api"
    cli_command: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None


# =============================================================================
# Message Branching
# =============================================================================


class MessageBranchRequest(BaseModel):
    """Request to create a new message branch (edit & resubmit)."""

    content: str = Field(..., min_length=1)
    overrides: ContextOverrides | None = None


class MessageUpdateRequest(BaseModel):
    """Request to update a message's content in-place."""

    content: str = Field(..., min_length=1)


# =============================================================================
# Memories
# =============================================================================


class MemoryCreate(BaseModel):
    """Schema for creating a memory."""

    project_id: str = Field(..., min_length=1)
    key: str = Field(..., min_length=1, max_length=100)
    value: str = Field(..., min_length=1)


class MemoryUpdate(BaseModel):
    """Schema for updating a memory."""

    key: str | None = Field(default=None, min_length=1, max_length=100)
    value: str | None = Field(default=None, min_length=1)


class MemoryResponse(BaseModel):
    """Schema for memory API responses."""

    id: str
    user_id: str
    project_id: str
    key: str
    value: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# =============================================================================
# Prompt Templates
# =============================================================================

PromptType = Literal["system", "template"]
PromptCategory = Literal[
    "general", "recon", "web", "network", "privesc", "ad", "cloud", "mobile", "post", "reporting", "ctf"
]


class PromptTemplateBase(BaseModel):
    """Base schema for prompt templates."""

    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = None
    category: str = Field(..., min_length=1, max_length=50)
    variables: list[str] = Field(default_factory=list)
    content: str = Field(..., min_length=1)


class PromptTemplateCreate(PromptTemplateBase):
    """Schema for creating a prompt template."""

    type: PromptType


class PromptTemplateUpdate(BaseModel):
    """Schema for updating a prompt template. All fields optional."""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = None
    variables: list[str] | None = None
    content: str | None = Field(default=None, min_length=1)


class PromptTemplateResponse(PromptTemplateBase):
    """Schema for prompt template API responses."""

    id: int
    type: PromptType
    is_default: bool
    is_user_created: bool = Field(description="True if created by user, False if system template")
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CategoryGroup(BaseModel):
    """A group of templates by category."""

    id: str
    name: str
    templates: list[PromptTemplateResponse]


class TemplatesByCategory(BaseModel):
    """Response containing templates grouped by category."""

    categories: list[CategoryGroup]
