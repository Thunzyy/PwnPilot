"""Agent process router -- REST API for agent subprocess lifecycle.

Thin controller layer: all business logic lives in the process manager
service. Endpoints delegate to ``agent_process_manager`` and convert
``AgentProcess`` dataclass results into ``AgentStatusResponse`` Pydantic
models.
"""

import asyncio
import json

from fastapi import APIRouter, Depends, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_current_user_sse
from app.core.errors import ErrorCode
from app.core.exceptions import AppException
from app.database import async_session_maker, get_db
from app.models.agent_mcp_log import AgentMCPLog
from app.schemas.agent_mcp_log import MCPLogListResponse, MCPLogResponse
from app.schemas.agent_process import (
    AgentLaunchFromConfigRequest,
    AgentLaunchRequest,
    AgentListResponse,
    AgentStatusResponse,
)
from app.services.agent.event_bus import agent_event_bus
from app.services.agent.process_manager import AgentProcess, agent_process_manager

router = APIRouter(prefix="/agents", tags=["agents"])


def _to_response(agent: AgentProcess) -> AgentStatusResponse:
    """Map an in-memory AgentProcess dataclass to an API response."""
    return AgentStatusResponse(
        id=agent.id,
        agent_type=agent.agent_type,
        project_id=agent.project_id,
        tmux_session=agent.tmux_session,
        pid=agent.pid,
        status=agent.status,
        created_at=agent.created_at,
        stopped_at=agent.stopped_at,
        exit_code=agent.exit_code,
        websocket_url=agent.websocket_url,
        output_mode=agent.output_mode,
    )


@router.post(
    "/launch",
    response_model=AgentStatusResponse,
    status_code=status.HTTP_201_CREATED,
)
async def launch_agent(
    data: AgentLaunchRequest,
    current_user=Depends(get_current_user),
):
    """Launch a new CLI agent in an isolated tmux session."""
    agent = await agent_process_manager.launch_agent(
        agent_type=data.agent_type,
        project_id=data.project_id,
        user_id=current_user.id,
        prompt=data.prompt,
        max_turns=data.max_turns,
        db_factory=async_session_maker,
    )
    return _to_response(agent)


