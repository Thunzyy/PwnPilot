import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.database import get_db
from app.models.command import Command
from app.schemas.command import CommandCreate, CommandResponse, CommandUpdate

router = APIRouter(prefix="/commands", tags=["commands"])


def build_seed_insert_statement(dialect_name: str):
    if dialect_name == "sqlite":
        return sqlite_insert(Command).on_conflict_do_nothing(index_elements=["id"])
    if dialect_name == "postgresql":
        return postgresql_insert(Command).on_conflict_do_nothing(index_elements=["id"])
    raise HTTPException(
        status_code=500,
        detail=f"Command seed is not configured for database dialect '{dialect_name}'",
    )


@router.get("", response_model=list[CommandResponse])
async def list_commands(
    category: str | None = Query(None),
    search: str | None = Query(None),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Command).where(Command.scope == "global")
    if category:
        query = query.where(Command.category.contains(category))
    if search:
        query = query.where(
            Command.name.contains(search) | Command.command.contains(search) | Command.description.contains(search)
        )
    result = await db.execute(query.order_by(Command.category))
    return result.scalars().all()


@router.post("", response_model=CommandResponse, status_code=status.HTTP_201_CREATED)
async def create_command(
    data: CommandCreate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    command = Command(
        name=data.name,
        category=data.category,
        command=data.command,
        description=data.description,
        tags=data.tags,
        is_custom=data.is_custom,
        scope="global",
        project_id=None,
    )
    db.add(command)
    await db.commit()
    await db.refresh(command)
    return command


@router.put("/{command_id}", response_model=CommandResponse)
async def update_command(
    command_id: str,
    data: CommandUpdate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Command).where(Command.id == command_id, Command.scope == "global")
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
async def delete_command(
    command_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Command).where(Command.id == command_id, Command.scope == "global")
    )
    command = result.scalar_one_or_none()
    if not command:
        raise HTTPException(status_code=404, detail="Command not found")

    await db.delete(command)
    await db.commit()


@router.post("/seed", status_code=201)
async def seed_commands(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    data_file = Path(__file__).parent.parent.parent / "data" / "commands.json"
    if not data_file.exists():
        return {"message": "No seed file found", "count": 0}

    with open(data_file) as f:
        commands_data = json.load(f)

    dialect_name = db.get_bind().dialect.name
    insert_statement = build_seed_insert_statement(dialect_name).values(commands_data)
    result = await db.execute(insert_statement)
    count = max(result.rowcount or 0, 0)

    await db.commit()
    return {"message": f"Seeded {count} commands", "count": count}
