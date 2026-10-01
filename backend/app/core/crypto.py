"""Encryption utilities for sensitive data."""
import json

from cryptography.fernet import Fernet

_RUNTIME_KEY: bytes | None = None


def get_or_create_key() -> bytes:
    """Get or create an encryption key.

    In production, this should be loaded from environment/config.
    For development, we generate a stable process-local key once.
    """
    from app.config import settings

    global _RUNTIME_KEY

    if settings.ai_encryption_key:
        return settings.ai_encryption_key.encode()
    if _RUNTIME_KEY is None:
        _RUNTIME_KEY = Fernet.generate_key()
    return _RUNTIME_KEY


def encrypt_api_key(api_key: str | None, key: bytes) -> bytes | None:
    """Encrypt an API key.

    Args:
        api_key: The API key to encrypt (or None)
        key: The Fernet encryption key

    Returns:
        Encrypted bytes or None if api_key is None
    """
    if api_key is None:
        return None

    fernet = Fernet(key)
    return fernet.encrypt(api_key.encode())


def decrypt_api_key(encrypted: bytes | None, key: bytes) -> str | None:
    """Decrypt an API key.

    Args:
        encrypted: The encrypted API key (or None)
        key: The Fernet encryption key

    Returns:
        Decrypted API key string or None if encrypted is None
    """
    if encrypted is None:
        return None

    fernet = Fernet(key)
    return fernet.decrypt(encrypted).decode()


def encrypt_env_vars(env_vars: dict[str, str] | None, key: bytes) -> bytes | None:
    """Encrypt environment variables dict as JSON.

    Args:
        env_vars: Dict of env var name->value (or None)
        key: The Fernet encryption key

    Returns:
        Encrypted bytes or None if env_vars is None
    """
    if env_vars is None:
        return None

    fernet = Fernet(key)
    return fernet.encrypt(json.dumps(env_vars).encode())


def decrypt_env_vars(encrypted: bytes | None, key: bytes) -> dict[str, str] | None:
    """Decrypt environment variables from encrypted bytes.

    Args:
        encrypted: The encrypted env vars (or None)
        key: The Fernet encryption key

    Returns:
        Decrypted dict or None if encrypted is None
    """
    if encrypted is None:
        return None

    fernet = Fernet(key)
    return json.loads(fernet.decrypt(encrypted).decode())
