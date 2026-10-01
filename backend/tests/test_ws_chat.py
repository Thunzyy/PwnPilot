"""Tests for WebSocket AI chat handler."""
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app
from app.models.user import User


@pytest.fixture
def mock_user():
    user = MagicMock(spec=User)
    user.id = "test-user-id"
    user.username = "testuser"
    user.is_active = True
    return user


@pytest.fixture
def mock_db():
    return AsyncMock()


@pytest.fixture
def client(mock_db):
    app.dependency_overrides[get_db] = lambda: mock_db
    original_lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def noop_lifespan(_app):
        yield

    app.router.lifespan_context = noop_lifespan
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.router.lifespan_context = original_lifespan
        app.dependency_overrides.clear()


class TestWSAuthentication:
    def test_ws_rejects_without_token(self, client, mock_db):
        """Test that WS connection without token is rejected."""
        with client.websocket_connect("/ws/ai/proj-1") as ws:
            data = ws.receive_json()
            assert data["type"] == "error"
            assert "Authentication" in data["message"]

    @patch("app.routers.ws_chat.decode_access_token")
    def test_ws_rejects_invalid_token(self, mock_decode, client, mock_db):
        mock_decode.side_effect = Exception("Invalid token")

        with client.websocket_connect("/ws/ai/proj-1?token=bad-token") as ws:
            data = ws.receive_json()
            assert data["type"] == "error"

    @patch("app.routers.ws_chat.decode_access_token")
    def test_ws_accepts_valid_token(self, mock_decode, client, mock_db, mock_user):
        mock_decode.return_value = {"sub": "test-user-id"}
        mock_db.get.return_value = mock_user

        # Provide mock for execute to avoid errors on system prompt lookup
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result

        with client.websocket_connect("/ws/ai/proj-1?token=good-token") as ws:
            # Connection stays open — send a cancel msg to verify communication
            ws.send_json({"type": "cancel", "message_id": "nonexistent"})
            # No error means connection is live and authenticated

        mock_db.close.assert_awaited_once()
