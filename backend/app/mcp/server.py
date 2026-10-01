"""MCP JSON-RPC 2.0 handler."""
from __future__ import annotations

import json
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from pydantic import ValidationError

from app.core.logging import get_logger
from app.mcp.hooks import process_intelligence, record_agent_command, truncate_result
from app.mcp.session import MCPSession
from app.services.agent.event_bus import agent_event_bus
from app.tools.registry import ToolContext, execute_tool, get_all_tools, get_tool

log = get_logger("mcp.server")

SUPPORTED_PROTOCOL_VERSIONS = ["2025-03-26", "2024-11-05"]
SERVER_INFO = {
    "name": "PwnPilot",
    "version": "1.0.0",
}
SERVER_CAPABILITIES = {
    "tools": {"listChanged": False},
    "resources": {"subscribe": False, "listChanged": False},
}


class ProtocolError(Exception):
    """JSON-RPC protocol-level error (returns error object, not isError)."""

    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


async def handle_jsonrpc(
    request: dict,
    session: MCPSession | None = None,
    create_session_fn: Callable | None = None,
) -> dict | None:
    """Process a single JSON-RPC 2.0 request.

    Returns a JSON-RPC response dict for requests, or None for notifications.
    The None return is the definitive sentinel that the router uses to detect
    notifications and respond with HTTP 202.
    """
    req_id = request.get("id")
    method = request.get("method", "")
    params = request.get("params", {})

    # Notifications have no "id" field -- return None sentinel
    if req_id is None:
        if method.startswith("notifications/"):
            log.info("MCP notification received", method=method)
        else:
            log.warning("MCP message without id", method=method)
        return None

    try:
        if method == "initialize":
            return _success(
                req_id, await _handle_initialize(params, create_session_fn)
            )

        # All other methods require a session
        if session is None:
            return _error(req_id, -32600, "Session required. Send initialize first.")

        if method == "tools/list":
            return _success(req_id, _handle_tools_list())
        elif method == "tools/call":
            result = await _handle_tools_call(params, session)
            return _success(req_id, result)
        elif method == "resources/list":
            return _success(req_id, _handle_resources_list())
        elif method == "resources/read":
            result = await _handle_resources_read(params, session)
            return _success(req_id, result)
        elif method == "ping":
            return _success(req_id, {})
        else:
            return _error(req_id, -32601, f"Method not found: {method}")

    except ProtocolError as e:
        log.error("JSON-RPC protocol error", method=method, code=e.code, error=e.message)
        return _error(req_id, e.code, e.message)
    except Exception as e:
        log.error("JSON-RPC internal error", method=method, error=str(e))
        return _error(req_id, -32603, str(e))


async def _handle_initialize(
    params: dict, create_session_fn: Callable | None
) -> dict:
    """Handle initialize with protocol version negotiation."""
    client_version = params.get("protocolVersion", "")
    if client_version in SUPPORTED_PROTOCOL_VERSIONS:
        negotiated_version = client_version
    else:
        negotiated_version = SUPPORTED_PROTOCOL_VERSIONS[0]

    return {
        "protocolVersion": negotiated_version,
        "capabilities": SERVER_CAPABILITIES,
        "serverInfo": SERVER_INFO,
    }


def _handle_tools_list() -> dict:
    tools = get_all_tools()
    return {
        "tools": [
            {
                "name": t.name,
                "description": t.description,
                "inputSchema": t.params_model.model_json_schema(),
            }
            for t in tools
        ]
    }


