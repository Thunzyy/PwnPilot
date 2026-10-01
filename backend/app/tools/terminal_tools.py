"""Terminal tools (5). Creates/manages tmux sessions via ConsoleProvider + tmux CLI."""
from __future__ import annotations

import asyncio

from app.services.provider_factory import get_provider
from app.tools.registry import ToolContext, tool


@tool(name="terminal_create_session", description="Create or reuse a tmux terminal session", category="terminal")
async def terminal_create_session(ctx: ToolContext, name: str | None = None) -> dict:
    provider = get_provider()
    session_name = name or "agent"
    # Check if session with this name already exists
    existing = provider.list_sessions(project_id=ctx.project_id)
    for s in existing:
        if s.name == session_name and s.is_alive:
            return {"session_id": s.id, "name": s.name, "reused": True}
    session = await provider.create_session(
        name=session_name,
        project_id=ctx.project_id,
        user_id=ctx.user_id,
    )
    return {"session_id": session.id, "name": session.name, "reused": False}


@tool(name="terminal_run_command", description="Execute a command in a terminal session", category="terminal")
async def terminal_run_command(ctx: ToolContext, command: str, session_id: str) -> dict:
    provider = get_provider()
    if not await provider.send_input(session_id, f"{command}\n"):
        return {"error": "failed to send command", "session_id": session_id}

    wait_for_command_completion = getattr(provider, "wait_for_command_completion", None)
    if callable(wait_for_command_completion):
        await wait_for_command_completion(session_id)

    # Capture output
    output = await _capture_pane(session_id, lines=50)
    has_shell_state_tracking = getattr(provider, "has_shell_state_tracking", None)
    history_recorded_by_shell_hook = (
        callable(has_shell_state_tracking) and has_shell_state_tracking(session_id)
    )
    return {
        "session_id": session_id,
        "command": command,
        "output": output,
        "_history_recorded_by_shell_hook": history_recorded_by_shell_hook,
    }


@tool(name="terminal_get_output", description="Read terminal output from a session", category="terminal")
async def terminal_get_output(ctx: ToolContext, session_id: str, lines: int = 50) -> dict:
    output = await _capture_pane(session_id, lines=lines)
    return {"session_id": session_id, "output": output, "lines": lines}


@tool(name="terminal_cancel", description="Send Ctrl+C to cancel a running command", category="terminal")
async def terminal_cancel(ctx: ToolContext, session_id: str) -> dict:
    proc = await asyncio.create_subprocess_exec(
        "tmux", "send-keys", "-t", session_id, "C-c",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    await proc.communicate()
    return {"session_id": session_id, "cancelled": True}


@tool(name="terminal_kill_session", description="Close and destroy a terminal session", category="terminal")
async def terminal_kill_session(ctx: ToolContext, session_id: str) -> dict:
    provider = get_provider()
    ok = await provider.destroy_session(session_id)
    return {"session_id": session_id, "killed": ok}


async def _capture_pane(session_id: str, lines: int = 50) -> str:
    """Capture terminal output via tmux capture-pane."""
    proc = await asyncio.create_subprocess_exec(
        "tmux", "capture-pane", "-t", session_id, "-p", f"-S-{lines}",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        return f"[capture failed: {stderr.decode().strip()}]"
    return stdout.decode().rstrip()
