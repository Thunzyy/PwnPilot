"""Command History Router - API endpoints for terminal command tracking."""

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_project_member
from app.database import get_db
from app.models.command_history import CommandHistory
from app.models.terminal_session import TerminalSessionDB
from app.models.timeline import Timeline
from app.schemas.command_history import (
    CommandHistoryCreate,
    CommandHistoryDetailListResponse,
    CommandHistoryDetailResponse,
    CommandHistoryListResponse,
    CommandHistoryResponse,
    PromoteToTimelineResponse,
)
from app.services.report_signal_service import report_signal_service

# =============================================================================
# Session Commands Router (for shell hook)
# =============================================================================

session_router = APIRouter(
    prefix="/terminal/sessions/{session_id}/commands",
    tags=["command-history"],
)

_COMMAND_ECHO_WINDOW = 8


def _build_output_preview(output: str | None) -> str | None:
    if not output:
        return None
    preview = output[:200].strip()
    if not preview:
        return None
    if len(output) > 200:
        preview = preview[:197] + "..."
    return preview


def _looks_like_command_echo(line: str, command: str) -> bool:
    stripped = line.strip()
    if not stripped or not command:
        return False
    if stripped == command:
        return True
    if not stripped.endswith(command):
        return False

    prefix = stripped[: -len(command)].rstrip()
    if not prefix:
        return True

    if len(prefix) > 120:
        return False

    return any(token in prefix for token in ("$", "#", ">", "%", "❯"))


def _trim_command_echo_from_output(output: str | None, command: str) -> str | None:
    if not output or not command:
        return output

    normalized = output.replace("\r\n", "\n").replace("\r", "\n")
    lines = normalized.split("\n")
    search_start = max(0, len(lines) - _COMMAND_ECHO_WINDOW)
    match_index: int | None = None
    for idx in range(search_start, len(lines)):
        if _looks_like_command_echo(lines[idx], command):
            match_index = idx
            break

    if match_index is None:
        return output

    trimmed = "\n".join(lines[:match_index]).rstrip()
    return trimmed or None


