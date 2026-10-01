from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_project_member
from app.database import get_db
from app.models.command_category import CommandCategory
from app.schemas.command_category import (
    CommandCategoryCreate,
    CommandCategoryResponse,
    CommandCategoryUpdate,
)

router = APIRouter(prefix="/command-categories", tags=["command-categories"])
project_router = APIRouter(
    prefix="/projects/{project_id}/command-categories", tags=["command-categories"]
)


@router.get("", response_model=list[CommandCategoryResponse])
async def list_global_categories(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CommandCategory).where(CommandCategory.scope == "global")
    )
    return result.scalars().all()


@router.post("", response_model=CommandCategoryResponse, status_code=status.HTTP_201_CREATED)
async def create_global_category(
    data: CommandCategoryCreate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    category = CommandCategory(
        name=data.name,
        sort_order=data.sort_order,
        scope="global",
        project_id=None,
    )
    db.add(category)
    await db.commit()
    await db.refresh(category)
    return category


@router.put("/{category_id}", response_model=CommandCategoryResponse)
async def update_global_category(
    category_id: str,
    data: CommandCategoryUpdate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CommandCategory).where(
            CommandCategory.id == category_id,
            CommandCategory.scope == "global",
        )
    )
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(category, key, value)

    await db.commit()
    await db.refresh(category)
    return category


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_global_category(
    category_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CommandCategory).where(
            CommandCategory.id == category_id,
            CommandCategory.scope == "global",
        )
    )
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    await db.delete(category)
    await db.commit()


@project_router.get("", response_model=list[CommandCategoryResponse])
async def list_project_categories(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    _project=Depends(require_project_member),
):
    result = await db.execute(
        select(CommandCategory).where(
            CommandCategory.scope == "project",
            CommandCategory.project_id == project_id,
        )
    )
    return result.scalars().all()


@project_router.post(
    "", response_model=CommandCategoryResponse, status_code=status.HTTP_201_CREATED
)
async def create_project_category(
    project_id: str,
    data: CommandCategoryCreate,
    db: AsyncSession = Depends(get_db),
    _project=Depends(require_project_member),
):
    category = CommandCategory(
        name=data.name,
        sort_order=data.sort_order,
        scope="project",
        project_id=project_id,
    )
    db.add(category)
    await db.commit()
    await db.refresh(category)
    return category


@project_router.put("/{category_id}", response_model=CommandCategoryResponse)
async def update_project_category(
    project_id: str,
    category_id: str,
    data: CommandCategoryUpdate,
    db: AsyncSession = Depends(get_db),
    _project=Depends(require_project_member),
):
    result = await db.execute(
        select(CommandCategory).where(
            CommandCategory.id == category_id,
            CommandCategory.scope == "project",
            CommandCategory.project_id == project_id,
        )
    )
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(category, key, value)

    await db.commit()
    await db.refresh(category)
    return category


@project_router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project_category(
    project_id: str,
    category_id: str,
    db: AsyncSession = Depends(get_db),
    _project=Depends(require_project_member),
):
    result = await db.execute(
        select(CommandCategory).where(
            CommandCategory.id == category_id,
            CommandCategory.scope == "project",
            CommandCategory.project_id == project_id,
        )
    )
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    await db.delete(category)
    await db.commit()
