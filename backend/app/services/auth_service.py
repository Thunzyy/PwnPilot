from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth import (
    create_access_token,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    verify_password,
)
from app.core.errors import ErrorCode
from app.core.exceptions import AppException
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.services.base import BaseService


class AuthService(BaseService):
    def __init__(self, db: AsyncSession):
        super().__init__("service.auth")
        self.db = db

    async def create_user(self, data) -> User:
        if await self._exists_username(data.username):
            raise AppException(ErrorCode.AUTH_USERNAME_TAKEN, "Username already taken")
        if data.email and await self._exists_email(data.email):
            raise AppException(ErrorCode.AUTH_EMAIL_TAKEN, "Email already taken")

        count = await self._user_count()
        user = User(
            username=data.username,
            email=data.email,
            password_hash=hash_password(data.password),
            is_super_admin=(count == 0),
        )
        self.db.add(user)
        await self.db.commit()
        await self.db.refresh(user)
        return user

    async def authenticate(self, username_or_email: str, password: str) -> User:
        result = await self.db.execute(
            select(User).where(
                (User.username == username_or_email) | (User.email == username_or_email)
            )
        )
        user = result.scalar_one_or_none()
        if not user or not verify_password(password, user.password_hash):
            raise AppException(ErrorCode.AUTH_INVALID_CREDENTIALS, "Invalid credentials")
        return user

    async def issue_tokens(self, user: User) -> tuple[str, str]:
        access_token = create_access_token({"sub": user.id})
        refresh_token = generate_refresh_token()
        token_hash = hash_refresh_token(refresh_token)
        expires = datetime.now(UTC) + timedelta(days=settings.refresh_token_ttl_days)
        self.db.add(
            RefreshToken(
                user_id=user.id,
                token_hash=token_hash,
                expires_at=expires,
            )
        )
        await self.db.commit()
        return access_token, refresh_token

    async def rotate_refresh(self, token: str) -> tuple[str, str]:
        token_hash = hash_refresh_token(token)
        result = await self.db.execute(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        )
        stored = result.scalar_one_or_none()
        now = datetime.now(UTC)
        revoked_at = self._coerce_utc(stored.revoked_at) if stored else None
        expires_at = self._coerce_utc(stored.expires_at) if stored else None
        if not stored or revoked_at or (expires_at is not None and expires_at < now):
            raise AppException(ErrorCode.AUTH_REFRESH_REVOKED, "Refresh token invalid")
        stored.revoked_at = now
        await self.db.commit()
        user = await self.db.get(User, stored.user_id)
        return await self.issue_tokens(user)

    async def revoke_refresh(self, token: str) -> None:
        token_hash = hash_refresh_token(token)
        result = await self.db.execute(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        )
        stored = result.scalar_one_or_none()
        if stored and not stored.revoked_at:
            stored.revoked_at = datetime.now(UTC)
            await self.db.commit()

    async def update_user(self, user: User, data) -> User:
        update = data.model_dump(exclude_unset=True)
        for key, value in update.items():
            setattr(user, key, value)
        await self.db.commit()
        await self.db.refresh(user)
        return user

    async def _exists_username(self, username: str) -> bool:
        result = await self.db.execute(select(User).where(User.username == username))
        return result.scalar_one_or_none() is not None

    async def _exists_email(self, email: str | None) -> bool:
        if not email:
            return False
        result = await self.db.execute(select(User).where(User.email == email))
        return result.scalar_one_or_none() is not None

    async def _user_count(self) -> int:
        result = await self.db.execute(select(func.count(User.id)))
        return int(result.scalar_one())

    @staticmethod
    def _coerce_utc(value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