async def _handle_tools_call(params: dict, session: MCPSession) -> dict:
    """Handle tools/call: execute tool, record agent commands, broadcast events."""
    name = params.get("name", "")
    arguments = params.get("arguments", {})

    # Protocol error: unknown tool
    tool_def = get_tool(name)
    if tool_def is None:
        raise ProtocolError(-32602, f"Unknown tool: {name}")

    # Validate arguments -- tool execution error, not protocol error
    try:
        tool_def.params_model.model_validate(arguments)
    except ValidationError as e:
        return {
            "content": [{"type": "text", "text": f"Invalid arguments: {e}"}],
            "isError": True,
        }

    # Execute tool with timing
    start = time.monotonic()
    try:
        async with session.db_factory() as db:
            ctx = ToolContext(
                db=db,
                user_id=session.user_id,
                project_id=session.project_id,
            )
            result = await execute_tool(name, arguments, ctx)
            duration_ms = int((time.monotonic() - start) * 1000)
            history_recorded_by_shell_hook = False
            if isinstance(result, dict):
                history_recorded_by_shell_hook = bool(
                    result.pop("_history_recorded_by_shell_hook", False)
                )

            # Record terminal commands to history with agent source
            if name == "terminal_run_command" and session.project_id and not history_recorded_by_shell_hook:
                await record_agent_command(
                    db=db,
                    project_id=session.project_id,
                    user_id=session.user_id,
                    command=arguments.get("command", ""),
                    output=result.get("output"),
                    session_id=arguments.get("session_id", ""),
                    duration_ms=duration_ms,
                )

            # Intelligence: auto-timeline, auto-KB scan notes, MCP log
            if session.project_id:
                await process_intelligence(
                    db=db,
                    tool_name=name,
                    args=arguments,
                    result=result,
                    duration_ms=duration_ms,
                    success=True,
                    project_id=session.project_id,
                    user_id=session.user_id,
                    mcp_session_id=session.id,
                    agent_process_id=session.agent_process_id,
                )

        # Broadcast tool call event for ALL tools
        if session.project_id:
            agent_event_bus.publish(session.project_id, {
                "type": "tool_call",
                "name": name,
                "args": arguments,
                "result_preview": truncate_result(result, 200),
                "duration_ms": duration_ms,
                "success": True,
                "timestamp": datetime.now(UTC).isoformat(),
            })

        return {
            "content": [
                {"type": "text", "text": json.dumps(result, default=str)}
            ],
            "isError": False,
        }
    except Exception as e:
        duration_ms = int((time.monotonic() - start) * 1000)
        log.error("Tool execution failed", tool=name, error=str(e))

        # Intelligence: log failed tool call
        if session.project_id and session.db_factory:
            try:
                async with session.db_factory() as err_db:
                    await process_intelligence(
                        db=err_db,
                        tool_name=name,
                        args=arguments,
                        result=str(e),
                        duration_ms=duration_ms,
                        success=False,
                        project_id=session.project_id,
                        user_id=session.user_id,
                        mcp_session_id=session.id,
                        agent_process_id=session.agent_process_id,
                    )
            except Exception:
                pass  # Never block tool error response

        # Broadcast failure event
        if session.project_id:
            agent_event_bus.publish(session.project_id, {
                "type": "tool_call",
                "name": name,
                "args": arguments,
                "error": str(e),
                "duration_ms": duration_ms,
                "success": False,
                "timestamp": datetime.now(UTC).isoformat(),
            })

        return {
            "content": [
                {"type": "text", "text": f"Tool execution failed: {e}"}
            ],
            "isError": True,
        }


def _handle_resources_list() -> dict:
    return {
        "resources": [
            {
                "uri": "pwnpilot://project/current",
                "name": "Current Project",
                "description": "Active project metadata",
                "mimeType": "application/json",
            },
            {
                "uri": "pwnpilot://project/context",
                "name": "Project Context",
                "description": "Full project context for AI",
                "mimeType": "text/markdown",
            },
        ]
    }


async def _handle_resources_read(params: dict, session: MCPSession) -> dict:
    uri = params.get("uri", "")

    try:
        async with session.db_factory() as db:
            if uri == "pwnpilot://project/current":
                from app.models.project import Project

                project = await db.get(Project, session.project_id)
                if not project:
                    return {"contents": [{"uri": uri, "text": "No project found"}]}
                data = {
                    "id": project.id,
                    "name": project.name,
                    "type": project.type,
                    "status": project.status,
                    "variables": project.variables or {},
                }
                return {
                    "contents": [
                        {
                            "uri": uri,
                            "text": json.dumps(data),
                            "mimeType": "application/json",
                        }
                    ]
                }

            elif uri == "pwnpilot://project/context":
                from app.services.context_builder import ContextBuilder

                builder = ContextBuilder(db)
                context = await builder.build(
                    project_id=session.project_id, preset="full"
                )
                return {
                    "contents": [
                        {"uri": uri, "text": context, "mimeType": "text/markdown"}
                    ]
                }

        return {
            "contents": [
                {"uri": uri, "text": f"Unknown resource: {uri}"}
            ],
            "isError": True,
        }
    except Exception as e:
        log.error("Resource read failed", uri=uri, error=str(e))
        return {
            "contents": [
                {"uri": uri, "text": f"Resource read failed: {e}"}
            ],
            "isError": True,
        }


def _success(req_id: Any, result: dict) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _error(req_id: Any, code: int, message: str) -> dict:
    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "error": {"code": code, "message": message},
    }