@session_router.post("", response_model=CommandHistoryResponse, status_code=status.HTTP_201_CREATED)
async def record_command(
    session_id: str,
    data: CommandHistoryCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Record a command executed in a terminal session (called by shell hook)."""
    # Get the session and verify it exists
    result = await db.execute(
        select(TerminalSessionDB).where(TerminalSessionDB.id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if not session.project_id:
        raise HTTPException(status_code=400, detail="Session has no project")

    # Verify user has access to the project
    await require_project_member(session.project_id, current_user, db)

    previous_commands = (
        await db.execute(
            select(CommandHistory)
            .where(CommandHistory.session_id == session_id)
            .order_by(CommandHistory.created_at.desc())
            .limit(5)
        )
    ).scalars().all()

    for previous in previous_commands:
        trimmed_output = _trim_command_echo_from_output(previous.output, data.command)
        if trimmed_output == previous.output:
            continue
        previous.output = trimmed_output
        previous.output_preview = _build_output_preview(trimmed_output)

    output_preview = _build_output_preview(data.output)

    command = CommandHistory(
        id=str(uuid.uuid4()),
        project_id=session.project_id,
        session_id=session_id,
        command=data.command,
        output=data.output,
        output_preview=output_preview,
        exit_code=data.exit_code,
        cwd=data.cwd,
        duration_ms=data.duration_ms,
        executed_by=current_user.id,
        source="user",
    )

    db.add(command)
    await db.commit()
    await db.refresh(command)
    report_signal_service.record_signal(
        project_id=session.project_id,
        signal_type="command_history",
        source_id=command.id,
    )

    resp = CommandHistoryResponse.model_validate(command)
    resp.session_name = session.name
    return resp


@session_router.get("")
async def list_session_commands(
    session_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    include_output: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """List commands for a specific session."""
    # Get the session and verify it exists
    result = await db.execute(
        select(TerminalSessionDB).where(TerminalSessionDB.id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.project_id:
        await require_project_member(session.project_id, current_user, db)

    # Count total
    count_result = await db.execute(
        select(func.count(CommandHistory.id)).where(
            CommandHistory.session_id == session_id
        )
    )
    total = count_result.scalar() or 0

    # Fetch commands with session name
    query = (
        select(CommandHistory, TerminalSessionDB.name.label("session_name"))
        .outerjoin(TerminalSessionDB, CommandHistory.session_id == TerminalSessionDB.id)
        .where(CommandHistory.session_id == session_id)
        .order_by(CommandHistory.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(query)
    rows = result.all()

    if include_output:
        items = []
        for cmd, session_name in rows:
            resp = CommandHistoryDetailResponse.model_validate(cmd)
            resp.session_name = session_name
            items.append(resp)
        return CommandHistoryDetailListResponse(
            items=items, total=total, limit=limit, offset=offset,
        )

    items = []
    for cmd, session_name in rows:
        resp = CommandHistoryResponse.model_validate(cmd)
        resp.session_name = session_name
        items.append(resp)
    return CommandHistoryListResponse(
        items=items, total=total, limit=limit, offset=offset,
    )


# =============================================================================
# Project Commands Router
# =============================================================================

project_router = APIRouter(
    prefix="/projects/{project_id}/commands/history",
    tags=["command-history"],
)


@project_router.get("")
async def list_project_commands(
    project_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    search: str | None = Query(default=None),
    exit_code: int | None = Query(default=None),
    session_id: str | None = Query(default=None),
    source: Literal["user", "ai", "template"] | None = Query(default=None),
    include_output: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    _project=Depends(require_project_member),
):
    """List command history for a project with optional filters."""
    # Build base query
    base_filter = CommandHistory.project_id == project_id

    # Apply filters
    filters = [base_filter]
    if search:
        filters.append(CommandHistory.command.ilike(f"%{search}%"))
    if exit_code is not None:
        filters.append(CommandHistory.exit_code == exit_code)
    if session_id:
        filters.append(CommandHistory.session_id == session_id)
    if source:
        filters.append(CommandHistory.source == source)

    # Count total
    count_result = await db.execute(
        select(func.count(CommandHistory.id)).where(*filters)
    )
    total = count_result.scalar() or 0

    # Fetch commands with session name via LEFT JOIN
    query = (
        select(CommandHistory, TerminalSessionDB.name.label("session_name"))
        .outerjoin(TerminalSessionDB, CommandHistory.session_id == TerminalSessionDB.id)
        .where(*filters)
        .order_by(CommandHistory.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(query)
    rows = result.all()

    if include_output:
        items = []
        for cmd, session_name in rows:
            resp = CommandHistoryDetailResponse.model_validate(cmd)
            resp.session_name = session_name
            items.append(resp)
        return CommandHistoryDetailListResponse(
            items=items, total=total, limit=limit, offset=offset,
        )

    items = []
    for cmd, session_name in rows:
        resp = CommandHistoryResponse.model_validate(cmd)
        resp.session_name = session_name
        items.append(resp)
    return CommandHistoryListResponse(
        items=items, total=total, limit=limit, offset=offset,
    )


@project_router.get("/{command_id}", response_model=CommandHistoryDetailResponse)
async def get_command(
    project_id: str,
    command_id: str,
    db: AsyncSession = Depends(get_db),
    _project=Depends(require_project_member),
):
    """Get a specific command with full output."""
    result = await db.execute(
        select(CommandHistory).where(
            CommandHistory.id == command_id,
            CommandHistory.project_id == project_id,
        )
    )
    command = result.scalar_one_or_none()
    if not command:
        raise HTTPException(status_code=404, detail="Command not found")

    return command


@project_router.delete("/{command_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_command(
    project_id: str,
    command_id: str,
    db: AsyncSession = Depends(get_db),
    _project=Depends(require_project_member),
):
    """Delete a command from history."""
    result = await db.execute(
        select(CommandHistory).where(
            CommandHistory.id == command_id,
            CommandHistory.project_id == project_id,
        )
    )
    command = result.scalar_one_or_none()
    if not command:
        raise HTTPException(status_code=404, detail="Command not found")

    await db.delete(command)
    await db.commit()


@project_router.post(
    "/{command_id}/to-timeline",
    response_model=PromoteToTimelineResponse,
    status_code=status.HTTP_201_CREATED,
)
async def promote_to_timeline(
    project_id: str,
    command_id: str,
    db: AsyncSession = Depends(get_db),
    _project=Depends(require_project_member),
):
    """Promote a command to a timeline entry."""
    result = await db.execute(
        select(CommandHistory).where(
            CommandHistory.id == command_id,
            CommandHistory.project_id == project_id,
        )
    )
    command = result.scalar_one_or_none()
    if not command:
        raise HTTPException(status_code=404, detail="Command not found")

    if command.timeline_id:
        raise HTTPException(status_code=400, detail="Command already promoted to timeline")

    # Create timeline entry
    timeline_entry = Timeline(
        id=str(uuid.uuid4()),
        project_id=project_id,
        type="command",
        content=command.command,
        output=command.output,
        entry_data={
            "exit_code": command.exit_code,
            "cwd": command.cwd,
            "duration_ms": command.duration_ms,
            "source": command.source,
            "command_history_id": command.id,
        },
    )

    db.add(timeline_entry)

    # Link command to timeline
    command.timeline_id = timeline_entry.id

    await db.commit()
    await db.refresh(timeline_entry)

    return PromoteToTimelineResponse(
        timeline_id=timeline_entry.id,
        command_id=command.id,
    )
