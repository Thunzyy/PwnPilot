"""Tests for encryption utilities."""
from app.core.crypto import decrypt_api_key, encrypt_api_key, get_or_create_key


def test_encrypt_decrypt_api_key():
    """Test encrypting and decrypting an API key."""
    key = get_or_create_key()
    original = "sk-ant-api03-xxxxxxxxxxxx"

    encrypted = encrypt_api_key(original, key)
    assert encrypted != original.encode()
    assert isinstance(encrypted, bytes)

    decrypted = decrypt_api_key(encrypted, key)
    assert decrypted == original


def test_encrypt_none_returns_none():
    """Test that encrypting None returns None."""
    key = get_or_create_key()
    assert encrypt_api_key(None, key) is None


def test_decrypt_none_returns_none():
    """Test that decrypting None returns None."""
    key = get_or_create_key()
    assert decrypt_api_key(None, key) is None


def test_runtime_key_is_stable_within_the_same_process():
    """Development key generation should be stable within one process."""
    key1 = get_or_create_key()
    key2 = get_or_create_key()

    assert key1 == key2
