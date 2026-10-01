"""Integration tests for agent process REST endpoints."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import StaticPool
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, get_db, init_fts_tables
from app.main import app
from app.services.agent.process_manager import AgentProcess

# Shared in-memory SQLite for router integration tests
_agent_test_engine = create_async_engine(
    "sqlite+aiosqlite:///:memory:",
    echo=False,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
_agent_test_session_maker = async_sessionmaker(
    _agent_test_engine, expire_on_commit=False
)

AGENTS_URL = "/api/v1/agents"


def _make_agent(**overrides) -> AgentProcess:
    """Build a mock AgentProcess with sensible defaults."""
    defaults = {
        "id": f"proj1-{uuid.uuid4().hex[:8]}",
        "agent_type": "claude_code",
        "project_id": "proj1",
        "user_id": "user1",
        "tmux_session": f"ppagent-proj1-{uuid.uuid4().hex[:8]}",
        "pid": 12345,
        "status": "running",
        "mcp_config_path": "/tmp/ppagent-mcp-test.json",
        "mcp_token": "mock-token",
        "created_at": datetime.now(UTC),
        "stopped_at": None,
        "exit_code": None,
    }
    defaults.update(overrides)
    return AgentProcess(**defaults)


# ---------- Fixtures ----------


@pytest.fixture(scope="function")
async def test_db():
    """Create a fresh test database for each test."""
    async with _agent_test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await init_fts_tables(conn)

    async with _agent_test_session_maker() as session:
        yield session

    async with _agent_test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture(scope="function")
async def client(test_db: AsyncSession):
    """HTTP client with isolated test database."""
    async def get_test_db():
        yield test_db

    app.dependency_overrides[get_db] = get_test_db

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest.fixture
async def auth_headers(client: AsyncClient):
    """Create a user and return auth headers."""
    suffix = uuid.uuid4().hex[:8]
    payload = {
        "username": f"agent_user_{suffix}",
        "email": f"agent_user_{suffix}@example.com",
        "password": "secret123",
    }
    await client.post("/api/v1/auth/signup", json=payload)
    login = await client.post(
        "/api/v1/auth/login",
        json={
            "username_or_email": payload["username"],
            "password": payload["password"],
        },
    )
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# ---------- Launch endpoint ----------


@pytest.mark.anyio
async def test_launch_returns_201_with_status(
    client: AsyncClient, auth_headers: dict
):
    """POST /agents/launch returns 201 with AgentStatusResponse fields."""
    mock_agent = _make_agent()

    with patch(
        "app.routers.agent_process.agent_process_manager"
    ) as mock_mgr:
        mock_mgr.launch_agent = AsyncMock(return_value=mock_agent)

        resp = await client.post(
            f"{AGENTS_URL}/launch",
            json={
                "agent_type": "claude_code",
                "prompt": "scan the target",
                "project_id": "proj1",
            },
            headers=auth_headers,
        )

    assert resp.status_code == 201
    body = resp.json()
    assert body["id"] == mock_agent.id
    assert body["agent_type"] == "claude_code"
    assert body["status"] == "running"
    assert body["tmux_session"].startswith("ppagent-")


@pytest.mark.anyio
async def test_launch_requires_auth(client: AsyncClient):
    """POST /agents/launch without auth returns 401."""
    resp = await client.post(
        f"{AGENTS_URL}/launch",
        json={
            "agent_type": "claude_code",
            "prompt": "test",
            "project_id": "proj1",
        },
    )
    assert resp.status_code == 401


# ---------- Stop endpoint ----------


@pytest.mark.anyio
async def test_stop_returns_200(client: AsyncClient, auth_headers: dict):
    """POST /agents/{id}/stop returns 200 with stopped status."""
    mock_agent = _make_agent(id="proj1-stop1")

    with patch(
        "app.routers.agent_process.agent_process_manager"
    ) as mock_mgr:
        mock_mgr.get_agent = AsyncMock(return_value=mock_agent)
        mock_mgr.stop_agent = AsyncMock()

        resp = await client.post(
            f"{AGENTS_URL}/proj1-stop1/stop",
            headers=auth_headers,
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "stopped"


@pytest.mark.anyio
async def test_stop_not_found_returns_404(
    client: AsyncClient, auth_headers: dict
):
    """POST /agents/{id}/stop returns 404 for unknown agent."""
    with patch(
        "app.routers.agent_process.agent_process_manager"
    ) as mock_mgr:
        mock_mgr.get_agent = AsyncMock(return_value=None)

        resp = await client.post(
            f"{AGENTS_URL}/nonexistent/stop",
            headers=auth_headers,
        )

    assert resp.status_code == 404
    assert "AGENT_NOT_FOUND" in resp.json()["error"]["code"]


# ---------- List endpoint ----------


@pytest.mark.anyio
async def test_list_agents_returns_empty(
    client: AsyncClient, auth_headers: dict
):
    """GET /agents returns empty list when no agents exist."""
    with patch(
        "app.routers.agent_process.agent_process_manager"
    ) as mock_mgr:
        mock_mgr.list_agents = MagicMock(return_value=[])

        resp = await client.get(
            AGENTS_URL,
            headers=auth_headers,
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["agents"] == []
    assert body["total"] == 0


@pytest.mark.anyio
async def test_list_agents_filters_by_project(
    client: AsyncClient, auth_headers: dict
):
    """GET /agents?project_id=X passes filter to process manager."""
    agent1 = _make_agent(project_id="proj1")

    with patch(
        "app.routers.agent_process.agent_process_manager"
    ) as mock_mgr:
        mock_mgr.list_agents = MagicMock(return_value=[agent1])

        resp = await client.get(
            f"{AGENTS_URL}?project_id=proj1",
            headers=auth_headers,
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["agents"][0]["project_id"] == "proj1"
    mock_mgr.list_agents.assert_called_once_with(project_id="proj1")


# ---------- Get endpoint ----------


@pytest.mark.anyio
async def test_get_agent_returns_status(
    client: AsyncClient, auth_headers: dict
):
    """GET /agents/{id} returns agent status."""
    mock_agent = _make_agent(id="proj1-get1")

    with patch(
        "app.routers.agent_process.agent_process_manager"
    ) as mock_mgr:
        mock_mgr.get_agent = AsyncMock(return_value=mock_agent)

        resp = await client.get(
            f"{AGENTS_URL}/proj1-get1",
            headers=auth_headers,
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == "proj1-get1"
    assert body["status"] == "running"


@pytest.mark.anyio
async def test_get_agent_not_found_returns_404(
    client: AsyncClient, auth_headers: dict
):
    """GET /agents/{id} returns 404 for unknown agent."""
    with patch(
        "app.routers.agent_process.agent_process_manager"
    ) as mock_mgr:
        mock_mgr.get_agent = AsyncMock(return_value=None)

        resp = await client.get(
            f"{AGENTS_URL}/nonexistent",
            headers=auth_headers,
        )

    assert resp.status_code == 404
    assert "AGENT_NOT_FOUND" in resp.json()["error"]["code"]
