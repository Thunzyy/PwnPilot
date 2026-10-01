"""Integration tests for MCP router -- full handshake, session lifecycle, auth."""

import uuid

import pytest
from httpx import AsyncClient

from app.core.auth import create_mcp_token, decode_access_token


MCP_URL = "/mcp"
MCP_SESSION_HEADER = "Mcp-Session-Id"


def _jsonrpc(method: str, params: dict | None = None, req_id: int = 1) -> dict:
    """Build a JSON-RPC 2.0 request."""
    msg: dict = {"jsonrpc": "2.0", "id": req_id, "method": method}
    if params is not None:
        msg["params"] = params
    return msg


def _notification(method: str) -> dict:
    """Build a JSON-RPC 2.0 notification (no id)."""
    return {"jsonrpc": "2.0", "method": method}


# --- Fixtures ---
# Note: _patch_mcp_session_maker is in conftest.py (autouse)


@pytest.fixture
async def user_data(client: AsyncClient):
    """Create a test user and return (user_id, auth_headers)."""
    suffix = uuid.uuid4().hex[:8]
    payload = {
        "username": f"mcp_user_{suffix}",
        "email": f"mcp_user_{suffix}@example.com",
        "password": "testpass123",
    }
    await client.post("/api/v1/auth/signup", json=payload)
    login = await client.post(
        "/api/v1/auth/login",
        json={
            "username_or_email": payload["username"],
            "password": payload["password"],
        },
    )
    data = login.json()
    token = data["access_token"]
    # Decode JWT to extract user_id (login response has no user object)
    jwt_payload = decode_access_token(token)
    user_id = jwt_payload["sub"]
    headers = {"Authorization": f"Bearer {token}"}
    return user_id, headers


@pytest.fixture
async def project_id(client: AsyncClient, user_data):
    """Create a test project and return its ID."""
    _, headers = user_data
    resp = await client.post(
        "/api/v1/projects",
        json={"name": f"MCP Test {uuid.uuid4().hex[:6]}", "type": "htb"},
        headers=headers,
    )
    assert resp.status_code == 201, f"Project creation failed: {resp.text}"
    return resp.json()["id"]


@pytest.fixture
async def mcp_headers(user_data, project_id):
    """Get MCP auth headers with project-scoped token."""
    user_id, _ = user_data
    token = create_mcp_token(user_id, project_id)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def session_id(client: AsyncClient, mcp_headers):
    """Initialize an MCP session and return the session ID."""
    resp = await client.post(
        MCP_URL,
        json=_jsonrpc(
            "initialize",
            {"protocolVersion": "2025-03-26", "clientInfo": {"name": "test"}},
        ),
        headers=mcp_headers,
    )
    assert resp.status_code == 200, f"Initialize failed: {resp.text}"
    sid = resp.headers.get(MCP_SESSION_HEADER)
    assert sid is not None
    return sid


# --- Full handshake ---


