from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_project_member
from app.database import get_db
from app.models.command_filter import CommandFilter
from app.schemas.command_filter import (
    CommandFilterCreate,
    CommandFilterResponse,
    CommandFilterUpdate,
)

router = APIRouter(prefix="/command-filters", tags=["command-filters"])
project_router = APIRouter(
    prefix="/projects/{project_id}/command-filters", tags=["command-filters"]
)


@router.get("", response_model=list[CommandFilterResponse])
async def list_global_filters(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CommandFilter).where(CommandFilter.scope == "global")
    )
    return result.scalars().all()


@router.post("", response_model=CommandFilterResponse, status_code=status.HTTP_201_CREATED)
async def create_global_filter(
    data: CommandFilterCreate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    command_filter = CommandFilter(
        name=data.name,
        sort_order=data.sort_order,
        scope="global",
        project_id=None,
    )
    db.add(command_filter)
    await db.commit()
    await db.refresh(command_filter)
    return command_filter


@router.put("/{filter_id}", response_model=CommandFilterResponse)
async def update_global_filter(
    filter_id: str,
    data: CommandFilterUpdate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CommandFilter).where(
            CommandFilter.id == filter_id,
            CommandFilter.scope == "global",
        )
    )
    command_filter = result.scalar_one_or_none()
    if not command_filter:
        raise HTTPException(status_code=404, detail="Filter not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(command_filter, key, value)

    await db.commit()
    await db.refresh(command_filter)
    return command_filter


@router.delete("/{filter_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_global_filter(
    filter_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CommandFilter).where(
            CommandFilter.id == filter_id,
            CommandFilter.scope == "global",
        )
    )
    command_filter = result.scalar_one_or_none()
    if not command_filter:
        raise HTTPException(status_code=404, detail="Filter not found")

    await db.delete(command_filter)
    await db.commit()


@project_router.get("", response_model=list[CommandFilterResponse])
async def list_project_filters(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    _project=Depends(require_project_member),
):
    result = await db.execute(
        select(CommandFilter).where(
            CommandFilter.scope == "project",
            CommandFilter.project_id == project_id,
        )
    )
    return result.scalars().all()


@project_router.post(
    "", response_model=CommandFilterResponse, status_code=status.HTTP_201_CREATED
)
async def create_project_filter(
    project_id: str,
    data: CommandFilterCreate,
    db: AsyncSession = Depends(get_db),
    _project=Depends(require_project_member),
):
    command_filter = CommandFilter(
        name=data.name,
        sort_order=data.sort_order,
        scope="project",
        project_id=project_id,
    )
    db.add(command_filter)
    await db.commit()
    await db.refresh(command_filter)
    return command_filter


@project_router.put("/{filter_id}", response_model=CommandFilterResponse)
async def update_project_filter(
    project_id: str,
    filter_id: str,
    data: CommandFilterUpdate,
    db: AsyncSession = Depends(get_db),
    _project=Depends(require_project_member),
):
    result = await db.execute(
        select(CommandFilter).where(
            CommandFilter.id == filter_id,
            CommandFilter.scope == "project",
            CommandFilter.project_id == project_id,
        )
    )
    command_filter = result.scalar_one_or_none()
    if not command_filter:
        raise HTTPException(status_code=404, detail="Filter not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(command_filter, key, value)

    await db.commit()
    await db.refresh(command_filter)
    return command_filter


@project_router.delete("/{filter_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project_filter(
    project_id: str,
    filter_id: str,
    db: AsyncSession = Depends(get_db),
    _project=Depends(require_project_member),
):
    result = await db.execute(
        select(CommandFilter).where(
            CommandFilter.id == filter_id,
            CommandFilter.scope == "project",
            CommandFilter.project_id == project_id,
        )
    )
    command_filter = result.scalar_one_or_none()
    if not command_filter:
        raise HTTPException(status_code=404, detail="Filter not found")

    await db.delete(command_filter)
    await db.commit()
