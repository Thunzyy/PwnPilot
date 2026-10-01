"""API endpoints for prompt templates."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.ai import AIPromptTemplate
from app.models.user import User
from app.routers.auth import get_current_user
from app.schemas.ai import (
    CategoryGroup,
    PromptTemplateCreate,
    PromptTemplateResponse,
    PromptTemplateUpdate,
    TemplatesByCategory,
)
from app.services.prompt_sync import (
    delete_user_template,
    get_category_name,
    save_user_template,
)

router = APIRouter(prefix="/prompts", tags=["prompts"])


def _to_response(template: AIPromptTemplate) -> PromptTemplateResponse:
    """Convert DB model to response schema."""
    return PromptTemplateResponse(
        id=template.id,
        type=template.type,
        category=template.category,
        name=template.name,
        description=template.description,
        variables=template.variables or [],
        content=template.content,
        is_default=template.is_default,
        is_user_created=template.user_id is not None,
        created_at=template.created_at,
        updated_at=template.updated_at,
    )


@router.get("/system", response_model=list[PromptTemplateResponse])
async def list_system_prompts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all system prompts (pre-prompts).

    Returns system templates and user-created system prompts.
    """
    result = await db.execute(
        select(AIPromptTemplate)
        .where(AIPromptTemplate.type == "system")
        .where(
            AIPromptTemplate.user_id.is_(None)
            | (AIPromptTemplate.user_id == current_user.id)
        )
        .order_by(AIPromptTemplate.category, AIPromptTemplate.name)
    )
    templates = result.scalars().all()
    return [_to_response(t) for t in templates]


