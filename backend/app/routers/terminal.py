"""
Terminal Router - REST API and WebSocket endpoints for terminal sessions
"""

import asyncio
import os
import shutil
import subprocess

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_project_member
from app.core.errors import ErrorCode
from app.core.exceptions import AppException
from app.database import get_db
from app.models.project import Project
from app.models.terminal_session import TerminalSessionDB
from app.services.console_provider import ConsoleProvider, TerminalCapabilities
from app.services.provider_factory import get_provider
from app.services.terminal_manager import terminal_manager

router = APIRouter(prefix="/terminal", tags=["terminal"])


class SessionCreate(BaseModel):
    name: str = "Terminal"
    project_id: str | None = None
    cols: int = 120
    rows: int = 30


class SessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    project_id: str | None
    websocket_url: str
    master_token: str
    viewer_token: str
    is_alive: bool
    created_at: str

class TerminalCapabilitiesResponse(BaseModel):
    provider: str
    platform: str
    can_create_session: bool
    can_detach: bool
    websocket_mode: str
    reason_unavailable: str | None = None


class DetachRequest(BaseModel):
    terminal: str = "auto"  # "auto", "gnome-terminal", "konsole", "xterm", "kitty", "alacritty"


class RenameRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


def _serialize_capabilities(capabilities: TerminalCapabilities) -> TerminalCapabilitiesResponse:
    return TerminalCapabilitiesResponse(
        provider=capabilities.provider,
        platform=capabilities.platform,
        can_create_session=capabilities.can_create_session,
        can_detach=capabilities.can_detach,
        websocket_mode=capabilities.websocket_mode,
        reason_unavailable=capabilities.reason_unavailable,
    )


@router.get("/capabilities", response_model=TerminalCapabilitiesResponse)
async def get_terminal_capabilities(
    provider: ConsoleProvider = Depends(get_provider),
    current_user=Depends(get_current_user),
):
    return _serialize_capabilities(provider.get_capabilities())


