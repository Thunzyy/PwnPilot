from pathlib import Path as PathLib

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.core.errors import ErrorCode
from app.core.exceptions import AppException
from app.database import get_db
from app.schemas.settings import (
    PathValidationResponse,
    SettingsResponse,
    SettingsUpdate,
)
from app.services.settings_service import SettingsService

router = APIRouter(prefix="/settings", tags=["settings"])


def _require_super_admin(user) -> None:
    if not user.is_super_admin:
        raise AppException(ErrorCode.AUTH_FORBIDDEN, "Super admin required")


@router.get("", response_model=SettingsResponse)
async def get_settings(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_super_admin(current_user)
    service = SettingsService(db)
    return await service.get_or_create_response()


@router.put("", response_model=SettingsResponse)
async def update_settings(
    data: SettingsUpdate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_super_admin(current_user)
    service = SettingsService(db)
    return await service.update_response(data)


@router.get("/validate-path", response_model=PathValidationResponse)
async def validate_path(
    path: str = Query(..., min_length=1),
    current_user=Depends(get_current_user),
):
    """Check if a server path exists, is a directory, and is an Obsidian vault."""
    p = PathLib(path).expanduser().resolve()
    return PathValidationResponse(
        path=str(p),
        exists=p.exists(),
        is_directory=p.is_dir(),
        is_obsidian_vault=(p / ".obsidian").is_dir() if p.is_dir() else False,
    )