@router.post(
    "/launch-from-config",
    response_model=AgentStatusResponse,
    status_code=status.HTTP_201_CREATED,
)
async def launch_agent_from_config(
    data: AgentLaunchFromConfigRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Launch an agent from a saved configuration.

    Resolves the config, decrypts secrets, builds project context
    (including checklist items), starts ttyd for live terminal output,
    and returns the websocket URL.
    """
    agent = await agent_process_manager.launch_agent_from_config(
        config_id=data.config_id,
        project_id=data.project_id,
        user_id=current_user.id,
        prompt=data.prompt,
        db=db,
        output_mode=data.output_mode,
    )
    return _to_response(agent)


@router.post(
    "/{agent_id}/stop",
    response_model=AgentStatusResponse,
)
async def stop_agent(
    agent_id: str,
    current_user=Depends(get_current_user),
):
    """Stop a running agent with signal escalation."""
    agent = await agent_process_manager.get_agent(agent_id)
    if agent is None:
        raise AppException(
            ErrorCode.AGENT_NOT_FOUND,
            f"Agent not found: {agent_id}",
            {"agent_id": agent_id},
        )

    # Capture pre-stop state for response
    await agent_process_manager.stop_agent(
        agent_id, db_factory=async_session_maker
    )

    # After stop, agent is removed from memory -- build response manually
    return AgentStatusResponse(
        id=agent.id,
        agent_type=agent.agent_type,
        project_id=agent.project_id,
        tmux_session=agent.tmux_session,
        pid=agent.pid,
        status="stopped",
        created_at=agent.created_at,
        stopped_at=agent.stopped_at,
        exit_code=agent.exit_code,
    )


@router.post(
    "/{agent_id}/execute",
    response_model=AgentStatusResponse,
)
async def execute_agent_command(
    agent_id: str,
    current_user=Depends(get_current_user),
):
    """Execute the agent's launch command in its tmux session.

    Called by the frontend after xterm.js connects so that all output
    is visible from the very first byte.
    """
    agent = await agent_process_manager.execute_agent_command(agent_id)
    return _to_response(agent)


@router.get("", response_model=AgentListResponse)
async def list_agents(
    project_id: str | None = None,
    current_user=Depends(get_current_user),
):
    """List all tracked agents, optionally filtered by project."""
    agents = agent_process_manager.list_agents(project_id=project_id)
    items = [_to_response(a) for a in agents]
    return AgentListResponse(agents=items, total=len(items))


@router.get("/{agent_id}", response_model=AgentStatusResponse)
async def get_agent(
    agent_id: str,
    current_user=Depends(get_current_user),
):
    """Get the current status of an agent."""
    agent = await agent_process_manager.get_agent(agent_id)
    if agent is None:
        raise AppException(
            ErrorCode.AGENT_NOT_FOUND,
            f"Agent not found: {agent_id}",
            {"agent_id": agent_id},
        )
    return _to_response(agent)


@router.get("/{agent_id}/mcp-logs", response_model=MCPLogListResponse)
async def get_agent_mcp_logs(
    agent_id: str,
    limit: int = 50,
    offset: int = 0,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Retrieve persisted MCP request/response history for an agent session.

    Works for both active and stopped agents since logs are persisted
    to the database and survive agent termination.
    """
    # Count total
    count_stmt = (
        select(func.count())
        .select_from(AgentMCPLog)
        .where(AgentMCPLog.agent_process_id == agent_id)
    )
    total_result = await db.execute(count_stmt)
    total = total_result.scalar() or 0

    # Fetch paginated logs
    stmt = (
        select(AgentMCPLog)
        .where(AgentMCPLog.agent_process_id == agent_id)
        .order_by(AgentMCPLog.created_at.asc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(stmt)
    logs = result.scalars().all()

    return MCPLogListResponse(
        items=[MCPLogResponse.model_validate(log) for log in logs],
        total=total,
    )


@router.get("/{agent_id}/events")
async def agent_events(
    agent_id: str,
    current_user=Depends(get_current_user_sse),
):
    """Stream agent tool call events via SSE."""
    agent = await agent_process_manager.get_agent(agent_id)
    if agent is None:
        raise AppException(
            ErrorCode.AGENT_NOT_FOUND,
            f"Agent not found: {agent_id}",
            {"agent_id": agent_id},
        )

    queue = agent_event_bus.subscribe(agent.project_id)

    async def event_stream():
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield f"data: {json.dumps(event)}\n\n"
                except TimeoutError:
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            agent_event_bus.unsubscribe(agent.project_id, queue)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{agent_id}/chat-stream")
async def agent_chat_stream(
    agent_id: str,
    current_user=Depends(get_current_user_sse),
):
    """Stream parsed Claude stream-json events for chat mode.

    Tails the JSONL log file produced by the agent's ``--output-format
    stream-json`` output.  Each line is forwarded as an SSE event.
    """
    from pathlib import Path

    agent = await agent_process_manager.get_agent(agent_id)
    if agent is None:
        raise AppException(
            ErrorCode.AGENT_NOT_FOUND,
            f"Agent not found: {agent_id}",
            {"agent_id": agent_id},
        )

    log_path = agent.chat_log_path
    if not log_path:
        raise AppException(
            ErrorCode.AGENT_INVALID_TYPE,
            "Agent was not launched in chat mode",
            {"agent_id": agent_id},
        )

    async def tail_log():
        """Tail the JSONL file, yielding new lines as SSE events."""
        offset = 0
        stale_count = 0
        try:
            while True:
                p = Path(log_path)
                if p.exists():
                    content = p.read_text()
                    if len(content) > offset:
                        new_data = content[offset:]
                        offset = len(content)
                        stale_count = 0
                        for line in new_data.strip().splitlines():
                            line = line.strip()
                            if line:
                                yield f"data: {line}\n\n"
                    else:
                        stale_count += 1
                else:
                    stale_count += 1

                # Check if agent is still alive
                if stale_count > 60:  # ~30s with no new data
                    alive = agent_process_manager._is_pid_alive(agent.pid)
                    if not alive:
                        yield 'data: {"type":"done"}\n\n'
                        break

                await asyncio.sleep(0.5)
        except asyncio.CancelledError:
            pass

    return StreamingResponse(
        tail_log(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
