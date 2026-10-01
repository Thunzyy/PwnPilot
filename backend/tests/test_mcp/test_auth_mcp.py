"""Tests for MCP project-scoped JWT token generation."""

import time

import pytest

from app.core.auth import create_mcp_token, decode_access_token
from app.core.exceptions import AppException


def test_create_mcp_token_contains_required_claims():
    """Token must contain sub, project_id, type, and exp claims."""
    token = create_mcp_token("user1", "proj1")
    payload = decode_access_token(token)

    assert payload["sub"] == "user1"
    assert payload["project_id"] == "proj1"
    assert payload["type"] == "mcp"
    assert "exp" in payload


def test_create_mcp_token_default_ttl():
    """Default TTL should be approximately 60 minutes."""
    before = time.time()
    token = create_mcp_token("user1", "proj1")
    after = time.time()
    payload = decode_access_token(token)

    exp = payload["exp"]
    # exp should be ~60 minutes from now (allow 5s tolerance)
    expected_min = before + (60 * 60) - 5
    expected_max = after + (60 * 60) + 5
    assert expected_min <= exp <= expected_max


def test_create_mcp_token_custom_ttl():
    """Custom TTL should be reflected in exp claim."""
    before = time.time()
    token = create_mcp_token("user1", "proj1", ttl_minutes=5)
    after = time.time()
    payload = decode_access_token(token)

    exp = payload["exp"]
    expected_min = before + (5 * 60) - 5
    expected_max = after + (5 * 60) + 5
    assert expected_min <= exp <= expected_max


def test_create_mcp_token_decodable_by_existing_decoder():
    """MCP tokens should be decodable by the standard decode_access_token."""
    token = create_mcp_token("user1", "proj1")
    payload = decode_access_token(token)

    assert isinstance(payload, dict)
    assert payload["sub"] == "user1"


def test_expired_mcp_token_raises():
    """An expired MCP token should raise AppException on decode."""
    # Create token with 0 TTL (already expired)
    token = create_mcp_token("user1", "proj1", ttl_minutes=0)
    # Token with 0 TTL has exp = now, which may not be expired yet
    # We need to wait a tiny bit or use negative
    # Actually, ttl_minutes=0 means exp = now, which jwt considers
    # "not expired" in the same second. Let's sleep briefly.
    time.sleep(1.1)

    with pytest.raises(AppException):
        decode_access_token(token)
