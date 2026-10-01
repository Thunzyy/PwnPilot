"""
Terminal Manager Service - Multi-OS PTY Support with Session Persistence

Supports:
- Windows: winpty via pywinpty
- Linux/macOS: ptyprocess
"""

import asyncio
import os
import platform
import subprocess
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime


@dataclass
class TerminalSession:
    id: str
    name: str
    project_id: str | None
    shell: str
    created_at: datetime
    pty_process: object | None = None
    output_buffer: list[str] = field(default_factory=list)
    is_alive: bool = True
    websocket_clients: list = field(default_factory=list)


class TerminalManager:
    def __init__(self):
        self.sessions: dict[str, TerminalSession] = {}
        self.os_type = platform.system()
        self._default_shell = self._get_default_shell()

    def _get_default_shell(self) -> str:
        if self.os_type == "Windows":
            return os.environ.get("COMSPEC", "cmd.exe")
        return os.environ.get("SHELL", "/bin/bash")

    def _get_available_shells(self) -> list[str]:
        if self.os_type == "Windows":
            shells = ["cmd.exe", "powershell.exe"]
            pwsh = r"C:\Program Files\PowerShell\7\pwsh.exe"
            if os.path.exists(pwsh):
                shells.append("pwsh.exe")
            return shells
        return ["/bin/bash", "/bin/sh", "/bin/zsh"]

    async def create_session(
        self,
        name: str = "Terminal",
        project_id: str | None = None,
        shell: str | None = None,
        cols: int = 120,
        rows: int = 30,
    ) -> TerminalSession:
        session_id = str(uuid.uuid4())
        shell = shell or self._default_shell

        session = TerminalSession(
            id=session_id,
            name=name,
            project_id=project_id,
            shell=shell,
            created_at=datetime.now(UTC),
        )

        try:
            if self.os_type == "Windows":
                session.pty_process = await self._create_windows_pty(shell, cols, rows)
            else:
                session.pty_process = await self._create_unix_pty(shell, cols, rows)
        except Exception as e:
            session.output_buffer.append(f"[ERROR] Failed to create PTY: {e}\n")
            session.is_alive = False

        self.sessions[session_id] = session
        return session

    async def _create_windows_pty(self, shell: str, cols: int, rows: int):
        try:
            from winpty import PtyProcess
            return PtyProcess.spawn(shell, dimensions=(rows, cols))
        except ImportError:
            return self._create_subprocess_fallback(shell)

    async def _create_unix_pty(self, shell: str, cols: int, rows: int):
        try:
            from ptyprocess import PtyProcess
            return PtyProcess.spawn([shell], dimensions=(rows, cols))
        except ImportError:
            return self._create_subprocess_fallback(shell)

    def _create_subprocess_fallback(self, shell: str):
        return subprocess.Popen(
            shell,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            shell=True,
            text=True,
            bufsize=0,
        )

    async def write(self, session_id: str, data: str) -> bool:
        session = self.sessions.get(session_id)
        if not session or not session.is_alive:
            return False

        try:
            if hasattr(session.pty_process, "write"):
                session.pty_process.write(data)
            elif hasattr(session.pty_process, "stdin"):
                session.pty_process.stdin.write(data)
                session.pty_process.stdin.flush()
            return True
        except Exception:
            session.is_alive = False
            return False

    async def read(self, session_id: str, timeout: float = 0.1) -> str | None:
        session = self.sessions.get(session_id)
        if not session or not session.is_alive:
            return None

        try:
            if hasattr(session.pty_process, "read"):
                loop = asyncio.get_event_loop()
                try:
                    data = await asyncio.wait_for(
                        loop.run_in_executor(None, lambda: session.pty_process.read(4096)),
                        timeout=timeout
                    )
                    if data:
                        session.output_buffer.append(data)
                        if len(session.output_buffer) > 1000:
                            session.output_buffer = session.output_buffer[-500:]
                    return data
                except TimeoutError:
                    return ""
            elif hasattr(session.pty_process, "stdout"):
                return session.pty_process.stdout.read(4096) if session.pty_process.stdout else None
        except Exception:
            session.is_alive = False
            return None
        return None

    async def resize(self, session_id: str, cols: int, rows: int) -> bool:
        session = self.sessions.get(session_id)
        if not session or not session.is_alive:
            return False

        try:
            if hasattr(session.pty_process, "setwinsize"):
                session.pty_process.setwinsize(rows, cols)
                return True
        except Exception:
            pass
        return False

    async def rename_session(self, session_id: str, name: str) -> bool:
        session = self.sessions.get(session_id)
        if not session:
            return False
        session.name = name
        return True

    async def destroy_session(self, session_id: str) -> bool:
        session = self.sessions.get(session_id)
        if not session:
            return False

        try:
            if hasattr(session.pty_process, "terminate"):
                session.pty_process.terminate()
            elif hasattr(session.pty_process, "kill"):
                session.pty_process.kill()
        except Exception:
            pass

        session.is_alive = False
        del self.sessions[session_id]
        return True

    def get_session(self, session_id: str) -> TerminalSession | None:
        return self.sessions.get(session_id)

    def list_sessions(self, project_id: str | None = None) -> list[TerminalSession]:
        sessions = list(self.sessions.values())
        if project_id:
            sessions = [s for s in sessions if s.project_id == project_id]
        return sessions

    def get_last_output(self, session_id: str, lines: int = 10) -> list[str]:
        session = self.sessions.get(session_id)
        if not session:
            return []
        full_output = "".join(session.output_buffer)
        output_lines = full_output.split("\n")
        return output_lines[-lines:]

    async def detach_to_native(self, session_id: str) -> bool:
        session = self.sessions.get(session_id)
        if not session:
            return False

        try:
            if self.os_type == "Windows":
                subprocess.Popen(
                    ["start", "cmd", "/k", session.shell],
                    shell=True,
                    creationflags=subprocess.CREATE_NEW_CONSOLE
                )
            elif self.os_type == "Darwin":
                subprocess.Popen([
                    "osascript", "-e",
                    f'tell app "Terminal" to do script "{session.shell}"'
                ])
            else:
                terminals = ["gnome-terminal", "konsole", "xfce4-terminal", "xterm"]
                for term in terminals:
                    try:
                        subprocess.Popen([term, "-e", session.shell])
                        break
                    except FileNotFoundError:
                        continue
            return True
        except Exception:
            return False


terminal_manager = TerminalManager()
