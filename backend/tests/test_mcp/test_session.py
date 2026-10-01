"""Tests for MCP session manager with SQLite persistence."""

import pytest
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base
from app.mcp.session import MCPSession, MCPSessionManager
from app.models.mcp_session import MCPSessionRecord


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def db_engine():
    """In-memory SQLite engine for session tests."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.fixture
def db_factory(db_engine):
    """Async session maker for tests."""
    return async_sessionmaker(db_engine, expire_on_commit=False)


@pytest.fixture
def manager():
    return MCPSessionManager()


# --- Basic session operations (updated for async) ---


@pytest.mark.anyio
async def test_create_session(manager, db_factory):
    sid = await manager.create_session(
        user_id="u1", project_id="p1", db_factory=db_factory
    )
    assert sid is not None
    assert len(sid) > 0


@pytest.mark.anyio
async def test_get_session(manager, db_factory):
    sid = await manager.create_session(
        user_id="u1", project_id="p1", db_factory=db_factory
    )
    session = manager.get_session(sid)
    assert session is not None
    assert session.user_id == "u1"
    assert session.project_id == "p1"


@pytest.mark.anyio
async def test_get_session_unknown_returns_none(manager):
    assert manager.get_session("nonexistent") is None


@pytest.mark.anyio
async def test_delete_session(manager, db_factory):
    sid = await manager.create_session(
        user_id="u1", project_id="p1", db_factory=db_factory
    )
    await manager.delete_session(sid)
    assert manager.get_session(sid) is None


@pytest.mark.anyio
async def test_cleanup_stale_sessions(manager, db_factory):
    sid = await manager.create_session(
        user_id="u1", project_id="p1", db_factory=db_factory
    )
    # Artificially age the session
    manager._sessions[sid].last_activity = (
        datetime.now(timezone.utc) - timedelta(minutes=31)
    )
    removed = await manager.cleanup_stale(
        timeout_minutes=30, db_factory=db_factory
    )
    assert removed == 1
    assert manager.get_session(sid) is None


# --- Persistence tests ---


@pytest.mark.anyio
async def test_create_session_persists_to_db(manager, db_factory):
    """Creating a session should write a record to SQLite."""
    sid = await manager.create_session(
        user_id="u1", project_id="p1", db_factory=db_factory
    )

    async with db_factory() as db:
        record = await db.get(MCPSessionRecord, sid)
    assert record is not None
    assert record.user_id == "u1"
    assert record.project_id == "p1"
    assert record.is_active is True


@pytest.mark.anyio
async def test_delete_session_soft_deletes_in_db(manager, db_factory):
    """Deleting a session should set is_active=False in SQLite."""
    sid = await manager.create_session(
        user_id="u1", project_id="p1", db_factory=db_factory
    )
    await manager.delete_session(sid)

    async with db_factory() as db:
        record = await db.get(MCPSessionRecord, sid)
    assert record is not None
    assert record.is_active is False


@pytest.mark.anyio
async def test_reload_sessions_restores_from_db(manager, db_factory):
    """reload_sessions should restore active sessions into memory."""
    sid = await manager.create_session(
        user_id="u1", project_id="p1", db_factory=db_factory
    )

    # Clear in-memory sessions
    manager._sessions.clear()
    assert manager.get_session(sid) is None

    # Reload from DB
    count = await manager.reload_sessions(db_factory)
    assert count == 1

    session = manager.get_session(sid)
    assert session is not None
    assert session.user_id == "u1"
    assert session.project_id == "p1"


@pytest.mark.anyio
async def test_reload_sessions_skips_stale(manager, db_factory):
    """Stale sessions should not be reloaded and should be marked inactive."""
    sid = await manager.create_session(
        user_id="u1", project_id="p1", db_factory=db_factory
    )

    # Age the DB record beyond timeout
    stale_time = datetime.now(timezone.utc) - timedelta(minutes=60)
    async with db_factory() as db:
        record = await db.get(MCPSessionRecord, sid)
        record.last_activity = stale_time
        await db.commit()

    # Clear in-memory and reload
    manager._sessions.clear()
    count = await manager.reload_sessions(db_factory)
    assert count == 0
    assert manager.get_session(sid) is None

    # Verify DB record was marked inactive
    async with db_factory() as db:
        record = await db.get(MCPSessionRecord, sid)
    assert record.is_active is False


@pytest.mark.anyio
async def test_cleanup_stale_marks_db_inactive(manager, db_factory):
    """cleanup_stale should mark stale DB records as is_active=False."""
    sid = await manager.create_session(
        user_id="u1", project_id="p1", db_factory=db_factory
    )

    # Age the session past timeout (both in-memory and DB)
    stale_time = datetime.now(timezone.utc) - timedelta(minutes=31)
    manager._sessions[sid].last_activity = stale_time
    async with db_factory() as db:
        record = await db.get(MCPSessionRecord, sid)
        record.last_activity = stale_time
        await db.commit()

    removed = await manager.cleanup_stale(
        timeout_minutes=30, db_factory=db_factory
    )
    assert removed == 1

    async with db_factory() as db:
        record = await db.get(MCPSessionRecord, sid)
    assert record.is_active is False


@pytest.mark.anyio
async def test_datetime_uses_timezone_utc(manager, db_factory):
    """Session timestamps should be timezone-aware (UTC)."""
    sid = await manager.create_session(
        user_id="u1", project_id="p1", db_factory=db_factory
    )
    session = manager.get_session(sid)
    assert session is not None
    assert session.created_at.tzinfo is not None
    assert session.last_activity.tzinfo is not None
