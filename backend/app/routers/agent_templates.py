"""Agent template endpoints.

Sub-router for listing and instantiating agent templates.
Included by the main agent_config router under the /agents prefix.
"""
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.core.errors import ErrorCode
from app.core.exceptions import AppException
from app.database import get_db
from app.models.agent_config import AgentConfig
from app.models.user import User
from app.schemas.agent_config import AgentConfigResponse
from app.services.agent.config_service import (
    config_to_response,
    instantiate_template,
    seed_builtin_templates,
)

router = APIRouter(tags=["agents"])


@router.get("/templates", response_model=list[AgentConfigResponse])
async def list_templates(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List agent templates for the current user.

    On first call, seeds built-in pentest templates if none exist.
    """
    stmt = select(AgentConfig).where(
        AgentConfig.user_id == current_user.id,
        AgentConfig.is_template == True,  # noqa: E712
    )
    result = await db.execute(stmt)
    templates = list(result.scalars().all())

    if not templates:
        created = await seed_builtin_templates(current_user.id, db)
        templates = created

    return [config_to_response(t) for t in templates]


@router.post(
    "/templates/{template_id}/instantiate",
    response_model=AgentConfigResponse,
    status_code=status.HTTP_201_CREATED,
)
async def instantiate_template_endpoint(
    template_id: int,
    project_id: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new agent config from a template.

    Copies all non-secret fields from the template. The user must
    configure API keys and environment variables separately.
    """
    result = await db.execute(
        select(AgentConfig).where(
            AgentConfig.id == template_id,
            AgentConfig.user_id == current_user.id,
        )
    )
    template = result.scalar_one_or_none()
    if template is None:
        raise AppException(
            ErrorCode.AGENT_CONFIG_NOT_FOUND,
            f"Agent config not found: {template_id}",
            {"config_id": template_id},
        )
    if not template.is_template:
        raise AppException(
            ErrorCode.AGENT_CONFIG_INVALID,
            "Not a template",
            {"config_id": template_id},
        )
    config = await instantiate_template(
        template, current_user.id, project_id, db
    )
    return config_to_response(config)
