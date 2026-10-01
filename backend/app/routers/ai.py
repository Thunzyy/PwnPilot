"""AI provider management REST endpoints.

All endpoints scoped to the authenticated user.
"""
import asyncio
import json
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, Depends, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.config import settings
from app.core.crypto import encrypt_api_key, get_or_create_key
from app.core.deps import get_current_user
from app.core.errors import ErrorCode
from app.core.exceptions import AppException
from app.database import async_session_maker, get_db
from app.models.ai import (
    AIAttachment,
    AIChatMessage,
    AIContextRouting,
    AIConversation,
    AIMemory,
    AIPreset,
    AIProviderConfig,
    AISystemPrompt,
    CLISession,
)
from app.models.command_history import CommandHistory
from app.models.project import Project
from app.models.terminal_session import TerminalSessionDB
from app.models.user import User
from app.routers.ws_chat import (
    DEFAULT_SYSTEM_PROMPT,
    _get_system_prompt,
    _persist_user_message,
    _update_conversation_title,
    build_messages_from_conversation,
)
from app.schemas.ai import (
    AttachmentResponse,
    ChatMessageResponse,
    CLIResolveRequest,
    CLISessionCreate,
    CLISessionImportResponse,
    CLISessionResponse,
    ContextRoutingCreate,
    ContextRoutingResponse,
    ConversationCreate,
    ConversationDetail,
    ConversationExportFormat,
    ConversationExportResponse,
    ConversationSummary,
    ConversationUpdate,
    DetectedCLIResponse,
    HealthCheckResult,
    MemoryCreate,
    MemoryResponse,
    MemoryUpdate,
    MessageBranchRequest,
    MessageUpdateRequest,
    ModelInfo,
    ModelsListResponse,
    PresetCreate,
    PresetResponse,
    ProviderConfigCreate,
    ProviderConfigResponse,
    ProviderConfigUpdate,
    RESTChatRequest,
    RESTChatResponse,
    SystemPromptCreate,
    SystemPromptResponse,
    SystemPromptUpdate,
)
from app.services.chat_task_manager import _STREAM_END, chat_task_manager
from app.services.cli_detector import (
    detect_installed_clis,
    get_effective_cli_settings,
    get_recommended_cli_timeout,
    resolve_cli_command,
)
from app.services.console_provider import ConsoleProvider
from app.services.context_builder import ContextBuilder
from app.services.llm_service import LLMService
from app.services.provider_factory import get_provider

router = APIRouter(prefix="/ai", tags=["ai"])


# =============================================================================
# Helpers
# =============================================================================


_HEALTH_STATUS_MAP = {"ok": "healthy", "degraded": "unhealthy", "error": "unhealthy"}


def _normalize_health_status(raw: str | None) -> str | None:
    """Map internal/legacy status values to schema HealthStatus."""
    if raw is None:
        return None
    return _HEALTH_STATUS_MAP.get(raw, raw)


def _provider_to_response(config: AIProviderConfig) -> ProviderConfigResponse:
    """Convert model to response schema, masking the API key."""
    effective_cli = get_effective_cli_settings(
        config.cli_command or "",
        cli_args_template=config.cli_args_template,
        cli_interactive_args=config.cli_interactive_args,
        parse_mode=config.parse_mode,
        supports_streaming=config.supports_streaming,
        supports_resume=config.supports_resume,
        session_flag=config.session_flag,
    )
    return ProviderConfigResponse(
        id=config.id,
        user_id=config.user_id,
        provider_type=config.provider_type,
        name=config.name,
        is_enabled=config.is_enabled,
        base_url=config.base_url,
        has_api_key=config.api_key_encrypted is not None,
        custom_headers=config.custom_headers,
        timeout_seconds=config.timeout_seconds,
        default_model=config.default_model,
        temperature=config.temperature,
        max_tokens=config.max_tokens,
        top_p=config.top_p,
        frequency_penalty=config.frequency_penalty,
        presence_penalty=config.presence_penalty,
        last_health_check=config.last_health_check,
        health_status=_normalize_health_status(config.health_status),
        cli_command=config.cli_command,
        cli_args_template=effective_cli.cli_args_template,
        cli_interactive_args=effective_cli.cli_interactive_args,
        cli_env=config.cli_env,
        working_directory=config.working_directory,
        parse_mode=effective_cli.parse_mode,
        supports_streaming=effective_cli.supports_streaming,
        supports_resume=effective_cli.supports_resume,
        session_flag=effective_cli.session_flag,
        detected_version=config.detected_version,
        detected_models=config.detected_models,
        created_at=config.created_at,
        updated_at=config.updated_at,
    )


