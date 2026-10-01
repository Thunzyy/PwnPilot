from fastapi import Depends, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import decode_access_token
from app.core.errors import ErrorCode
from app.core.exceptions import AppException
from app.database import get_db
from app.models.project import Project
from app.models.project_membership import ProjectMembership
from app.models.user import User

security = HTTPBearer(auto_error=False)


def _unauthorized() -> AppException:
    return AppException(ErrorCode.AUTH_INVALID_TOKEN, "Invalid access token")


async def _resolve_user(token: str, db: AsyncSession) -> User:
    """Decode a JWT token and return the corresponding active user."""
    payload = decode_access_token(token)
    user_id = payload.get("sub")
    if not user_id:
        raise _unauthorized()
    user = await db.get(User, user_id)
    if not user or not user.is_active:
        raise _unauthorized()
    return user


async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not creds:
        raise _unauthorized()
    return await _resolve_user(creds.credentials, db)


async def get_current_user_sse(
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Authenticate via ``?token=`` query param (for EventSource/SSE)."""
    if not token:
        raise _unauthorized()
    return await _resolve_user(token, db)


async def require_project_member(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Project:
    project = await db.get(Project, project_id)
    if not project:
        raise AppException(ErrorCode.PROJECT_NOT_FOUND, "Project not found")
    if current_user.is_super_admin:
        return project
    result = await db.execute(
        select(ProjectMembership).where(
            ProjectMembership.project_id == project_id,
            ProjectMembership.user_id == current_user.id,
            ProjectMembership.status == "active",
        )
    )
    if not result.scalar_one_or_none():
        raise AppException(ErrorCode.AUTH_FORBIDDEN, "Access denied")
    return project