@router.get("/templates", response_model=TemplatesByCategory)
async def list_templates_by_category(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all insertion templates grouped by category."""
    result = await db.execute(
        select(AIPromptTemplate)
        .where(AIPromptTemplate.type == "template")
        .where(
            AIPromptTemplate.user_id.is_(None)
            | (AIPromptTemplate.user_id == current_user.id)
        )
        .order_by(AIPromptTemplate.category, AIPromptTemplate.name)
    )
    templates = result.scalars().all()

    # Group by category
    categories_dict: dict[str, list[PromptTemplateResponse]] = {}
    for t in templates:
        if t.category not in categories_dict:
            categories_dict[t.category] = []
        categories_dict[t.category].append(_to_response(t))

    # Convert to response format
    categories = [
        CategoryGroup(
            id=cat_id,
            name=get_category_name(cat_id),
            templates=cat_templates,
        )
        for cat_id, cat_templates in sorted(categories_dict.items())
    ]

    return TemplatesByCategory(categories=categories)


@router.get("/templates/{category}", response_model=list[PromptTemplateResponse])
async def list_templates_for_category(
    category: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List templates for a specific category."""
    result = await db.execute(
        select(AIPromptTemplate)
        .where(AIPromptTemplate.type == "template")
        .where(AIPromptTemplate.category == category)
        .where(
            AIPromptTemplate.user_id.is_(None)
            | (AIPromptTemplate.user_id == current_user.id)
        )
        .order_by(AIPromptTemplate.name)
    )
    templates = result.scalars().all()
    return [_to_response(t) for t in templates]


@router.get("/{prompt_id}", response_model=PromptTemplateResponse)
async def get_prompt(
    prompt_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a specific prompt template by ID."""
    result = await db.execute(
        select(AIPromptTemplate)
        .where(AIPromptTemplate.id == prompt_id)
        .where(
            AIPromptTemplate.user_id.is_(None)
            | (AIPromptTemplate.user_id == current_user.id)
        )
    )
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Prompt template not found",
        )

    return _to_response(template)


@router.post("", response_model=PromptTemplateResponse, status_code=status.HTTP_201_CREATED)
async def create_prompt(
    data: PromptTemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new user prompt template.

    Saves to JSON file and syncs to database.
    """
    template = await save_user_template(
        db=db,
        user_id=current_user.id,
        prompt_type=data.type,
        name=data.name,
        description=data.description,
        category=data.category,
        variables=data.variables,
        content=data.content,
    )
    return _to_response(template)


@router.put("/{prompt_id}", response_model=PromptTemplateResponse)
async def update_prompt(
    prompt_id: int,
    data: PromptTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a user-created prompt template.

    Only user-created templates can be modified.
    """
    result = await db.execute(
        select(AIPromptTemplate)
        .where(AIPromptTemplate.id == prompt_id)
        .where(AIPromptTemplate.user_id == current_user.id)
    )
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Prompt template not found or you don't have permission to edit it",
        )

    # Update via save_user_template to keep file in sync
    updated = await save_user_template(
        db=db,
        user_id=current_user.id,
        prompt_type=template.type,
        name=data.name or template.name,
        description=data.description if data.description is not None else template.description,
        category=template.category,  # Category cannot be changed
        variables=data.variables if data.variables is not None else template.variables,
        content=data.content or template.content,
    )

    return _to_response(updated)


@router.delete("/{prompt_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_prompt(
    prompt_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a user-created prompt template.

    Only user-created templates can be deleted.
    """
    result = await db.execute(
        select(AIPromptTemplate)
        .where(AIPromptTemplate.id == prompt_id)
        .where(AIPromptTemplate.user_id == current_user.id)
    )
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Prompt template not found or you don't have permission to delete it",
        )

    deleted = await delete_user_template(db, template)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot delete system templates",
        )


@router.post("/{prompt_id}/set-default", response_model=PromptTemplateResponse)
async def set_default_prompt(
    prompt_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Set a system prompt as the default for its category.

    Only system-type prompts can be set as default.
    """
    result = await db.execute(
        select(AIPromptTemplate)
        .where(AIPromptTemplate.id == prompt_id)
        .where(AIPromptTemplate.type == "system")
        .where(
            AIPromptTemplate.user_id.is_(None)
            | (AIPromptTemplate.user_id == current_user.id)
        )
    )
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="System prompt not found",
        )

    # Unset any existing default for this user in this category
    await db.execute(
        select(AIPromptTemplate)
        .where(AIPromptTemplate.type == "system")
        .where(AIPromptTemplate.category == template.category)
        .where(AIPromptTemplate.is_default.is_(True))
        .where(
            AIPromptTemplate.user_id.is_(None)
            | (AIPromptTemplate.user_id == current_user.id)
        )
    )

    # First, unset all defaults for this category
    existing_defaults = await db.execute(
        select(AIPromptTemplate)
        .where(AIPromptTemplate.type == "system")
        .where(AIPromptTemplate.is_default.is_(True))
    )
    for existing in existing_defaults.scalars().all():
        existing.is_default = False

    # Set new default
    template.is_default = True
    await db.commit()
    await db.refresh(template)

    return _to_response(template)


@router.get("/default/{category}", response_model=PromptTemplateResponse | None)
async def get_default_prompt(
    category: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the default system prompt for a category.

    Returns None if no default is set.
    """
    # First check for user's custom default
    result = await db.execute(
        select(AIPromptTemplate)
        .where(AIPromptTemplate.type == "system")
        .where(AIPromptTemplate.category == category)
        .where(AIPromptTemplate.is_default.is_(True))
        .where(AIPromptTemplate.user_id == current_user.id)
    )
    template = result.scalar_one_or_none()

    if template:
        return _to_response(template)

    # Fall back to system default
    result = await db.execute(
        select(AIPromptTemplate)
        .where(AIPromptTemplate.type == "system")
        .where(AIPromptTemplate.category == category)
        .where(AIPromptTemplate.is_default.is_(True))
        .where(AIPromptTemplate.user_id.is_(None))
    )
    template = result.scalar_one_or_none()

    if template:
        return _to_response(template)

    # No default set, return first system prompt for this category
    result = await db.execute(
        select(AIPromptTemplate)
        .where(AIPromptTemplate.type == "system")
        .where(AIPromptTemplate.category == category)
        .where(AIPromptTemplate.user_id.is_(None))
        .limit(1)
    )
    template = result.scalar_one_or_none()

    return _to_response(template) if template else None