def _slugify_filename(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return slug or "conversation"


def _messages_to_markdown(title: str, messages: list[AIChatMessage]) -> str:
    lines = [f"# {title}", ""]
    for message in messages:
        heading = message.role.capitalize()
        meta: list[str] = []
        if message.provider:
            meta.append(message.provider)
        if message.model:
            meta.append(message.model)
        if meta:
            heading += f" ({' • '.join(meta)})"
        lines.extend([f"## {heading}", "", message.content, ""])
    return "\n".join(lines).strip()


def _build_resume_command(export_format: str, filename: str, model: str | None) -> str | None:
    resolved_model = model or "default-model"
    if export_format == "claude":
        return f'claude -p "$(cat {filename})" --model {resolved_model}'
    if export_format == "codex":
        return f'codex --model {resolved_model} "$(cat {filename})"'
    if export_format == "gemini":
        return f'gemini -p "$(cat {filename})" --model {resolved_model}'
    if export_format == "aider":
        return f"aider --restore-chat-history {filename}"
    return None


async def _get_user_provider(
    provider_id: int,
    user: User,
    db: AsyncSession,
) -> AIProviderConfig:
    """Get provider config owned by user, or raise 404."""
    config = await db.get(AIProviderConfig, provider_id)
    if config is None or config.user_id != user.id:
        raise AppException(ErrorCode.AI_PROVIDER_NOT_FOUND, "Provider not found")
    return config


async def _get_user_conversation(
    conversation_id: str,
    user: User,
    db: AsyncSession,
) -> AIConversation:
    """Get conversation owned by user, or raise 404."""
    conversation = await db.get(AIConversation, conversation_id)
    if conversation is None or conversation.user_id != user.id:
        raise AppException(ErrorCode.AI_CONVERSATION_NOT_FOUND, "Conversation not found")
    return conversation


class _CLIFormatDict(dict[str, str]):
    def __missing__(self, key: str) -> str:
        return ""


def _format_cli_template(template: str | None, **values: str) -> str:
    if not template:
        return ""
    return template.format_map(_CLIFormatDict(values))


def _build_cli_launch_command(
    config: AIProviderConfig,
    *,
    conversation_id: str,
    model: str | None,
) -> str:
    command = (config.cli_command or "").strip()
    if not command:
        return ""

    effective_cli = get_effective_cli_settings(
        config.cli_command or "",
        cli_args_template=config.cli_args_template,
        cli_interactive_args=config.cli_interactive_args,
        parse_mode=config.parse_mode,
        supports_streaming=config.supports_streaming,
        supports_resume=config.supports_resume,
        session_flag=config.session_flag,
    )
    interactive_args = (effective_cli.cli_interactive_args or "").strip()
    if not interactive_args or "{session_id}" in interactive_args:
        return command

    rendered_args = _format_cli_template(
        interactive_args,
        model=model or config.default_model,
        conversation_id=conversation_id,
    ).strip()
    return f"{command} {rendered_args}".strip() if rendered_args else command


async def _get_cli_session(
    cli_session_id: str,
    user: User,
    db: AsyncSession,
) -> CLISession:
    stmt = (
        select(CLISession)
        .join(AIConversation, CLISession.conversation_id == AIConversation.id)
        .where(CLISession.id == cli_session_id, AIConversation.user_id == user.id)
    )
    result = await db.execute(stmt)
    cli_session = result.scalar_one_or_none()
    if cli_session is None:
        raise AppException(ErrorCode.AI_CONVERSATION_NOT_FOUND, "CLI session not found")
    return cli_session


async def _serialize_cli_session(
    cli_session: CLISession,
    provider: ConsoleProvider,
    db: AsyncSession,
) -> CLISessionResponse:
    terminal_name: str | None = None
    terminal_websocket_url: str | None = None
    terminal_is_alive = False

    if cli_session.terminal_session_id:
        terminal_session = await provider.get_session(cli_session.terminal_session_id)
        if terminal_session:
            terminal_name = terminal_session.name
            terminal_websocket_url = terminal_session.websocket_url
            terminal_is_alive = terminal_session.is_alive
        elif cli_session.status != "exited":
            cli_session.status = "exited"
            cli_session.exited_at = cli_session.exited_at or datetime.now(UTC)
            await db.commit()

    return CLISessionResponse(
        id=cli_session.id,
        conversation_id=cli_session.conversation_id,
        provider_config_id=cli_session.provider_config_id,
        terminal_session_id=cli_session.terminal_session_id,
        terminal_name=terminal_name,
        terminal_websocket_url=terminal_websocket_url,
        terminal_is_alive=terminal_is_alive,
        cli_command=cli_session.cli_command,
        status=cli_session.status,  # type: ignore[arg-type]
        working_directory=cli_session.working_directory,
        last_imported_at=cli_session.last_imported_at,
        started_at=cli_session.started_at,
        exited_at=cli_session.exited_at,
    )


# =============================================================================
# Provider CRUD
# =============================================================================


@router.get("/providers", response_model=list[ProviderConfigResponse])
async def list_providers(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all AI providers for the current user."""
    stmt = (
        select(AIProviderConfig)
        .where(AIProviderConfig.user_id == current_user.id)
        .order_by(AIProviderConfig.created_at)
    )
    result = await db.execute(stmt)
    configs = result.scalars().all()
    return [_provider_to_response(c) for c in configs]


@router.post("/providers/detect-clis", response_model=list[DetectedCLIResponse])
async def detect_cli_providers(
    current_user: User = Depends(get_current_user),
):
    """Scan PATH for known AI CLIs."""
    del current_user
    return await detect_installed_clis()


@router.post("/providers/resolve-cli", response_model=DetectedCLIResponse | None)
async def resolve_cli_provider(
    body: CLIResolveRequest,
    current_user: User = Depends(get_current_user),
):
    """Resolve a manually entered CLI command/path to a known CLI profile."""
    del current_user
    return await resolve_cli_command(body.cli_command)


@router.post(
    "/providers",
    response_model=ProviderConfigResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_provider(
    data: ProviderConfigCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new AI provider configuration."""
    encrypted_key = None
    if data.api_key:
        key = get_or_create_key()
        encrypted_key = encrypt_api_key(data.api_key, key)

    timeout_seconds = data.timeout_seconds
    if data.provider_type == "cli" and "timeout_seconds" not in data.model_fields_set:
        timeout_seconds = get_recommended_cli_timeout(data.cli_command or "", timeout_seconds)

    config = AIProviderConfig(
        user_id=current_user.id,
        provider_type=data.provider_type,
        name=data.name,
        is_enabled=data.is_enabled,
        base_url=data.base_url,
        api_key_encrypted=encrypted_key,
        custom_headers=data.custom_headers,
        timeout_seconds=timeout_seconds,
        default_model=data.default_model,
        temperature=data.temperature,
        max_tokens=data.max_tokens,
        top_p=data.top_p,
        frequency_penalty=data.frequency_penalty,
        presence_penalty=data.presence_penalty,
        cli_command=data.cli_command,
        cli_args_template=data.cli_args_template,
        cli_interactive_args=data.cli_interactive_args,
        cli_env=data.cli_env,
        working_directory=data.working_directory,
        parse_mode=data.parse_mode,
        supports_streaming=data.supports_streaming,
        supports_resume=data.supports_resume,
        session_flag=data.session_flag,
        detected_version=data.detected_version,
        detected_models=data.detected_models,
    )
    db.add(config)
    await db.commit()
    await db.refresh(config)
    return _provider_to_response(config)


@router.put("/providers/{provider_id}", response_model=ProviderConfigResponse)
async def update_provider(
    provider_id: int,
    data: ProviderConfigUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update an existing AI provider configuration."""
    config = await _get_user_provider(provider_id, current_user, db)

    update_data = data.model_dump(exclude_unset=True)

    # Handle API key separately (encrypt it)
    if "api_key" in update_data:
        api_key = update_data.pop("api_key")
        if api_key is not None:
            key = get_or_create_key()
            config.api_key_encrypted = encrypt_api_key(api_key, key)

    for field, value in update_data.items():
        setattr(config, field, value)

    await db.commit()
    await db.refresh(config)

    # Clear cached provider instance
    svc = LLMService(db)
    svc.clear_cache(provider_id)

    return _provider_to_response(config)


@router.delete("/providers/{provider_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_provider(
    provider_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete an AI provider configuration."""
    config = await _get_user_provider(provider_id, current_user, db)
    await db.delete(config)
    await db.commit()


# =============================================================================
# Health Check & Models
# =============================================================================


@router.post("/providers/{provider_id}/test", response_model=HealthCheckResult)
async def test_provider(
    provider_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Test connection to a provider."""
    config = await _get_user_provider(provider_id, current_user, db)

    svc = LLMService(db)
    try:
        provider = svc.create_provider(config)
    except ValueError as e:
        raise AppException(ErrorCode.AI_PROVIDER_DISABLED, str(e))

    result = await provider.test_connection()

    # Map internal status → schema HealthStatus
    health_status = _normalize_health_status(result.status) or "unknown"

    # Update health status in DB
    config.health_status = health_status
    config.last_health_check = datetime.now(UTC)
    await db.commit()

    return HealthCheckResult(
        provider_id=provider_id,
        status=health_status,
        latency_ms=result.latency_ms,
        error_message=result.error_detail,
        checked_at=config.last_health_check,
    )


@router.get("/providers/{provider_id}/models", response_model=ModelsListResponse)
async def list_models(
    provider_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List available models for a provider."""
    config = await _get_user_provider(provider_id, current_user, db)

    svc = LLMService(db)
    try:
        provider = svc.create_provider(config)
    except ValueError as e:
        raise AppException(ErrorCode.AI_PROVIDER_DISABLED, str(e))

    model_ids = await provider.list_models()

    return ModelsListResponse(
        provider_id=provider_id,
        provider_name=config.name,
        models=[ModelInfo(id=m, name=m) for m in model_ids],
    )


# =============================================================================
# Context Routing
# =============================================================================


@router.get("/routing", response_model=list[ContextRoutingResponse])
async def list_routing(
    project_id: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List context routing rules for the current user."""
    stmt = select(AIContextRouting).where(
        AIContextRouting.user_id == current_user.id
    )
    if project_id is not None:
        stmt = stmt.where(AIContextRouting.project_id == project_id)
    else:
        stmt = stmt.where(AIContextRouting.project_id.is_(None))

    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.put("/routing", response_model=list[ContextRoutingResponse])
async def update_routing(
    routings: list[ContextRoutingCreate],
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Bulk update context routing (replaces all for given scope)."""
    # Determine project_id scope from first routing (all must match)
    project_id = routings[0].project_id if routings else None

    # Delete existing routings for this scope
    await db.execute(
        delete(AIContextRouting).where(
            AIContextRouting.user_id == current_user.id,
            AIContextRouting.project_id == project_id,
        )
    )

    # Create new routings
    new_routings = []
    for r in routings:
        routing = AIContextRouting(
            user_id=current_user.id,
            project_id=r.project_id,
            context_type=r.context_type,
            provider_config_id=r.provider_config_id,
            model=r.model,
        )
        db.add(routing)
        new_routings.append(routing)

    await db.commit()
    for r in new_routings:
        await db.refresh(r)

    return new_routings


# =============================================================================
# System Prompts
# =============================================================================


@router.get("/prompts", response_model=list[SystemPromptResponse])
async def list_prompts(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List system prompts for the current user."""
    stmt = (
        select(AISystemPrompt)
        .where(AISystemPrompt.user_id == current_user.id)
        .order_by(AISystemPrompt.context_type, AISystemPrompt.name)
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.post(
    "/prompts",
    response_model=SystemPromptResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_prompt(
    data: SystemPromptCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new system prompt."""
    prompt = AISystemPrompt(
        user_id=current_user.id,
        context_type=data.context_type,
        name=data.name,
        content=data.content,
        is_default=data.is_default,
    )
    db.add(prompt)
    await db.commit()
    await db.refresh(prompt)
    return prompt


@router.put("/prompts/{prompt_id}", response_model=SystemPromptResponse)
async def update_prompt(
    prompt_id: int,
    data: SystemPromptUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a system prompt."""
    prompt = await db.get(AISystemPrompt, prompt_id)
    if prompt is None or prompt.user_id != current_user.id:
        raise AppException(ErrorCode.AI_PROVIDER_NOT_FOUND, "Prompt not found")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(prompt, field, value)

    await db.commit()
    await db.refresh(prompt)
    return prompt


@router.delete("/prompts/{prompt_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_prompt(
    prompt_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a system prompt."""
    prompt = await db.get(AISystemPrompt, prompt_id)
    if prompt is None or prompt.user_id != current_user.id:
        raise AppException(ErrorCode.AI_PROVIDER_NOT_FOUND, "Prompt not found")
    await db.delete(prompt)
    await db.commit()


# =============================================================================
# Presets
# =============================================================================


@router.get("/presets", response_model=list[PresetResponse])
async def list_presets(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List presets for the current user."""
    stmt = (
        select(AIPreset)
        .where(AIPreset.user_id == current_user.id)
        .order_by(AIPreset.name)
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.post(
    "/presets",
    response_model=PresetResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_preset(
    data: PresetCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new preset."""
    preset = AIPreset(
        user_id=current_user.id,
        name=data.name,
        provider_config_id=data.provider_config_id,
        model=data.model,
        temperature=data.temperature,
        max_tokens=data.max_tokens,
        top_p=data.top_p,
    )
    db.add(preset)
    await db.commit()
    await db.refresh(preset)
    return preset


@router.delete("/presets/{preset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_preset(
    preset_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a preset."""
    preset = await db.get(AIPreset, preset_id)
    if preset is None or preset.user_id != current_user.id:
        raise AppException(ErrorCode.AI_PROVIDER_NOT_FOUND, "Preset not found")
    await db.delete(preset)
    await db.commit()


# =============================================================================
# Conversations
# =============================================================================


@router.get("/conversations", response_model=list[ConversationSummary])
async def list_conversations(
    project_id: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List conversations for the current user, optionally filtered by project."""
    stmt = (
        select(AIConversation)
        .where(AIConversation.user_id == current_user.id)
        .order_by(AIConversation.pinned.desc(), AIConversation.updated_at.desc())
        .limit(50)
    )
    if project_id == "__global__":
        stmt = stmt.where(AIConversation.project_id.is_(None))
    elif project_id is not None:
        stmt = stmt.where(AIConversation.project_id == project_id)

    result = await db.execute(stmt)
    conversations = result.scalars().all()

    summaries = []
    for conv in conversations:
        msg_count_stmt = (
            select(func.count())
            .select_from(AIChatMessage)
            .where(AIChatMessage.conversation_id == conv.id)
        )
        msg_result = await db.execute(msg_count_stmt)
        count = msg_result.scalar() or 0
        summaries.append(
            ConversationSummary(
                id=conv.id,
                project_id=conv.project_id,
                title=conv.title,
                pinned=conv.pinned,
                model=conv.model,
                provider_config_id=conv.provider_config_id,
                updated_at=conv.updated_at,
                message_count=count,
            )
        )
    return summaries


@router.post(
    "/conversations",
    response_model=ConversationDetail,
    status_code=status.HTTP_201_CREATED,
)
async def create_conversation(
    data: ConversationCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new conversation."""
    provider_config_id = data.provider_config_id
    model = data.model
    if provider_config_id is None or model is None:
        resolved_provider_config_id, resolved_model = await LLMService(db).resolve_context_selection(
            user_id=current_user.id,
            context_type="general",
            project_id=data.project_id,
        )
        if provider_config_id is None:
            provider_config_id = resolved_provider_config_id
        if model is None:
            model = resolved_model

    conv = AIConversation(
        user_id=current_user.id,
        project_id=data.project_id,
        title=data.title or "New Chat",
        model=model,
        provider_config_id=provider_config_id,
    )
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    return ConversationDetail(
        id=conv.id,
        project_id=conv.project_id,
        title=conv.title,
        pinned=conv.pinned,
        model=conv.model,
        provider_config_id=conv.provider_config_id,
        created_at=conv.created_at,
        updated_at=conv.updated_at,
        messages=[],
    )


@router.get("/conversations/{conversation_id}", response_model=ConversationDetail)
async def get_conversation(
    conversation_id: str,
    limit: int = 50,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a conversation with its messages."""
    conv = await db.get(AIConversation, conversation_id)
    if conv is None or conv.user_id != current_user.id:
        raise AppException(ErrorCode.AI_CONVERSATION_NOT_FOUND, "Conversation not found")

    msg_stmt = (
        select(AIChatMessage)
        .where(AIChatMessage.conversation_id == conversation_id)
        .order_by(AIChatMessage.created_at)
        .offset(offset)
        .limit(limit)
    )
    msg_result = await db.execute(msg_stmt)
    messages = msg_result.scalars().all()

    # Compute sibling counts: group by parent_id
    sibling_counts: dict[str | None, int] = {}
    for msg in messages:
        key = msg.parent_id
        sibling_counts[key] = sibling_counts.get(key, 0) + 1

    msg_responses = []
    for msg in messages:
        att_stmt = select(AIAttachment).where(AIAttachment.message_id == msg.id)
        att_result = await db.execute(att_stmt)
        atts = att_result.scalars().all()
        msg_responses.append(
            ChatMessageResponse(
                id=msg.id,
                conversation_id=msg.conversation_id,
                role=msg.role,
                content=msg.content,
                model=msg.model,
                provider=msg.provider,
                tokens_prompt=msg.tokens_prompt,
                tokens_completion=msg.tokens_completion,
                error=msg.error,
                source_mode=msg.source_mode,
                cli_command=msg.cli_command,
                cli_exit_code=msg.cli_exit_code,
                cli_duration_ms=msg.cli_duration_ms,
                parent_id=msg.parent_id,
                sibling_index=msg.sibling_index,
                sibling_count=sibling_counts.get(msg.parent_id, 1),
                attachments=[AttachmentResponse.model_validate(a) for a in atts],
                created_at=msg.created_at,
            )
        )

    return ConversationDetail(
        id=conv.id,
        project_id=conv.project_id,
        title=conv.title,
        pinned=conv.pinned,
        model=conv.model,
        provider_config_id=conv.provider_config_id,
        created_at=conv.created_at,
        updated_at=conv.updated_at,
        messages=msg_responses,
    )


@router.post(
    "/conversations/{conversation_id}/export",
    response_model=ConversationExportResponse,
)
async def export_conversation(
    conversation_id: str,
    format: ConversationExportFormat = Query("markdown"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Export a conversation for native CLI continuation or offline reuse."""
    conv = await db.get(AIConversation, conversation_id)
    if conv is None or conv.user_id != current_user.id:
        raise AppException(ErrorCode.AI_CONVERSATION_NOT_FOUND, "Conversation not found")

    msg_stmt = (
        select(AIChatMessage)
        .where(AIChatMessage.conversation_id == conversation_id)
        .order_by(AIChatMessage.created_at)
    )
    msg_result = await db.execute(msg_stmt)
    messages = list(msg_result.scalars().all())
    base_filename = _slugify_filename(conv.title)

    if format == "json":
        payload = {
            "conversation_id": conv.id,
            "title": conv.title,
            "messages": [
                {
                    "role": message.role,
                    "content": message.content,
                    "model": message.model,
                    "provider": message.provider,
                    "created_at": str(message.created_at),
                }
                for message in messages
            ],
        }
        return ConversationExportResponse(
            conversation_id=conv.id,
            format="json",
            filename=f"{base_filename}.json",
            content=json.dumps(payload, indent=2),
        )

    markdown_content = _messages_to_markdown(conv.title, messages)
    export_filename = f"{base_filename}.md"
    if format in {"claude", "codex", "gemini", "aider"}:
        suffix = "aider" if format == "aider" else format
        export_filename = f"{base_filename}-{suffix}.md"

    latest_model = next((message.model for message in reversed(messages) if message.model), conv.model)

    return ConversationExportResponse(
        conversation_id=conv.id,
        format=format,
        filename=export_filename,
        content=markdown_content,
        resume_command=_build_resume_command(format, export_filename, latest_model),
    )


@router.get(
    "/conversations/{conversation_id}/cli-session",
    response_model=CLISessionResponse | None,
)
async def get_conversation_cli_session(
    conversation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    provider: ConsoleProvider = Depends(get_provider),
):
    """Return the latest interactive CLI session for a conversation, if any."""
    conversation = await _get_user_conversation(conversation_id, current_user, db)
    stmt = (
        select(CLISession)
        .where(CLISession.conversation_id == conversation.id)
        .order_by(CLISession.started_at.desc())
    )
    result = await db.execute(stmt)
    cli_sessions = list(result.scalars().all())
    if not cli_sessions:
        return None

    active_session = next((session for session in cli_sessions if session.status != "exited"), cli_sessions[0])
    return await _serialize_cli_session(active_session, provider, db)


@router.post(
    "/cli-sessions",
    response_model=CLISessionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_cli_session(
    data: CLISessionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    provider: ConsoleProvider = Depends(get_provider),
):
    """Create or resume an interactive terminal session for a CLI provider."""
    conversation = await _get_user_conversation(data.conversation_id, current_user, db)
    config = await _get_user_provider(data.provider_config_id, current_user, db)

    if config.provider_type != "cli" or not config.cli_command:
        raise AppException(ErrorCode.GENERIC_BAD_REQUEST, "Provider is not a CLI provider")

    existing_stmt = (
        select(CLISession)
        .where(
            CLISession.conversation_id == conversation.id,
            CLISession.provider_config_id == config.id,
        )
        .order_by(CLISession.started_at.desc())
    )
    existing_result = await db.execute(existing_stmt)
    existing_session = existing_result.scalars().first()
    if existing_session and existing_session.status != "exited":
        serialized = await _serialize_cli_session(existing_session, provider, db)
        if serialized.terminal_is_alive:
            return serialized

    workspace_path = config.working_directory
    if conversation.project_id and not workspace_path:
        project = await db.get(Project, conversation.project_id)
        workspace_path = project.workspace_path if project else None

    terminal_session = await provider.create_session(
        name=f"{config.name} Terminal",
        project_id=conversation.project_id,
        cols=data.cols,
        rows=data.rows,
        workspace_path=workspace_path,
        user_id=current_user.id,
    )

    if await db.get(TerminalSessionDB, terminal_session.id) is None:
        db.add(
            TerminalSessionDB(
                id=terminal_session.id,
                project_id=terminal_session.project_id,
                name=terminal_session.name,
                master_token=terminal_session.master_token,
                viewer_token=terminal_session.viewer_token,
                is_alive=terminal_session.is_alive,
            )
        )

    cli_session = CLISession(
        conversation_id=conversation.id,
        provider_config_id=config.id,
        terminal_session_id=terminal_session.id,
        cli_command=config.cli_command,
        status="running",
        working_directory=workspace_path,
    )
    db.add(cli_session)
    conversation.provider_config_id = config.id
    await db.commit()
    await db.refresh(cli_session)

    launch_command = _build_cli_launch_command(
        config,
        conversation_id=conversation.id,
        model=conversation.model or config.default_model,
    )
    if launch_command:
        await asyncio.sleep(0.2)
        await provider.send_input(terminal_session.id, f"{launch_command}\n")

    return await _serialize_cli_session(cli_session, provider, db)


@router.get("/cli-sessions/{cli_session_id}", response_model=CLISessionResponse)
async def get_cli_session(
    cli_session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    provider: ConsoleProvider = Depends(get_provider),
):
    """Get a specific interactive CLI session."""
    cli_session = await _get_cli_session(cli_session_id, current_user, db)
    return await _serialize_cli_session(cli_session, provider, db)


@router.delete("/cli-sessions/{cli_session_id}")
async def delete_cli_session(
    cli_session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    provider: ConsoleProvider = Depends(get_provider),
):
    """Terminate an interactive CLI session and keep its record for history."""
    cli_session = await _get_cli_session(cli_session_id, current_user, db)

    if cli_session.terminal_session_id:
        await provider.destroy_session(cli_session.terminal_session_id)

    cli_session.status = "exited"
    cli_session.exited_at = cli_session.exited_at or datetime.now(UTC)
    await db.commit()
    return {"status": "ok"}


@router.post("/cli-sessions/{cli_session_id}/import", response_model=CLISessionImportResponse)
async def import_cli_session_history(
    cli_session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Import newly recorded terminal command history into the conversation."""
    cli_session = await _get_cli_session(cli_session_id, current_user, db)
    conversation = await _get_user_conversation(cli_session.conversation_id, current_user, db)
    config = await _get_user_provider(cli_session.provider_config_id, current_user, db)

    if not cli_session.terminal_session_id:
        raise AppException(ErrorCode.GENERIC_BAD_REQUEST, "CLI session has no terminal session")

    stmt = (
        select(CommandHistory)
        .where(CommandHistory.session_id == cli_session.terminal_session_id)
        .order_by(CommandHistory.created_at.asc(), CommandHistory.id.asc())
    )
    if cli_session.last_imported_at is not None:
        stmt = stmt.where(CommandHistory.created_at > cli_session.last_imported_at)

    result = await db.execute(stmt)
    commands = list(result.scalars().all())

    imported_messages = 0
    for command in commands:
        db.add(
            AIChatMessage(
                conversation_id=conversation.id,
                role="user",
                content=f"Terminal command\n$ {command.command}",
                provider=config.name,
                source_mode="cli_terminal",
                cli_command=command.command,
            )
        )

        output = (command.output or "").strip()
        assistant_content = output or f"Command exited with code {command.exit_code}."
        db.add(
            AIChatMessage(
                conversation_id=conversation.id,
                role="assistant",
                content=assistant_content,
                model=conversation.model or config.default_model,
                provider=config.name,
                source_mode="cli_terminal",
                cli_command=command.command,
                cli_exit_code=command.exit_code,
                cli_duration_ms=command.duration_ms,
            )
        )
        imported_messages += 2

    last_imported_at = commands[-1].created_at if commands else cli_session.last_imported_at
    cli_session.last_imported_at = last_imported_at
    if commands:
        conversation.updated_at = datetime.now(UTC)
    await db.commit()

    return CLISessionImportResponse(
        cli_session_id=cli_session.id,
        imported_commands=len(commands),
        imported_messages=imported_messages,
        last_imported_at=last_imported_at,
    )


@router.put("/conversations/{conversation_id}", response_model=ConversationDetail)
async def update_conversation(
    conversation_id: str,
    data: ConversationUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Rename a conversation."""
    conv = await db.get(AIConversation, conversation_id)
    if conv is None or conv.user_id != current_user.id:
        raise AppException(ErrorCode.AI_CONVERSATION_NOT_FOUND, "Conversation not found")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(conv, field, value)

    await db.commit()
    await db.refresh(conv)
    return ConversationDetail(
        id=conv.id,
        project_id=conv.project_id,
        title=conv.title,
        pinned=conv.pinned,
        model=conv.model,
        provider_config_id=conv.provider_config_id,
        created_at=conv.created_at,
        updated_at=conv.updated_at,
        messages=[],
    )


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(
    conversation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a conversation and all its messages and attachments."""
    conv = await db.get(AIConversation, conversation_id)
    if conv is None or conv.user_id != current_user.id:
        raise AppException(ErrorCode.AI_CONVERSATION_NOT_FOUND, "Conversation not found")

    # Delete attachment files from disk
    msg_stmt = select(AIChatMessage).where(AIChatMessage.conversation_id == conversation_id)
    msg_result = await db.execute(msg_stmt)
    for msg in msg_result.scalars().all():
        att_stmt = select(AIAttachment).where(AIAttachment.message_id == msg.id)
        att_result = await db.execute(att_stmt)
        for att in att_result.scalars().all():
            path = Path(att.storage_path)
            if path.exists():
                path.unlink()

    await db.delete(conv)  # cascade deletes messages and attachments
    await db.commit()


# =============================================================================
# Attachments
# =============================================================================


@router.post(
    "/attachments",
    response_model=AttachmentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_attachment(
    file: UploadFile,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload a file attachment."""
    if file.size and file.size > settings.ai_max_upload_bytes:
        raise AppException(
            ErrorCode.AI_ATTACHMENT_TOO_LARGE,
            f"File exceeds {settings.ai_max_upload_bytes // (1024 * 1024)}MB limit",
        )

    content = await file.read()
    if len(content) > settings.ai_max_upload_bytes:
        raise AppException(
            ErrorCode.AI_ATTACHMENT_TOO_LARGE,
            f"File exceeds {settings.ai_max_upload_bytes // (1024 * 1024)}MB limit",
        )

    att_id = str(uuid.uuid4())
    ext = Path(file.filename or "file").suffix
    user_dir = Path(settings.ai_attachments_dir) / current_user.id
    user_dir.mkdir(parents=True, exist_ok=True)
    storage_path = user_dir / f"{att_id}{ext}"

    storage_path.write_bytes(content)

    attachment = AIAttachment(
        id=att_id,
        user_id=current_user.id,
        filename=file.filename or "untitled",
        content_type=file.content_type or "application/octet-stream",
        size_bytes=len(content),
        storage_path=str(storage_path),
    )
    db.add(attachment)
    await db.commit()
    await db.refresh(attachment)
    return attachment


@router.get("/attachments/{attachment_id}")
async def download_attachment(
    attachment_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Download a file attachment."""
    att = await db.get(AIAttachment, attachment_id)
    if att is None or att.user_id != current_user.id:
        raise AppException(ErrorCode.AI_ATTACHMENT_NOT_FOUND, "Attachment not found")

    path = Path(att.storage_path)
    if not path.exists():
        raise AppException(ErrorCode.AI_ATTACHMENT_NOT_FOUND, "File not found on disk")

    return FileResponse(
        path=str(path),
        filename=att.filename,
        media_type=att.content_type,
    )


@router.delete("/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_attachment(
    attachment_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a file attachment."""
    att = await db.get(AIAttachment, attachment_id)
    if att is None or att.user_id != current_user.id:
        raise AppException(ErrorCode.AI_ATTACHMENT_NOT_FOUND, "Attachment not found")

    path = Path(att.storage_path)
    if path.exists():
        path.unlink()

    await db.delete(att)
    await db.commit()


# =============================================================================
# REST Chat API
# =============================================================================


@router.post("/chat", response_model=RESTChatResponse)
async def rest_chat(
    body: RESTChatRequest,
    stream: bool = Query(False, description="Enable SSE streaming"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Send a chat message and receive AI response.

    Two modes:
    - **Conversation-based**: provide `content` + `conversation_id`
      (server loads history)
    - **Stateless**: provide `messages` array
      (client sends full conversation)

    Query params:
    - `stream=true`: Returns Server-Sent Events (SSE) stream
    - `stream=false` (default): Returns complete JSON response
    """
    # Validate: either content or messages must be provided
    if not body.content and not body.messages:
        raise AppException(
            ErrorCode.AI_PROVIDER_ERROR,
            "Either 'content' or 'messages' must be provided",
        )
    if body.content and body.messages:
        raise AppException(
            ErrorCode.AI_PROVIDER_ERROR,
            "Provide either 'content' or 'messages', not both",
        )

    # Resolve provider
    svc = LLMService(db)
    if body.overrides and body.overrides.provider_id:
        provider = await svc.get_provider_by_id(
            body.overrides.provider_id, user_id=current_user.id
        )
    else:
        provider = await svc.get_provider_for_context(
            user_id=current_user.id,
            context_type=body.context_type,
            project_id=body.project_id,
        )

    if provider is None:
        raise AppException(
            ErrorCode.AI_PROVIDER_NOT_FOUND,
            "No AI provider configured. Go to Settings -> AI to add one.",
        )

    # Build context
    ctx_builder = ContextBuilder(db)
    context = await ctx_builder.build(
        project_id=body.project_id,
        preset="standard",
    )

    # Build messages
    system_prompt = DEFAULT_SYSTEM_PROMPT
    if body.overrides and body.overrides.system_prompt:
        system_prompt = body.overrides.system_prompt
    else:
        system_prompt = await _get_system_prompt(
            db, current_user.id, body.context_type,
        )

    if body.messages:
        # Mode 2: stateless -- use provided messages directly
        messages: list[dict] = [{"role": "system", "content": system_prompt}]
        if context:
            messages.append(
                {"role": "user", "content": f"<context>\n{context}\n</context>"}
            )
        for m in body.messages:
            messages.append({"role": m.role, "content": m.content})
    elif body.conversation_id:
        # Mode 1: conversation-based -- load history from DB
        messages = await build_messages_from_conversation(
            db,
            conversation_id=body.conversation_id,
            new_content=body.content,
            system_prompt=system_prompt,
            project_context=context,
        )
    else:
        # Simple mode: content without conversation_id
        messages = [{"role": "system", "content": system_prompt}]
        if context:
            messages.append(
                {"role": "user", "content": f"<context>\n{context}\n</context>"}
            )
        messages.append({"role": "user", "content": body.content})

    # Persist user message if conversation provided
    user_message_id = None
    if body.conversation_id and body.content:
        user_message_id = await _persist_user_message(
            db, body.conversation_id, body.content, body.attachment_ids,
        )
        await _update_conversation_title(
            db, body.conversation_id, body.content,
        )

    # Generate a message_id for tracking
    message_id = str(uuid.uuid4())
    model = body.overrides.model if body.overrides else None
    temperature = body.overrides.temperature if body.overrides else None
    max_tokens = body.overrides.max_tokens if body.overrides else None

    # Submit to ChatTaskManager
    await chat_task_manager.submit(
        message_id=message_id,
        provider=provider,
        messages=messages,
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
        conversation_id=body.conversation_id,
        db_session_factory=async_session_maker,
    )

    if stream:
        # SSE streaming mode
        return EventSourceResponse(
            _stream_sse(message_id, user_message_id),
            media_type="text/event-stream",
        )

    # Non-streaming mode: wait for completion
    queue = chat_task_manager.subscribe(message_id)
    try:
        result = None
        while True:
            data = await asyncio.wait_for(queue.get(), timeout=300)
            if data is _STREAM_END:
                break
            if data.get("done"):
                result = data.get("result")
                break

        if result is None:
            raise AppException(
                ErrorCode.AI_PROVIDER_ERROR,
                "Generation produced no result",
            )

        if result.error and result.error != "cancelled":
            raise AppException(ErrorCode.AI_PROVIDER_ERROR, result.error)

        total = None
        if result.prompt_tokens and result.completion_tokens:
            total = result.prompt_tokens + result.completion_tokens

        return RESTChatResponse(
            user_message_id=user_message_id,
            assistant_message_id=result.assistant_message_id,
            content=result.content,
            model=result.model,
            provider=result.provider,
            source_mode=result.source_mode,
            cli_command=result.cli_command,
            prompt_tokens=result.prompt_tokens,
            completion_tokens=result.completion_tokens,
            total_tokens=total,
        )
    finally:
        chat_task_manager.unsubscribe(message_id, queue)


async def _stream_sse(
    message_id: str, user_message_id: str | None,
):
    """Generate SSE events from ChatTaskManager queue."""
    queue = chat_task_manager.subscribe(message_id)
    try:
        while True:
            data = await asyncio.wait_for(queue.get(), timeout=300)
            if data is _STREAM_END:
                break
            if data.get("done"):
                result = data.get("result")
                if result:
                    complete = {
                        "type": "complete",
                        "user_message_id": user_message_id,
                        "assistant_message_id": (
                            result.assistant_message_id
                        ),
                        "content": result.content,
                        "model": result.model,
                        "provider": result.provider,
                        "source_mode": result.source_mode,
                        "cli_command": result.cli_command,
                        "prompt_tokens": result.prompt_tokens,
                        "completion_tokens": result.completion_tokens,
                    }
                    if result.prompt_tokens and result.completion_tokens:
                        complete["total_tokens"] = (
                            result.prompt_tokens + result.completion_tokens
                        )
                    yield {"data": json.dumps(complete)}
                break
            else:
                yield {
                    "data": json.dumps({
                        "type": "chunk",
                        "content": data["content"],
                    })
                }
    except TimeoutError:
        yield {
            "data": json.dumps({
                "type": "error",
                "message": "Generation timed out",
            })
        }
    finally:
        chat_task_manager.unsubscribe(message_id, queue)


# =============================================================================
# Message Branching & Editing
# =============================================================================


@router.put(
    "/conversations/{conversation_id}/messages/{message_id}",
    response_model=ChatMessageResponse,
)
async def update_message(
    conversation_id: str,
    message_id: str,
    body: MessageUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a message's content in-place (no regeneration)."""
    conv = await db.get(AIConversation, conversation_id)
    if conv is None or conv.user_id != current_user.id:
        raise AppException(ErrorCode.AI_CONVERSATION_NOT_FOUND, "Conversation not found")

    msg = await db.get(AIChatMessage, message_id)
    if msg is None or msg.conversation_id != conversation_id:
        raise AppException(ErrorCode.AI_CONVERSATION_NOT_FOUND, "Message not found")

    msg.content = body.content
    await db.commit()
    await db.refresh(msg)

    return ChatMessageResponse(
        id=msg.id,
        conversation_id=msg.conversation_id,
        role=msg.role,
        content=msg.content,
        model=msg.model,
        provider=msg.provider,
        tokens_prompt=msg.tokens_prompt,
        tokens_completion=msg.tokens_completion,
        error=msg.error,
        source_mode=msg.source_mode,
        cli_command=msg.cli_command,
        cli_exit_code=msg.cli_exit_code,
        cli_duration_ms=msg.cli_duration_ms,
        parent_id=msg.parent_id,
        sibling_index=msg.sibling_index,
        sibling_count=1,
        attachments=[],
        created_at=msg.created_at,
    )


@router.post(
    "/conversations/{conversation_id}/messages/{message_id}/branch",
    response_model=ChatMessageResponse,
)
async def branch_message(
    conversation_id: str,
    message_id: str,
    body: MessageBranchRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new branch from a user message with edited content.

    This creates a new sibling user message with the edited content,
    sharing the same parent as the original message.
    """
    conv = await db.get(AIConversation, conversation_id)
    if conv is None or conv.user_id != current_user.id:
        raise AppException(ErrorCode.AI_CONVERSATION_NOT_FOUND, "Conversation not found")

    original = await db.get(AIChatMessage, message_id)
    if original is None or original.conversation_id != conversation_id:
        raise AppException(ErrorCode.AI_CONVERSATION_NOT_FOUND, "Message not found")
    if original.role != "user":
        raise AppException(ErrorCode.VALIDATION_ERROR, "Only user messages can be branched")

    # Count existing siblings to determine new sibling_index
    sibling_count_stmt = (
        select(func.count())
        .select_from(AIChatMessage)
        .where(
            AIChatMessage.conversation_id == conversation_id,
            AIChatMessage.parent_id == original.parent_id,
        )
    )
    result = await db.execute(sibling_count_stmt)
    existing_count = result.scalar() or 0

    # Create the new sibling user message
    new_msg = AIChatMessage(
        conversation_id=conversation_id,
        role="user",
        content=body.content,
        parent_id=original.parent_id,
        sibling_index=existing_count,
    )
    db.add(new_msg)
    await db.flush()

    await db.commit()

    return ChatMessageResponse(
        id=new_msg.id,
        conversation_id=new_msg.conversation_id,
        role=new_msg.role,
        content=new_msg.content,
        model=None,
        provider=None,
        tokens_prompt=None,
        tokens_completion=None,
        error=None,
        source_mode=new_msg.source_mode,
        cli_command=new_msg.cli_command,
        cli_exit_code=new_msg.cli_exit_code,
        cli_duration_ms=new_msg.cli_duration_ms,
        parent_id=new_msg.parent_id,
        sibling_index=new_msg.sibling_index,
        sibling_count=existing_count + 1,
        attachments=[],
        created_at=new_msg.created_at,
    )


# =============================================================================
# Memories
# =============================================================================


@router.get("/memories", response_model=list[MemoryResponse])
async def list_memories(
    project_id: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all memories for a project."""
    stmt = (
        select(AIMemory)
        .where(
            AIMemory.user_id == current_user.id,
            AIMemory.project_id == project_id,
        )
        .order_by(AIMemory.created_at)
    )
    result = await db.execute(stmt)
    return [MemoryResponse.model_validate(m) for m in result.scalars()]


@router.post(
    "/memories", response_model=MemoryResponse, status_code=status.HTTP_201_CREATED
)
async def create_memory(
    body: MemoryCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new memory."""
    memory = AIMemory(
        user_id=current_user.id,
        project_id=body.project_id,
        key=body.key,
        value=body.value,
    )
    db.add(memory)
    await db.commit()
    await db.refresh(memory)
    return MemoryResponse.model_validate(memory)


@router.put("/memories/{memory_id}", response_model=MemoryResponse)
async def update_memory(
    memory_id: str,
    body: MemoryUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a memory."""
    memory = await db.get(AIMemory, memory_id)
    if memory is None or memory.user_id != current_user.id:
        raise AppException(ErrorCode.AI_CONVERSATION_NOT_FOUND, "Memory not found")

    if body.key is not None:
        memory.key = body.key
    if body.value is not None:
        memory.value = body.value
    await db.commit()
    await db.refresh(memory)
    return MemoryResponse.model_validate(memory)


@router.delete("/memories/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_memory(
    memory_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a memory."""
    memory = await db.get(AIMemory, memory_id)
    if memory is None or memory.user_id != current_user.id:
        raise AppException(ErrorCode.AI_CONVERSATION_NOT_FOUND, "Memory not found")

    await db.delete(memory)
    await db.commit()
