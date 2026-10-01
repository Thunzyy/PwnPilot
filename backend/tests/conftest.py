import os
import shutil
import sys
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from httpx import ASGITransport, AsyncClient

# Add the backend directory to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.config import settings
from app.database import Base, get_db, init_fts_tables
from app.main import app


# Configure anyio to only use asyncio (SQLAlchemy async doesn't support trio)
@pytest.fixture
def anyio_backend():
    return "asyncio"


# Use in-memory SQLite for tests
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
test_session_maker = async_sessionmaker(test_engine, expire_on_commit=False)

TEST_RUNTIME_ROOT = Path(__file__).resolve().parent.parent / ".pytest-runtime"
TEST_RUNTIME_ROOT.mkdir(parents=True, exist_ok=True)


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
    """Create a fresh test database for each test."""
    async with test_engine.begin() as conn:
        await reset_fts_tables(conn)
        await conn.run_sync(Base.metadata.create_all)
        await init_fts_tables(conn)

    async with test_session_maker() as session:
        yield session

    async with test_engine.begin() as conn:
        await reset_fts_tables(conn)
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture(autouse=True)
def isolated_runtime_paths():
    """Keep backend tests inside the writable workspace on Windows/Linux."""
    runtime_id = uuid.uuid4().hex[:8]
    projects_root = TEST_RUNTIME_ROOT / f"projects-{runtime_id}"
    attachments_root = TEST_RUNTIME_ROOT / f"attachments-{runtime_id}"
    projects_root.mkdir(parents=True, exist_ok=True)
    attachments_root.mkdir(parents=True, exist_ok=True)

    previous_projects_root = settings.projects_root
    previous_allowed_workspace_roots = list(settings.allowed_workspace_roots)
    previous_attachments_dir = settings.ai_attachments_dir

    settings.projects_root = str(projects_root)
    settings.allowed_workspace_roots = [str(TEST_RUNTIME_ROOT)]
    settings.ai_attachments_dir = str(attachments_root)

    try:
        yield
    finally:
        settings.projects_root = previous_projects_root
        settings.allowed_workspace_roots = previous_allowed_workspace_roots
        settings.ai_attachments_dir = previous_attachments_dir
        shutil.rmtree(projects_root, ignore_errors=True)
        shutil.rmtree(attachments_root, ignore_errors=True)


@pytest.fixture
def tmp_path() -> Path:
    """Workspace-local tmp_path replacement for Windows-hosted test runs."""
    path = TEST_RUNTIME_ROOT / f"pytest-{uuid.uuid4().hex[:8]}"
    path.mkdir(parents=True, exist_ok=False)
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


@pytest.fixture(scope="function")
async def client(test_db: AsyncSession):
    """HTTP client with isolated test database."""
    async def get_test_db():
        yield test_db

    app.dependency_overrides[get_db] = get_test_db

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest.fixture(scope="function")
async def auth_headers(client: AsyncClient):
    user_suffix = uuid.uuid4().hex[:8]
    payload = {
        "username": f"user_{user_suffix}",
        "email": f"user_{user_suffix}@example.com",
        "password": "secret123",
    }
    await client.post("/api/v1/auth/signup", json=payload)
    login = await client.post(
        "/api/v1/auth/login",
        json={"username_or_email": payload["username"], "password": payload["password"]},
    )
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def unique_project_name() -> str:
    """Generate a unique project name for tests."""
    return f"Test Project {uuid.uuid4().hex[:8]}"
