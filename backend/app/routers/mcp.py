"""MCP Streamable HTTP endpoint.

POST /mcp  -> JSON-RPC 2.0 request
GET  /mcp  -> SSE stream (server notifications)
DELETE /mcp -> Close session
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

from app.config import settings
from app.core.auth import decode_access_token
from app.core.logging import get_logger
from app.database import async_session_maker
from app.mcp.server import handle_jsonrpc
from app.mcp.session import mcp_session_manager
from app.models.user import User

router = APIRouter(tags=["mcp"])
log = get_logger("mcp.router")

MCP_SESSION_HEADER = "Mcp-Session-Id"


def _get_session_id(request: Request) -> str | None:
    return request.headers.get(MCP_SESSION_HEADER)


async def _authenticate_mcp(request: Request) -> tuple[User, str | None]:
    """Authenticate MCP request via Bearer token.

    Returns (user, project_id). project_id is set for MCP-scoped tokens,
    None for regular access tokens (backward compat).
    """
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization required")
    token = auth[7:]
    try:
        payload = decode_access_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    # Extract MCP-specific claims
    token_type = payload.get("type")
    project_id = payload.get("project_id")

    if token_type == "mcp" and project_id is None:
        raise HTTPException(status_code=401, detail="MCP token missing project_id")

    async with async_session_maker() as db:
        user = await db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return (user, project_id)


@router.post("/mcp")
async def mcp_post(request: Request):
    """Handle JSON-RPC 2.0 requests."""
    user, token_project_id = await _authenticate_mcp(request)
    body = await request.json()
    session_id = _get_session_id(request)

    # Accept header validation (warn only, don't reject)
    accept = request.headers.get("Accept", "")
    if "application/json" not in accept:
        log.warning(
            "MCP client missing application/json in Accept header",
            accept=accept,
        )

    # Origin header validation (warn only for non-browser clients)
    origin = request.headers.get("Origin")
    if origin is not None and not settings.is_allowed_origin(origin):
        log.warning(
            "MCP request from unknown origin",
            origin=origin,
            allowed=settings.cors_origins,
            allowed_regex=settings.cors_origin_regex,
        )

    session = mcp_session_manager.get_session(session_id) if session_id else None

    method = body.get("method", "")

    if method == "initialize":
        # Use project_id from token (not from body params)
        project_id = token_project_id or body.get("params", {}).get("project_id")

        # Extract agent_process_id from token for intelligence propagation
        auth_header = request.headers.get("Authorization", "")
        agent_process_id: str | None = None
        if auth_header.startswith("Bearer "):
            try:
                token_payload = decode_access_token(auth_header[7:])
                agent_process_id = token_payload.get("agent_process_id")
            except Exception:
                pass  # Already authenticated above; this is optional

        new_sid = await mcp_session_manager.create_session(
            user_id=user.id,
            project_id=project_id,
            db_factory=async_session_maker,
            agent_process_id=agent_process_id,
        )
        result = await handle_jsonrpc(
            body,
            session=None,
            create_session_fn=lambda: new_sid,
        )
        # handle_jsonrpc returns None for notifications, but initialize
        # always has an id so this will always be a dict
        response = JSONResponse(content=result)
        response.headers[MCP_SESSION_HEADER] = new_sid
        return response

    # Non-initialize: session required (404 per MCP spec for expired/unknown)
    if session_id and not session:
        raise HTTPException(
            status_code=404, detail="Session not found or expired"
        )
    if not session:
        raise HTTPException(
            status_code=404, detail="Session not found or expired"
        )

    # Project-scoped auth: verify token project matches session
    if token_project_id and session.project_id != token_project_id:
        raise HTTPException(
            status_code=401,
            detail="Token project_id does not match session",
        )

    result = await handle_jsonrpc(body, session=session)

    # None sentinel = notification -> HTTP 202 with no body
    if result is None:
        return Response(status_code=202)

    return JSONResponse(content=result)


@router.get("/mcp")
async def mcp_sse(request: Request):
    """SSE stream for server-initiated notifications."""
    await _authenticate_mcp(request)
    session_id = _get_session_id(request)
    if not session_id:
        raise HTTPException(
            status_code=404, detail="Session not found or expired"
        )

    session = mcp_session_manager.get_session(session_id)
    if not session:
        raise HTTPException(
            status_code=404, detail="Session not found or expired"
        )

    async def event_generator():
        try:
            while True:
                yield ":\n\n"  # Keep-alive comment
                await asyncio.sleep(30)
        except asyncio.CancelledError:
            pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            MCP_SESSION_HEADER: session_id,
        },
    )


@router.delete("/mcp")
async def mcp_delete(request: Request):
    """Close an MCP session."""
    await _authenticate_mcp(request)
    session_id = _get_session_id(request)
    if not session_id:
        raise HTTPException(
            status_code=404, detail="Session not found or expired"
        )

    session = mcp_session_manager.get_session(session_id)
    if not session:
        raise HTTPException(
            status_code=404, detail="Session not found or expired"
        )

    await mcp_session_manager.delete_session(session_id)
    return Response(status_code=200)