@pytest.mark.anyio
async def test_full_handshake(client: AsyncClient, mcp_headers):
    """POST initialize -> notification -> tools/list is full MCP handshake."""
    # 1. Initialize
    resp = await client.post(
        MCP_URL,
        json=_jsonrpc(
            "initialize",
            {"protocolVersion": "2025-03-26", "clientInfo": {"name": "test"}},
        ),
        headers=mcp_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["result"]["protocolVersion"] == "2025-03-26"
    sid = resp.headers[MCP_SESSION_HEADER]
    assert sid

    # 2. notifications/initialized -> 202
    resp = await client.post(
        MCP_URL,
        json=_notification("notifications/initialized"),
        headers={**mcp_headers, MCP_SESSION_HEADER: sid},
    )
    assert resp.status_code == 202

    # 3. tools/list -> 200 with tools array
    resp = await client.post(
        MCP_URL,
        json=_jsonrpc("tools/list", req_id=2),
        headers={**mcp_headers, MCP_SESSION_HEADER: sid},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "result" in body
    assert "tools" in body["result"]
    assert isinstance(body["result"]["tools"], list)


# --- Session lifecycle ---


@pytest.mark.anyio
async def test_expired_session_returns_404(client: AsyncClient, mcp_headers):
    """Non-initialize request with unknown session ID returns 404."""
    resp = await client.post(
        MCP_URL,
        json=_jsonrpc("tools/list"),
        headers={
            **mcp_headers,
            MCP_SESSION_HEADER: "nonexistent-" + uuid.uuid4().hex,
        },
    )
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_missing_session_id_on_non_initialize_returns_404(
    client: AsyncClient, mcp_headers
):
    """Non-initialize request without Mcp-Session-Id returns 404."""
    resp = await client.post(
        MCP_URL,
        json=_jsonrpc("tools/list"),
        headers=mcp_headers,
    )
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_delete_session(client: AsyncClient, mcp_headers, session_id):
    """DELETE /mcp closes the session; subsequent use returns 404."""
    # Delete session
    resp = await client.delete(
        MCP_URL,
        headers={**mcp_headers, MCP_SESSION_HEADER: session_id},
    )
    assert resp.status_code == 200

    # Subsequent request should 404
    resp = await client.post(
        MCP_URL,
        json=_jsonrpc("tools/list"),
        headers={**mcp_headers, MCP_SESSION_HEADER: session_id},
    )
    assert resp.status_code == 404


# --- Project-scoped auth ---


@pytest.mark.anyio
async def test_project_scoped_token(
    client: AsyncClient, user_data, project_id
):
    """MCP token scoped to project-A cannot access session from project-B."""
    user_id, _ = user_data

    # Create token for project_id and initialize session
    token_a = create_mcp_token(user_id, project_id)
    headers_a = {"Authorization": f"Bearer {token_a}"}

    resp = await client.post(
        MCP_URL,
        json=_jsonrpc(
            "initialize",
            {"protocolVersion": "2025-03-26", "clientInfo": {"name": "test"}},
        ),
        headers=headers_a,
    )
    assert resp.status_code == 200
    sid = resp.headers[MCP_SESSION_HEADER]

    # Access with same token works
    resp = await client.post(
        MCP_URL,
        json=_jsonrpc("tools/list", req_id=2),
        headers={**headers_a, MCP_SESSION_HEADER: sid},
    )
    assert resp.status_code == 200

    # Create token for different project
    other_project_id = str(uuid.uuid4())
    token_b = create_mcp_token(user_id, other_project_id)
    headers_b = {"Authorization": f"Bearer {token_b}"}

    # Access with project-B token should fail with 401
    resp = await client.post(
        MCP_URL,
        json=_jsonrpc("tools/list", req_id=3),
        headers={**headers_b, MCP_SESSION_HEADER: sid},
    )
    assert resp.status_code == 401
    assert "project_id" in resp.json()["detail"].lower()


@pytest.mark.anyio
async def test_regular_token_still_works(client: AsyncClient, user_data):
    """Standard access token (no type=mcp) works for MCP -- backward compat."""
    _, headers = user_data

    # Initialize with regular token
    resp = await client.post(
        MCP_URL,
        json=_jsonrpc(
            "initialize",
            {"protocolVersion": "2025-03-26", "clientInfo": {"name": "test"}},
        ),
        headers=headers,
    )
    assert resp.status_code == 200
    sid = resp.headers[MCP_SESSION_HEADER]

    # tools/list works too
    resp = await client.post(
        MCP_URL,
        json=_jsonrpc("tools/list", req_id=2),
        headers={**headers, MCP_SESSION_HEADER: sid},
    )
    assert resp.status_code == 200


# --- Tool error response format ---


@pytest.mark.anyio
async def test_tool_error_returns_protocol_error(
    client: AsyncClient, mcp_headers, session_id
):
    """tools/call with unknown tool returns JSON-RPC error -32602."""
    resp = await client.post(
        MCP_URL,
        json=_jsonrpc(
            "tools/call",
            {"name": "nonexistent_tool_xyz", "arguments": {}},
            req_id=10,
        ),
        headers={**mcp_headers, MCP_SESSION_HEADER: session_id},
    )
    assert resp.status_code == 200  # HTTP 200, error is in JSON-RPC body
    body = resp.json()
    assert "error" in body
    assert body["error"]["code"] == -32602
    assert "nonexistent_tool_xyz" in body["error"]["message"]
