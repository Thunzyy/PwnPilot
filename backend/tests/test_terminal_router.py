import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, MagicMock
from datetime import datetime, timezone

from app.main import app
from app.core.deps import get_current_user
from app.database import get_db
from app.services.console_provider import ConsoleSession, TerminalCapabilities
from app.services.provider_factory import get_provider


@pytest.fixture
def mock_session():
    return ConsoleSession(
        id="test-123",
        project_id=None,
        name="Test",
        websocket_url="ws://localhost:7680/ws",
        master_token="master-abc",
        viewer_token="viewer-xyz",
        is_alive=True,
        created_at=datetime.now(timezone.utc),
    )


@pytest.fixture
def mock_provider(mock_session):
    provider = MagicMock()
    provider.create_session = AsyncMock(return_value=mock_session)
    provider.get_session = AsyncMock(return_value=mock_session)
    provider.list_sessions = MagicMock(return_value=[mock_session])
    provider.destroy_session = AsyncMock(return_value=True)
    provider.resize = AsyncMock(return_value=True)
    provider.get_capabilities = MagicMock(
        return_value=TerminalCapabilities(
            provider="legacy",
            platform="windows",
            can_create_session=True,
            can_detach=False,
            websocket_mode="legacy",
            reason_unavailable="Detach to native terminal requires the tmux_ttyd provider.",
        )
    )
    return provider


@pytest.fixture
def client(mock_provider):
    class DummyUser:
        id = "user-1"
        is_super_admin = True

    def get_mock_provider():
        return mock_provider

    db = MagicMock()
    db.commit = AsyncMock()
    db.execute = AsyncMock()

    async def get_test_db():
        yield db

    async def get_test_user():
        return DummyUser()

    app.dependency_overrides[get_provider] = get_mock_provider
    app.dependency_overrides[get_db] = get_test_db
    app.dependency_overrides[get_current_user] = get_test_user
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_create_session_returns_tokens(client, mock_provider):
    response = client.post(
        "/api/v1/terminal/sessions",
        json={"name": "Test"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["id"] == "test-123"
    assert data["websocket_url"] == "ws://localhost:7680/ws"
    assert "master_token" in data
    assert "viewer_token" in data
    mock_provider.create_session.assert_awaited_once()


def test_list_sessions(client, mock_provider):
    response = client.get("/api/v1/terminal/sessions")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["id"] == "test-123"


def test_get_session(client, mock_provider):
    response = client.get("/api/v1/terminal/sessions/test-123")
    assert response.status_code == 200
    assert response.json()["id"] == "test-123"


def test_delete_session(client, mock_provider):
    response = client.delete("/api/v1/terminal/sessions/test-123")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_get_terminal_capabilities(client, mock_provider):
    response = client.get("/api/v1/terminal/capabilities")

    assert response.status_code == 200
    assert response.json() == {
        "provider": "legacy",
        "platform": "windows",
        "can_create_session": True,
        "can_detach": False,
        "websocket_mode": "legacy",
        "reason_unavailable": "Detach to native terminal requires the tmux_ttyd provider.",
    }


def test_detach_session_returns_400_when_provider_does_not_support_it(client):
    response = client.post("/api/v1/terminal/sessions/test-123/detach", json={"terminal": "auto"})

    assert response.status_code == 400
    assert response.json()["detail"] == "Detach to native terminal requires the tmux_ttyd provider."
