"""MCP session manager — tracks active sessions with SQLite persistence."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select, update

from app.core.logging import get_logger
from app.models.mcp_session import MCPSessionRecord

log = get_logger("mcp.session")


@dataclass
class MCPSession:
    """An active MCP client session (in-memory runtime object)."""

    id: str
    user_id: str
    project_id: str | None
    agent_process_id: str | None = None
    db_factory: Any = None  # async_session_maker
    created_at: datetime = field(
        default_factory=lambda: datetime.now(UTC)
    )
    last_activity: datetime = field(
        default_factory=lambda: datetime.now(UTC)
    )

    def touch(self) -> None:
        self.last_activity = datetime.now(UTC)


class MCPSessionManager:
    """Manages MCP sessions with inactivity timeout and SQLite persistence."""

    def __init__(self) -> None:
        self._sessions: dict[str, MCPSession] = {}

    async def create_session(
        self,
        user_id: str,
        project_id: str | None = None,
        db_factory: Any = None,
        agent_process_id: str | None = None,
    ) -> str:
        """Create a new session in memory and persist to SQLite."""
        sid = str(uuid.uuid4())
        now = datetime.now(UTC)
        self._sessions[sid] = MCPSession(
            id=sid,
            user_id=user_id,
            project_id=project_id,
            agent_process_id=agent_process_id,
            db_factory=db_factory,
            created_at=now,
            last_activity=now,
        )

        if db_factory is not None:
            try:
                async with db_factory() as db:
                    record = MCPSessionRecord(
                        id=sid,
                        user_id=user_id,
                        project_id=project_id,
                        agent_process_id=agent_process_id,
                        last_activity=now,
                        is_active=True,
                    )
                    db.add(record)
                    await db.commit()
            except Exception:
                log.warning("Failed to persist MCP session", session_id=sid)

        return sid

    def get_session(self, session_id: str) -> MCPSession | None:
        session = self._sessions.get(session_id)
        if session:
            session.touch()
        return session

    async def delete_session(self, session_id: str) -> None:
        """Remove from memory and soft-delete in SQLite (is_active=False)."""
        session = self._sessions.pop(session_id, None)
        if session and session.db_factory is not None:
            try:
                async with session.db_factory() as db:
                    await db.execute(
                        update(MCPSessionRecord)
                        .where(MCPSessionRecord.id == session_id)
                        .values(is_active=False)
                    )
                    await db.commit()
            except Exception:
                log.warning(
                    "Failed to soft-delete MCP session in DB",
                    session_id=session_id,
                )

    async def reload_sessions(self, db_factory: Any) -> int:
        """Reload active sessions from SQLite on startup.

        Sessions older than the timeout window are marked inactive and
        not loaded into memory. Returns the count of sessions reloaded.
        """
        cutoff = datetime.now(UTC) - timedelta(minutes=30)
        reloaded = 0

        async with db_factory() as db:
            # Mark stale sessions inactive
            await db.execute(
                update(MCPSessionRecord)
                .where(
                    MCPSessionRecord.is_active.is_(True),
                    MCPSessionRecord.last_activity < cutoff,
                )
                .values(is_active=False)
            )
            await db.commit()

            # Load remaining active sessions
            result = await db.execute(
                select(MCPSessionRecord).where(
                    MCPSessionRecord.is_active.is_(True)
                )
            )
            records = result.scalars().all()

            for record in records:
                self._sessions[record.id] = MCPSession(
                    id=record.id,
                    user_id=record.user_id,
                    project_id=record.project_id,
                    agent_process_id=getattr(
                        record, "agent_process_id", None
                    ),
                    db_factory=db_factory,
                    created_at=record.created_at,
                    last_activity=record.last_activity,
                )
                reloaded += 1

        log.info("MCP sessions reloaded from DB", count=reloaded)
        return reloaded

    async def cleanup_stale(
        self, timeout_minutes: int = 30, db_factory: Any = None
    ) -> int:
        """Remove sessions inactive for longer than timeout.

        Cleans both in-memory dict and SQLite records. Returns count removed.
        """
        cutoff = datetime.now(UTC) - timedelta(minutes=timeout_minutes)
        stale = [
            sid
            for sid, s in self._sessions.items()
            if s.last_activity < cutoff
        ]
        for sid in stale:
            del self._sessions[sid]

        # Also mark stale records in DB
        if db_factory is not None:
            try:
                async with db_factory() as db:
                    await db.execute(
                        update(MCPSessionRecord)
                        .where(
                            MCPSessionRecord.is_active.is_(True),
                            MCPSessionRecord.last_activity < cutoff,
                        )
                        .values(is_active=False)
                    )
                    await db.commit()
            except Exception:
                log.warning("Failed to mark stale sessions inactive in DB")

        return len(stale)


# Module-level singleton
mcp_session_manager = MCPSessionManager()
