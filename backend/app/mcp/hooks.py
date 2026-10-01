"""MCP tool call hooks -- command recording and event broadcasting."""
from __future__ import annotations

import json
from typing import Any

from app.core.logging import get_logger
from app.services.report_signal_service import report_signal_service

log = get_logger("mcp.hooks")


async def record_agent_command(
    db: Any,
    project_id: str,
    user_id: str,
    command: str,
    output: str | None,
    session_id: str,
    duration_ms: int,
) -> None:
    """Record an agent-executed terminal command to command_history.

    Wrapped in try/except so DB failures never block tool execution.
    """
    from app.models.command_history import CommandHistory

    try:
        record = CommandHistory(
            project_id=project_id,
            session_id=session_id,
            command=command,
            output=output,
            output_preview=output[:200] if output else None,
            exit_code=0,
            cwd="/",
            duration_ms=duration_ms,
            executed_by=user_id,
            source="agent",
        )
        db.add(record)
        await db.flush()
        if record.id:
            report_signal_service.record_signal(
                project_id=project_id,
                signal_type="agent_command",
                source_id=record.id,
            )
    except Exception:
        log.warning(
            "Failed to record agent command",
            command=command[:80],
            project_id=project_id,
        )


async def process_intelligence(
    db: Any,
    tool_name: str,
    args: dict[str, Any],
    result: Any,
    duration_ms: int,
    success: bool,
    project_id: str,
    user_id: str,
    mcp_session_id: str,
    agent_process_id: str | None = None,
) -> None:
    """Delegate tool call to AgentIntelligenceService for logging and analysis.

    Fire-and-forget: exceptions are logged but never propagate to block
    tool execution.
    """
    try:
        from app.services.agent.intelligence import AgentIntelligenceService

        svc = AgentIntelligenceService(db)
        await svc.process_tool_call(
            tool_name=tool_name,
            args=args,
            result=result,
            duration_ms=duration_ms,
            success=success,
            project_id=project_id,
            user_id=user_id,
            mcp_session_id=mcp_session_id,
            agent_process_id=agent_process_id,
        )
    except Exception:
        log.warning(
            "Intelligence processing failed",
            tool_name=tool_name,
            project_id=project_id,
        )


def truncate_result(result: Any, max_len: int) -> str | None:
    """Convert tool result to a truncated string preview."""
    if result is None:
        return None
    text = json.dumps(result, default=str)
    if len(text) <= max_len:
        return text
    return text[:max_len] + "..."
