from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_project_member
from app.database import get_db
from app.models.command import Command
from app.models.command_favorite import CommandFavorite

router = APIRouter(prefix="/commands", tags=["command-favorites"])
project_router = APIRouter(prefix="/projects/{project_id}/commands", tags=["command-favorites"])


@router.get("/favorites", response_model=list[str])
async def list_global_favorites(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CommandFavorite.command_id).where(
            CommandFavorite.user_id == current_user.id,
            CommandFavorite.project_id.is_(None),
        )
    )
    return result.scalars().all()


@router.post("/{command_id}/favorite", status_code=status.HTTP_201_CREATED)
async def favorite_global_command(
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

    existing = await db.execute(
        select(CommandFavorite).where(
            CommandFavorite.user_id == current_user.id,
            CommandFavorite.command_id == command_id,
            CommandFavorite.project_id.is_(None),
        )
    )
    if not existing.scalar_one_or_none():
        db.add(
            CommandFavorite(
                user_id=current_user.id,
                command_id=command_id,
                project_id=None,
            )
        )
        await db.commit()

    return {"command_id": command_id}


@router.delete("/{command_id}/favorite", status_code=status.HTTP_204_NO_CONTENT)
async def unfavorite_global_command(
    command_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CommandFavorite).where(
            CommandFavorite.user_id == current_user.id,
            CommandFavorite.command_id == command_id,
            CommandFavorite.project_id.is_(None),
        )
    )
    favorite = result.scalar_one_or_none()
    if not favorite:
        raise HTTPException(status_code=404, detail="Favorite not found")

    await db.delete(favorite)
    await db.commit()


@project_router.get("/favorites", response_model=list[str])
async def list_project_favorites(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    _project=Depends(require_project_member),
):
    result = await db.execute(
        select(CommandFavorite.command_id).where(
            CommandFavorite.user_id == current_user.id,
            CommandFavorite.project_id == project_id,
        )
    )
    return result.scalars().all()


@project_router.post("/{command_id}/favorite", status_code=status.HTTP_201_CREATED)
async def favorite_project_command(
    project_id: str,
    command_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
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

    existing = await db.execute(
        select(CommandFavorite).where(
            CommandFavorite.user_id == current_user.id,
            CommandFavorite.command_id == command_id,
            CommandFavorite.project_id == project_id,
        )
    )
    if not existing.scalar_one_or_none():
        db.add(
            CommandFavorite(
                user_id=current_user.id,
                command_id=command_id,
                project_id=project_id,
            )
        )
        await db.commit()

    return {"command_id": command_id}


@project_router.delete("/{command_id}/favorite", status_code=status.HTTP_204_NO_CONTENT)
async def unfavorite_project_command(
    project_id: str,
    command_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    _project=Depends(require_project_member),
):
    result = await db.execute(
        select(CommandFavorite).where(
            CommandFavorite.user_id == current_user.id,
            CommandFavorite.command_id == command_id,
            CommandFavorite.project_id == project_id,
        )
    )
    favorite = result.scalar_one_or_none()
    if not favorite:
        raise HTTPException(status_code=404, detail="Favorite not found")

    await db.delete(favorite)
    await db.commit()
