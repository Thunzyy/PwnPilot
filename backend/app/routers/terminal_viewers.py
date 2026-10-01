"""
Terminal Viewers Router - ACL management for terminal sessions
"""

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.services.console_provider import ConsoleProvider
from app.services.provider_factory import get_provider

router = APIRouter(prefix="/terminal/sessions/{session_id}", tags=["terminal-viewers"])

# In-memory viewer store (production should use DB)
_viewers: dict[str, dict[str, dict[str, Any]]] = {}  # session_id -> {viewer_id -> viewer_data}
_event_subscribers: dict[str, list[WebSocket]] = {}  # session_id -> [websocket]


class JoinRequest(BaseModel):
    token: str


class JoinResponse(BaseModel):
    viewer_id: str
    role: str
    websocket_url: str


class ViewerResponse(BaseModel):
    id: str
    role: str
    connected_at: str


class RoleChangeRequest(BaseModel):
    role: str


async def _broadcast_viewers(session_id: str) -> None:
    """Broadcast viewer list to all subscribers"""
    if session_id not in _event_subscribers:
        return

    viewers = list(_viewers.get(session_id, {}).values())
    message = {
        "type": "viewers",
        "viewers": [
            {"id": v["id"], "role": v["role"], "connected_at": v["connected_at"]}
            for v in viewers
        ],
    }

    dead_sockets = []
    for ws in _event_subscribers[session_id]:
        try:
            await ws.send_json(message)
        except Exception:
            dead_sockets.append(ws)

    for ws in dead_sockets:
        _event_subscribers[session_id].remove(ws)


@router.post("/viewers", response_model=JoinResponse)
async def join_session(
    session_id: str,
    data: JoinRequest,
    provider: ConsoleProvider = Depends(get_provider),
):
    """Join a terminal session with a token"""
    session = await provider.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Determine role based on token
    if data.token == session.master_token:
        # Check if master already exists
        existing_viewers = _viewers.get(session_id, {})
        has_master = any(v["role"] == "master" for v in existing_viewers.values())
        role = "controller" if has_master else "master"
    elif data.token == session.viewer_token:
        role = "viewer"
    else:
        raise HTTPException(status_code=403, detail="Invalid token")

    # Create viewer entry
    viewer_id = str(uuid4())
    if session_id not in _viewers:
        _viewers[session_id] = {}

    _viewers[session_id][viewer_id] = {
        "id": viewer_id,
        "role": role,
        "connected_at": datetime.now(UTC).isoformat(),
    }

    await _broadcast_viewers(session_id)

    return JoinResponse(
        viewer_id=viewer_id,
        role=role,
        websocket_url=session.websocket_url,
    )


@router.get("/viewers", response_model=list[ViewerResponse])
async def list_viewers(session_id: str):
    """List all connected viewers"""
    viewers = _viewers.get(session_id, {})
    return [
        ViewerResponse(
            id=v["id"],
            role=v["role"],
            connected_at=v["connected_at"],
        )
        for v in viewers.values()
    ]


@router.put("/viewers/{viewer_id}/role")
async def change_viewer_role(
    session_id: str,
    viewer_id: str,
    data: RoleChangeRequest,
):
    """Change a viewer's role"""
    if session_id not in _viewers or viewer_id not in _viewers[session_id]:
        raise HTTPException(status_code=404, detail="Viewer not found")

    if data.role not in ["master", "controller", "viewer"]:
        raise HTTPException(status_code=400, detail="Invalid role")

    _viewers[session_id][viewer_id]["role"] = data.role
    await _broadcast_viewers(session_id)

    return {"status": "ok"}


@router.delete("/viewers/{viewer_id}")
async def remove_viewer(session_id: str, viewer_id: str):
    """Remove a viewer from session"""
    if session_id not in _viewers or viewer_id not in _viewers[session_id]:
        raise HTTPException(status_code=404, detail="Viewer not found")

    del _viewers[session_id][viewer_id]
    await _broadcast_viewers(session_id)

    return {"status": "ok"}


@router.websocket("/events")
async def session_events(websocket: WebSocket, session_id: str):
    """WebSocket for real-time viewer updates"""
    await websocket.accept()

    if session_id not in _event_subscribers:
        _event_subscribers[session_id] = []
    _event_subscribers[session_id].append(websocket)

    # Send initial viewer list
    await _broadcast_viewers(session_id)

    try:
        while True:
            await websocket.receive_text()  # Keep connection alive
    except WebSocketDisconnect:
        if websocket in _event_subscribers.get(session_id, []):
            _event_subscribers[session_id].remove(websocket)
