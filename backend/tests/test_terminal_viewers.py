import pytest
from fastapi.testclient import TestClient
from datetime import datetime, timezone

from app.main import app
from app.services.console_provider import ConsoleSession
from app.services.provider_factory import get_provider


@pytest.fixture
def mock_session():
    return ConsoleSession(
        id="test-123",
        project_id="proj-1",
        name="Test",
        websocket_url="ws://localhost:7680/ws",
        master_token="master-abc",
        viewer_token="viewer-xyz",
        is_alive=True,
        created_at=datetime.now(timezone.utc),
    )


@pytest.fixture
def mock_provider(mock_session):
    from unittest.mock import MagicMock, AsyncMock
    provider = MagicMock()
    provider.get_session = AsyncMock(return_value=mock_session)
    return provider


@pytest.fixture
def client(mock_provider):
    app.dependency_overrides[get_provider] = lambda: mock_provider
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_join_session_with_master_token(client, mock_session):
    response = client.post(
        f"/api/v1/terminal/sessions/{mock_session.id}/viewers",
        json={"token": "master-abc"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["role"] == "master"
    assert data["websocket_url"] == mock_session.websocket_url
    assert "viewer_id" in data


def test_join_session_with_viewer_token(client, mock_session):
    response = client.post(
        f"/api/v1/terminal/sessions/{mock_session.id}/viewers",
        json={"token": "viewer-xyz"},
    )
    assert response.status_code == 200
    assert response.json()["role"] == "viewer"


def test_join_session_invalid_token(client, mock_session):
    response = client.post(
        f"/api/v1/terminal/sessions/{mock_session.id}/viewers",
        json={"token": "invalid"},
    )
    assert response.status_code == 403


def test_list_viewers(client, mock_session):
    # First join
    client.post(f"/api/v1/terminal/sessions/{mock_session.id}/viewers", json={"token": "master-abc"})

    response = client.get(f"/api/v1/terminal/sessions/{mock_session.id}/viewers")
    assert response.status_code == 200
    assert len(response.json()) >= 1
