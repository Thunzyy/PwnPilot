"""Agent configuration CRUD router.

Endpoints for managing CLI agent configurations (Claude Code, Codex,
custom).  Secrets (api_key, env_vars) are stored encrypted and never
returned in plaintext.
"""
import os
import shutil

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import encrypt_api_key, encrypt_env_vars, get_or_create_key
from app.core.deps import get_current_user
from app.core.errors import ErrorCode
from app.core.exceptions import AppException
from app.database import get_db
from app.models.agent_config import AgentConfig
from app.models.user import User
from app.routers.agent_templates import router as templates_router
from app.schemas.agent_config import (
    AgentConfigCreate,
    AgentConfigResponse,
    AgentConfigUpdate,
    BinaryVerifyResult,
)
from app.services.agent.config_service import config_to_response, handle_default_flag

router = APIRouter(prefix="/agents", tags=["agents"])
router.include_router(templates_router)


# =============================================================================
# Helpers
# =============================================================================


async def _get_user_config(
    config_id: int,
    user: User,
    db: AsyncSession,
) -> AgentConfig:
    """Fetch an agent config owned by *user* or raise 404."""
    result = await db.execute(
        select(AgentConfig).where(
            AgentConfig.id == config_id,
            AgentConfig.user_id == user.id,
        )
    )
    config = result.scalar_one_or_none()
    if config is None:
        raise AppException(
            ErrorCode.AGENT_CONFIG_NOT_FOUND,
            f"Agent config not found: {config_id}",
            {"config_id": config_id},
        )
    return config


# =============================================================================
# CRUD endpoints
# =============================================================================


@router.get("/configs", response_model=list[AgentConfigResponse])
async def list_configs(
    project_id: str | None = Query(default=None),
    include_templates: bool = Query(default=False),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List agent configs for the authenticated user.

    When ``project_id`` is provided, returns configs scoped to that project
    **plus** global configs (``project_id IS NULL``).
    Templates are excluded by default; pass ``include_templates=true`` to
    include them.
    """
    stmt = select(AgentConfig).where(AgentConfig.user_id == current_user.id)
    if not include_templates:
        stmt = stmt.where(AgentConfig.is_template == False)  # noqa: E712
    if project_id is not None:
        stmt = stmt.where(
            (AgentConfig.project_id == project_id)
            | (AgentConfig.project_id.is_(None))
        )
    result = await db.execute(stmt)
    configs = result.scalars().all()
    return [config_to_response(c) for c in configs]


@router.post(
    "/configs",
    response_model=AgentConfigResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_config(
    data: AgentConfigCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new agent configuration."""
    # Validate: custom agents require a command_template
    if data.agent_type == "custom" and not (data.command_template or "").strip():
        raise AppException(
            ErrorCode.AGENT_CONFIG_INVALID,
            "Custom agent requires a command_template",
            {"field": "command_template"},
        )

    enc_key = get_or_create_key()

    if data.is_default:
        await handle_default_flag(db, current_user.id, data.project_id)

    config = AgentConfig(
        user_id=current_user.id,
        project_id=data.project_id,
        agent_type=data.agent_type,
        display_name=data.display_name,
        binary_path=data.binary_path,
        default_model=data.default_model,
        max_turns=data.max_turns,
        api_key_encrypted=encrypt_api_key(data.api_key, enc_key),
        env_vars_encrypted=encrypt_env_vars(data.env_vars, enc_key),
        is_default=data.is_default,
        system_prompt=data.system_prompt,
        description=data.description,
        is_template=data.is_template,
        command_template=data.command_template,
    )
    db.add(config)
    await db.commit()
    await db.refresh(config)
    return config_to_response(config)


@router.get("/configs/{config_id}", response_model=AgentConfigResponse)
async def get_config(
    config_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a single agent configuration."""
    config = await _get_user_config(config_id, current_user, db)
    return config_to_response(config)


@router.put("/configs/{config_id}", response_model=AgentConfigResponse)
async def update_config(
    config_id: int,
    data: AgentConfigUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update an existing agent configuration.

    Only fields that are explicitly provided (not None) are updated.
    Providing ``api_key`` or ``env_vars`` re-encrypts the value.
    """
    config = await _get_user_config(config_id, current_user, db)
    enc_key = get_or_create_key()

    if data.is_default is True:
        await handle_default_flag(db, current_user.id, config.project_id)

    update_fields = data.model_dump(exclude_unset=True)

    for field, value in update_fields.items():
        if field == "api_key":
            config.api_key_encrypted = encrypt_api_key(value, enc_key)
        elif field == "env_vars":
            config.env_vars_encrypted = encrypt_env_vars(value, enc_key)
        else:
            setattr(config, field, value)

    await db.commit()
    await db.refresh(config)
    return config_to_response(config)


@router.delete(
    "/configs/{config_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_config(
    config_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete an agent configuration."""
    config = await _get_user_config(config_id, current_user, db)
    await db.delete(config)
    await db.commit()


@router.post(
    "/configs/{config_id}/verify",
    response_model=BinaryVerifyResult,
)
async def verify_binary(
    config_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Verify the agent binary exists and is executable.

    For configs without an explicit ``binary_path``, falls back to a
    ``shutil.which()`` lookup using the agent_type default name.
    """
    config = await _get_user_config(config_id, current_user, db)

    # Determine the binary to check
    type_default_binary = {
        "claude_code": "claude",
        "codex": "codex",
        "custom": None,
    }
    binary = config.binary_path or type_default_binary.get(config.agent_type)

    if binary is None:
        return BinaryVerifyResult(
            config_id=config.id,
            binary_path="(none)",
            found=False,
            resolved_path=None,
        )

    # Try PATH lookup first, then explicit path check
    resolved = shutil.which(binary)
    if resolved is not None:
        return BinaryVerifyResult(
            config_id=config.id,
            binary_path=binary,
            found=True,
            resolved_path=resolved,
        )

    # Explicit file check (absolute/relative path)
    if os.path.isfile(binary) and os.access(binary, os.X_OK):
        return BinaryVerifyResult(
            config_id=config.id,
            binary_path=binary,
            found=True,
            resolved_path=os.path.abspath(binary),
        )

    return BinaryVerifyResult(
        config_id=config.id,
        binary_path=binary,
        found=False,
        resolved_path=None,
    )