@router.post("/sessions", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def create_session(
    data: SessionCreate,
    provider: ConsoleProvider = Depends(get_provider),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    capabilities = provider.get_capabilities()
    if not capabilities.can_create_session:
        raise AppException(
            ErrorCode.GENERIC_BAD_REQUEST,
            capabilities.reason_unavailable or "Terminal sessions are unavailable",
        )

    workspace_path: str | None = None
    if data.project_id:
        await require_project_member(data.project_id, current_user, db)
        result = await db.execute(select(Project).where(Project.id == data.project_id))
        project = result.scalar_one_or_none()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        workspace_path = project.workspace_path

    session = await provider.create_session(
        name=data.name,
        project_id=data.project_id,
        cols=data.cols,
        rows=data.rows,
        workspace_path=workspace_path,
        user_id=current_user.id,
    )

    # Persist session to DB for command history lookups
    db_session = TerminalSessionDB(
        id=session.id,
        project_id=session.project_id,
        name=session.name,
        master_token=session.master_token,
        viewer_token=session.viewer_token,
        is_alive=True,
    )
    db.add(db_session)
    await db.commit()

    return SessionResponse(
        id=session.id,
        name=session.name,
        project_id=session.project_id,
        websocket_url=session.websocket_url,
        master_token=session.master_token,
        viewer_token=session.viewer_token,
        is_alive=session.is_alive,
        created_at=session.created_at.isoformat(),
    )


@router.get("/sessions", response_model=list[SessionResponse])
async def list_sessions(
    project_id: str | None = None,
    provider: ConsoleProvider = Depends(get_provider),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if project_id:
        await require_project_member(project_id, current_user, db)
    sessions = provider.list_sessions(project_id)
    return [
        SessionResponse(
            id=s.id,
            name=s.name,
            project_id=s.project_id,
            websocket_url=s.websocket_url,
            master_token=s.master_token,
            viewer_token=s.viewer_token,
            is_alive=s.is_alive,
            created_at=s.created_at.isoformat(),
        )
        for s in sessions
    ]


@router.get("/sessions/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: str,
    provider: ConsoleProvider = Depends(get_provider),
    current_user=Depends(get_current_user),
):
    session = await provider.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return SessionResponse(
        id=session.id,
        name=session.name,
        project_id=session.project_id,
        websocket_url=session.websocket_url,
        master_token=session.master_token,
        viewer_token=session.viewer_token,
        is_alive=session.is_alive,
        created_at=session.created_at.isoformat(),
    )


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    provider: ConsoleProvider = Depends(get_provider),
    current_user=Depends(get_current_user),
):
    success = await provider.destroy_session(session_id)
    if not success:
        recovered = False
        if provider.get_capabilities().provider == "tmux_ttyd":
            if await _tmux_session_exists(session_id):
                recovered = await _kill_tmux_session(session_id)
        if not recovered:
            raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "ok"}


@router.patch("/sessions/{session_id}", response_model=SessionResponse)
async def rename_session(
    session_id: str,
    data: RenameRequest,
    provider: ConsoleProvider = Depends(get_provider),
    current_user=Depends(get_current_user),
):
    session = await provider.rename_session(session_id, data.name)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return SessionResponse(
        id=session.id,
        name=session.name,
        project_id=session.project_id,
        websocket_url=session.websocket_url,
        master_token=session.master_token,
        viewer_token=session.viewer_token,
        is_alive=session.is_alive,
        created_at=session.created_at.isoformat(),
    )


@router.put("/sessions/{session_id}/resize")
async def resize_session(
    session_id: str,
    cols: int,
    rows: int,
    provider: ConsoleProvider = Depends(get_provider),
    current_user=Depends(get_current_user),
):
    success = await provider.resize(session_id, cols, rows)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to resize session")
    return {"status": "ok"}


@router.post("/sessions/{session_id}/detach")
async def detach_session(
    session_id: str,
    data: DetachRequest = DetachRequest(),
    provider: ConsoleProvider = Depends(get_provider),
    current_user=Depends(get_current_user),
):
    """
    Detach a session to a native terminal emulator.
    Opens a new terminal window attached to the tmux session.
    """
    capabilities = provider.get_capabilities()
    if not capabilities.can_detach:
        raise HTTPException(
            status_code=400,
            detail=capabilities.reason_unavailable or "Detach is not supported by this provider",
        )

    session = await provider.get_session(session_id)
    session_exists = session is not None
    if not session and capabilities.provider == "tmux_ttyd":
        session_exists = await _tmux_session_exists(session_id)
    if not session_exists:
        raise HTTPException(status_code=404, detail="Session not found")

    if session and not session.is_alive:
        tmux_alive = False
        if capabilities.provider == "tmux_ttyd":
            tmux_alive = await _tmux_session_exists(session_id)
        if not tmux_alive:
            raise HTTPException(status_code=400, detail="Session is not alive")

    # Detect available terminal emulator
    terminals = {
        "gnome-terminal": ["gnome-terminal", "--", "tmux", "attach", "-t", session_id],
        "konsole": ["konsole", "-e", "tmux", "attach", "-t", session_id],
        "xterm": ["xterm", "-e", "tmux", "attach", "-t", session_id],
        "kitty": ["kitty", "tmux", "attach", "-t", session_id],
        "alacritty": ["alacritty", "-e", "tmux", "attach", "-t", session_id],
        "xfce4-terminal": ["xfce4-terminal", "-e", f"tmux attach -t {session_id}"],
    }

    terminal_cmd = None

    if data.terminal == "auto":
        # Try to detect available terminal
        for term_name, cmd in terminals.items():
            if shutil.which(cmd[0]):
                terminal_cmd = cmd
                break
    elif data.terminal in terminals:
        if shutil.which(terminals[data.terminal][0]):
            terminal_cmd = terminals[data.terminal]

    if not terminal_cmd:
        raise HTTPException(
            status_code=400,
            detail=f"No suitable terminal emulator found. Tried: {list(terminals.keys())}"
        )

    try:
        # Spawn the terminal in background
        subprocess.Popen(
            terminal_cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
            env={**os.environ, "TERM": "xterm-256color"},
        )
        return {"status": "ok", "terminal": terminal_cmd[0], "session_id": session_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to spawn terminal: {e}")


# Legacy WebSocket endpoint for LegacyPtyProvider
# (TmuxTtydProvider uses ttyd's WebSocket directly)
@router.websocket("/ws/{session_id}")
async def terminal_websocket(websocket: WebSocket, session_id: str):
    """WebSocket endpoint for legacy PTY terminal I/O"""
    session = terminal_manager.get_session(session_id)
    if not session:
        await websocket.close(code=4004, reason="Session not found")
        return

    await websocket.accept()
    session.websocket_clients.append(websocket)

    async def read_loop():
        while session.is_alive:
            try:
                data = await terminal_manager.read(session_id, timeout=0.1)
                if data:
                    for client in session.websocket_clients:
                        try:
                            await client.send_text(data)
                        except Exception:
                            pass
            except Exception:
                break
            await asyncio.sleep(0.05)

    read_task = asyncio.create_task(read_loop())

    try:
        while True:
            data = await websocket.receive_text()
            if data.startswith("\x1b[resize:"):
                parts = data[9:-1].split(",")
                if len(parts) == 2:
                    cols, rows = int(parts[0]), int(parts[1])
                    await terminal_manager.resize(session_id, cols, rows)
            else:
                await terminal_manager.write(session_id, data)
    except WebSocketDisconnect:
        pass
    finally:
        read_task.cancel()
        if websocket in session.websocket_clients:
            session.websocket_clients.remove(websocket)
async def _tmux_session_exists(session_id: str) -> bool:
    proc = await asyncio.create_subprocess_exec(
        "tmux",
        "has-session",
        "-t",
        session_id,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    await proc.communicate()
    return proc.returncode == 0


async def _kill_tmux_session(session_id: str) -> bool:
    proc = await asyncio.create_subprocess_exec(
        "tmux",
        "kill-session",
        "-t",
        session_id,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    await proc.communicate()
    return proc.returncode == 0
