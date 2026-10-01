"""Unit tests for MCP JSON-RPC server handler."""

import json
import pytest
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

from pydantic import BaseModel

from app.mcp.server import (
    SUPPORTED_PROTOCOL_VERSIONS,
    ProtocolError,
    handle_jsonrpc,
)
from app.mcp.session import MCPSession


def _make_db_factory():
    """Create a db_factory mock that works as an async context manager."""
    mock_db = AsyncMock()
    mock_db.add = MagicMock()

    @asynccontextmanager
    async def factory():
        yield mock_db

    return factory


@pytest.fixture
def session():
    return MCPSession(
        id="s1", user_id="u1", project_id="p1", db_factory=_make_db_factory()
    )


# --- Version negotiation ---


@pytest.mark.anyio
async def test_handle_initialize_version_2025():
    """Sending protocolVersion 2025-03-26 should echo it back."""
    result = await handle_jsonrpc(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-03-26",
                "clientInfo": {"name": "test"},
            },
        },
        session=None,
    )
    assert result["result"]["protocolVersion"] == "2025-03-26"
    assert result["result"]["serverInfo"]["name"] == "PwnPilot"


@pytest.mark.anyio
async def test_handle_initialize_version_2024():
    """Sending protocolVersion 2024-11-05 should echo it back."""
    result = await handle_jsonrpc(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "clientInfo": {"name": "test"},
            },
        },
        session=None,
        create_session_fn=lambda: "sid1",
    )
    assert result["result"]["protocolVersion"] == "2024-11-05"


@pytest.mark.anyio
async def test_handle_initialize_unknown_version():
    """Sending unsupported version should return latest supported."""
    result = await handle_jsonrpc(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "9999-99-99",
                "clientInfo": {"name": "test"},
            },
        },
        session=None,
    )
    assert result["result"]["protocolVersion"] == SUPPORTED_PROTOCOL_VERSIONS[0]
    assert result["result"]["protocolVersion"] == "2025-03-26"


# --- Notification handling ---


@pytest.mark.anyio
async def test_handle_notification_initialized():
    """notifications/initialized (no id) should return None sentinel."""
    result = await handle_jsonrpc(
        {"jsonrpc": "2.0", "method": "notifications/initialized"}
    )
    assert result is None


@pytest.mark.anyio
async def test_handle_notification_cancelled():
    """Other notifications (no id) should also return None."""
    result = await handle_jsonrpc(
        {"jsonrpc": "2.0", "method": "notifications/cancelled"}
    )
    assert result is None


@pytest.mark.anyio
async def test_message_without_id_returns_none():
    """Any message without id returns None (even non-notification)."""
    result = await handle_jsonrpc(
        {"jsonrpc": "2.0", "method": "tools/list"}
    )
    assert result is None


# --- Tool call dual error handling ---


@pytest.mark.anyio
async def test_handle_tools_call_unknown_tool(session):
    """Unknown tool name should return JSON-RPC error -32602."""
    with patch("app.mcp.server.get_tool", return_value=None):
        result = await handle_jsonrpc(
            {
                "jsonrpc": "2.0",
                "id": 10,
                "method": "tools/call",
                "params": {"name": "nonexistent_tool", "arguments": {}},
            },
            session=session,
        )
    assert "error" in result
    assert result["error"]["code"] == -32602
    assert "nonexistent_tool" in result["error"]["message"]


@pytest.mark.anyio
async def test_handle_tools_call_invalid_args(session):
    """Invalid args should return isError:true in result (not protocol error)."""

    class StrictParams(BaseModel):
        required_field: str

    mock_tool = MagicMock()
    mock_tool.params_model = StrictParams

    with patch("app.mcp.server.get_tool", return_value=mock_tool):
        result = await handle_jsonrpc(
            {
                "jsonrpc": "2.0",
                "id": 11,
                "method": "tools/call",
                "params": {"name": "test_tool", "arguments": {}},
            },
            session=session,
        )
    # Should be a success response with isError in the result
    assert "result" in result
    assert result["result"]["isError"] is True
    assert "Invalid arguments" in result["result"]["content"][0]["text"]


