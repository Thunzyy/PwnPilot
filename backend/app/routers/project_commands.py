from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_project_member
from app.database import get_db
from app.models.command import Command
from app.schemas.command import CommandCreate, CommandResponse, CommandUpdate

router = APIRouter(prefix="/projects/{project_id}/commands", tags=["commands"])


@router.get("", response_model=list[CommandResponse])
async def list_project_commands(
    project_id: str,
    category: str | None = Query(None),
    search: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _project=Depends(require_project_member),
):
    query = select(Command).where(
        Command.scope == "project", Command.project_id == project_id
    )
    if category:
        query = query.where(Command.category.contains(category))
    if search:
        query = query.where(
            Command.name.contains(search) | Command.command.contains(search) | Command.description.contains(search)
        )
    result = await db.execute(query.order_by(Command.category))
    return result.scalars().all()


@router.post("", response_model=CommandResponse, status_code=status.HTTP_201_CREATED)
async def create_project_command(
    project_id: str,
    data: CommandCreate,
    db: AsyncSession = Depends(get_db),
    _project=Depends(require_project_member),
):
    command = Command(
        name=data.name,
        category=data.category,
        command=data.command,
        description=data.description,
        tags=data.tags,
        is_custom=data.is_custom,
        scope="project",
        project_id=project_id,
    )
    db.add(command)
    await db.commit()
    await db.refresh(command)
    return command


@router.put("/{command_id}", response_model=CommandResponse)
async def update_project_command(
    project_id: str,
    command_id: str,
    data: CommandUpdate,
    db: AsyncSession = Depends(get_db),
    _project=Depends(require_project_member),
):
    result = await db.execute(
        select(Command).where(
            Command.id == command_id,
            Command.scope == "project",
            Command.project_id == project_id,
        )
    )
    command = result.scalar_one_or_none()
    if not command:
        raise HTTPException(status_code=404, detail="Command not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(command, key, value)

    await db.commit()
    await db.refresh(command)
    return command


@router.delete("/{command_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project_command(
    project_id: str,
    command_id: str,
    db: AsyncSession = Depends(get_db),
    _project=Depends(require_project_member),
):
    result = await db.execute(
        select(Command).where(
            Command.id == command_id,
            Command.scope == "project",
            Command.project_id == project_id,
        )
    )
    command = result.scalar_one_or_none()
    if not command:
        raise HTTPException(status_code=404, detail="Command not found")

    await db.delete(command)
    await db.commit()
