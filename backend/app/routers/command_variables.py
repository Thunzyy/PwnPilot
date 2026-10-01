from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.database import get_db
from app.models.command_variable import CommandVariable
from app.schemas.command_variable import CommandVariablesResponse, CommandVariablesUpdate

router = APIRouter(prefix="/commands/variables", tags=["command-variables"])


@router.get("", response_model=CommandVariablesResponse)
async def get_command_variables(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CommandVariable).where(CommandVariable.user_id == current_user.id)
    )
    variables = {var.key: var.value for var in result.scalars().all()}
    return variables


@router.put("", response_model=CommandVariablesResponse)
async def update_command_variables(
    data: CommandVariablesUpdate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    incoming = data.root

    existing_result = await db.execute(
        select(CommandVariable).where(CommandVariable.user_id == current_user.id)
    )
    existing = {var.key: var for var in existing_result.scalars().all()}

    for key, value in incoming.items():
        if key in existing:
            existing[key].value = value
        else:
            db.add(CommandVariable(user_id=current_user.id, key=key, value=value))

    to_delete = [var for key, var in existing.items() if key not in incoming]
    for var in to_delete:
        await db.delete(var)

    await db.commit()

    result = await db.execute(
        select(CommandVariable).where(CommandVariable.user_id == current_user.id)
    )
    variables = {var.key: var.value for var in result.scalars().all()}
    return variables