@pytest.mark.anyio
async def test_handle_tools_call_success_has_isError_false(session):
    """Successful tool call should have isError:false in result."""

    class EmptyParams(BaseModel):
        pass

    mock_tool = MagicMock()
    mock_tool.params_model = EmptyParams

    with (
        patch("app.mcp.server.get_tool", return_value=mock_tool),
        patch(
            "app.mcp.server.execute_tool",
            new_callable=AsyncMock,
            return_value={"status": "ok"},
        ),
    ):
        result = await handle_jsonrpc(
            {
                "jsonrpc": "2.0",
                "id": 12,
                "method": "tools/call",
                "params": {"name": "test_tool", "arguments": {}},
            },
            session=session,
        )
    assert "result" in result
    assert result["result"]["isError"] is False
    assert "status" in result["result"]["content"][0]["text"]


@pytest.mark.anyio
async def test_handle_tools_call_skips_manual_command_record_when_shell_hook_recorded(session):
    class TerminalParams(BaseModel):
        command: str
        session_id: str

    mock_tool = MagicMock()
    mock_tool.params_model = TerminalParams

    with (
        patch("app.mcp.server.get_tool", return_value=mock_tool),
        patch(
            "app.mcp.server.execute_tool",
            new_callable=AsyncMock,
            return_value={
                "session_id": "term-1",
                "command": "whoami",
                "output": "user",
                "_history_recorded_by_shell_hook": True,
            },
        ),
        patch("app.mcp.server.record_agent_command", new_callable=AsyncMock) as mock_record,
        patch("app.mcp.server.process_intelligence", new_callable=AsyncMock),
    ):
        result = await handle_jsonrpc(
            {
                "jsonrpc": "2.0",
                "id": 12,
                "method": "tools/call",
                "params": {
                    "name": "terminal_run_command",
                    "arguments": {"command": "whoami", "session_id": "term-1"},
                },
            },
            session=session,
        )

    assert "result" in result
    assert result["result"]["isError"] is False
    payload = json.loads(result["result"]["content"][0]["text"])
    assert payload == {
        "session_id": "term-1",
        "command": "whoami",
        "output": "user",
    }
    mock_record.assert_not_awaited()


@pytest.mark.anyio
async def test_handle_tools_call_runtime_error(session):
    """Runtime error during tool execution returns isError:true."""

    class EmptyParams(BaseModel):
        pass

    mock_tool = MagicMock()
    mock_tool.params_model = EmptyParams

    with (
        patch("app.mcp.server.get_tool", return_value=mock_tool),
        patch(
            "app.mcp.server.execute_tool",
            new_callable=AsyncMock,
            side_effect=RuntimeError("connection refused"),
        ),
    ):
        result = await handle_jsonrpc(
            {
                "jsonrpc": "2.0",
                "id": 13,
                "method": "tools/call",
                "params": {"name": "test_tool", "arguments": {}},
            },
            session=session,
        )
    assert "result" in result
    assert result["result"]["isError"] is True
    assert "connection refused" in result["result"]["content"][0]["text"]


# --- Existing tests ---


@pytest.mark.anyio
async def test_handle_tools_list(session):
    with patch("app.mcp.server.get_all_tools", return_value=[]):
        result = await handle_jsonrpc(
            {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/list",
            },
            session=session,
        )
    assert "result" in result
    assert "tools" in result["result"]
    assert result["result"]["tools"] == []


@pytest.mark.anyio
async def test_handle_unknown_method(session):
    result = await handle_jsonrpc(
        {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "unknown/method",
        },
        session=session,
    )
    assert "error" in result
    assert result["error"]["code"] == -32601


@pytest.mark.anyio
async def test_handle_ping(session):
    result = await handle_jsonrpc(
        {
            "jsonrpc": "2.0",
            "id": 4,
            "method": "ping",
        },
        session=session,
    )
    assert result["result"] == {}
    assert result["id"] == 4


@pytest.mark.anyio
async def test_handle_resources_list(session):
    result = await handle_jsonrpc(
        {
            "jsonrpc": "2.0",
            "id": 5,
            "method": "resources/list",
        },
        session=session,
    )
    assert "result" in result
    resources = result["result"]["resources"]
    assert len(resources) == 2
    uris = [r["uri"] for r in resources]
    assert "pwnpilot://project/current" in uris
    assert "pwnpilot://project/context" in uris


@pytest.mark.anyio
async def test_session_required_for_non_initialize():
    """Request with id but no session returns -32600 (not None)."""
    result = await handle_jsonrpc(
        {
            "jsonrpc": "2.0",
            "id": 6,
            "method": "tools/list",
        },
        session=None,
    )
    assert "error" in result
    assert result["error"]["code"] == -32600
    assert "Session required" in result["error"]["message"]
