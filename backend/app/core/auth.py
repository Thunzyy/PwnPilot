import hashlib
import importlib.metadata
import secrets
from datetime import UTC, datetime, timedelta

import argon2
import jwt
from passlib.context import CryptContext

from app.config import settings
from app.core.errors import ErrorCode
from app.core.exceptions import AppException

# passlib still probes argon2.__version__, which now emits a deprecation
# warning through argon2-cffi's module __getattr__. Populate the attribute
# eagerly so auth tests and runtime don't hit that deprecated path.
if argon2.__dict__.get("__version__") is None:
    argon2.__version__ = importlib.metadata.version("argon2-cffi")

_pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")


def hash_password(password: str) -> str:
    return _pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return _pwd_context.verify(password, password_hash)


def create_access_token(payload: dict) -> str:
    to_encode = payload.copy()
    expires = datetime.now(UTC) + timedelta(
        minutes=settings.access_token_ttl_minutes
    )
    to_encode.update({"exp": expires})
    return jwt.encode(to_encode, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
    except jwt.PyJWTError as exc:
        raise AppException(
            ErrorCode.AUTH_INVALID_TOKEN,
            "Invalid access token",
            {"reason": str(exc)},
        ) from exc


def create_mcp_token(
    user_id: str,
    project_id: str,
    ttl_minutes: int = 60,
    agent_process_id: str | None = None,
) -> str:
    """Create a short-lived JWT scoped to a specific project for MCP access.

    The token includes:
    - sub: user ID
    - project_id: project scope
    - type: "mcp" (distinguishes from regular access tokens)
    - agent_process_id: optional agent process identifier
    - exp: expiration timestamp
    """
    expires = datetime.now(UTC) + timedelta(minutes=ttl_minutes)
    payload = {
        "sub": user_id,
        "project_id": project_id,
        "type": "mcp",
        "exp": expires,
    }
    if agent_process_id is not None:
        payload["agent_process_id"] = agent_process_id
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def generate_refresh_token() -> str:
    return secrets.token_urlsafe(32)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
