"""MCP router test fixtures with shared in-memory SQLite."""

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy import StaticPool
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, get_db, init_fts_tables
from app.main import app


# Shared in-memory SQLite: StaticPool ensures all connections use the same DB
_mcp_test_engine = create_async_engine(
    "sqlite+aiosqlite:///:memory:",
    echo=False,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
_mcp_test_session_maker = async_sessionmaker(
    _mcp_test_engine, expire_on_commit=False
)


async def reset_fts_tables(conn) -> None:
    """Drop SQLite FTS artifacts that SQLAlchemy metadata does not own."""
    for trigger_name in (
        "knowledge_docs_ai",
        "knowledge_docs_ad",
        "knowledge_docs_au",
    ):
        await conn.execute(text(f"DROP TRIGGER IF EXISTS {trigger_name}"))
    await conn.execute(text("DROP TABLE IF EXISTS knowledge_docs_fts"))


@pytest.fixture(scope="function")
async def test_db():
    """Create a fresh test database for each test (shared connection)."""
    async with _mcp_test_engine.begin() as conn:
        await reset_fts_tables(conn)
        await conn.run_sync(Base.metadata.create_all)
        await init_fts_tables(conn)

    async with _mcp_test_session_maker() as session:
        yield session

    async with _mcp_test_engine.begin() as conn:
        await reset_fts_tables(conn)
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


@pytest.fixture(autouse=True)
def _patch_mcp_session_maker(monkeypatch):
    """Route MCP router's async_session_maker to the test database."""
    import app.routers.mcp as mcp_module

    monkeypatch.setattr(mcp_module, "async_session_maker", _mcp_test_session_maker)


@pytest.fixture(scope="function")
async def auth_headers(client: AsyncClient):
    """Create user and return auth headers."""
    suffix = uuid.uuid4().hex[:8]
    payload = {
        "username": f"user_{suffix}",
        "email": f"user_{suffix}@example.com",
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
