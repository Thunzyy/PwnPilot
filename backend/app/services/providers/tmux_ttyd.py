"""
TmuxTtydProvider - Terminal backend using tmux + ttyd
"""

import asyncio
import os
import platform
import secrets
import shlex
import shutil
import socket
import subprocess
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import jwt

from app.config import settings
from app.services.console_provider import (
    ConsoleProvider,
    ConsoleSession,
    TerminalCapabilities,
)
from app.services.port_pool import PortPool, shared_port_pool

# Shell hook script path
SHELL_HOOK_PATH = Path(__file__).parent.parent.parent.parent / "data" / "pwnpilot-shell-hook.sh"
SHELL_BOOTSTRAP_DIR = Path("/tmp/pwnpilot/hooks")
SHELL_STATE_DIR = Path("/tmp/pwnpilot/state")


@dataclass
class TmuxSessionData:
    """Internal session tracking data"""
    session: ConsoleSession
    ttyd_port: int
    ttyd_process: subprocess.Popen
    hook_bootstrap_dir: Path | None = None
    command_state_file: Path | None = None
    watcher_task: asyncio.Task | None = None
    input_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class TmuxTtydProvider(ConsoleProvider):
    """Terminal provider using tmux + ttyd"""

    def __init__(
        self,
        host: str = "localhost",
        use_ssl: bool = False,
        port_start: int | None = None,
        port_end: int | None = None,
    ):
        self._check_dependencies()
        self.host = host
        self.ws_scheme = "wss" if use_ssl else "ws"
        self.port_pool = (
            PortPool(range(port_start, port_end + 1))
            if port_start is not None and port_end is not None
            else shared_port_pool
        )
        self.log_dir = Path("/tmp/pwnpilot/logs")
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self._sessions: dict[str, TmuxSessionData] = {}
        self.workspace_root = Path(settings.projects_root)

    def _check_dependencies(self) -> None:
        for cmd in ["tmux", "ttyd"]:
            if shutil.which(cmd) is None:
                raise RuntimeError(f"{cmd} not found in PATH")

    def _is_port_free(self, port: int) -> bool:
        """Return True if the port is free to bind on this host."""
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("0.0.0.0", port))
            except OSError:
                return False
        return True

    def _acquire_free_port(self) -> int:
        """Acquire the next available port that is not already in use."""
        while True:
            port = self.port_pool.acquire()
            if self._is_port_free(port):
                return port

    async def _wait_for_ttyd(
        self,
        port: int,
        process: subprocess.Popen,
        timeout: float = 2.0,
    ) -> bool:
        """Wait until ttyd is listening on the port or the process exits."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if process.poll() is not None:
                return False
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.settimeout(0.1)
                try:
                    sock.connect(("127.0.0.1", port))
                    return True
                except OSError:
                    await asyncio.sleep(0.05)
        return False

    async def _run_tmux(self, *args: str) -> str:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._run_tmux_sync, args)

    def _run_tmux_sync(self, args: tuple[str, ...]) -> str:
        result = subprocess.run(
            ["tmux", *args],
            capture_output=True,
            timeout=10,
        )
        if result.returncode != 0 and b"no server running" not in result.stderr:
            raise RuntimeError(f"tmux error: {result.stderr.decode()}")
        return result.stdout.decode()

    def _generate_session_token(self, user_id: str, session_id: str) -> str:
        """Generate a long-lived JWT token for shell hook authentication."""
        # Token valid for 7 days (session lifetime)
        expires = datetime.now(UTC) + timedelta(days=7)
        payload = {
            "sub": user_id,
            "type": "session",
            "session_id": session_id,
            "exp": expires,
        }
        return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)

    def _resolve_interactive_shell(self) -> Path:
        """Resolve user's preferred shell with safe fallbacks."""
        shell_candidate = os.environ.get("SHELL")
        if not shell_candidate:
            try:
                import pwd

                shell_candidate = pwd.getpwuid(os.getuid()).pw_shell
            except Exception:
                shell_candidate = "/bin/bash"

        shell_path = Path(shell_candidate or "/bin/bash")
        if shell_path.exists():
            return shell_path

        for fallback in (Path("/bin/zsh"), Path("/usr/bin/zsh"), Path("/bin/bash"), Path("/usr/bin/bash")):
            if fallback.exists():
                return fallback
        return Path("/bin/sh")

    def _build_shell_bootstrap(
        self,
        *,
        shell_path: Path,
        session_id: str,
    ) -> tuple[list[str], list[str], Path | None]:
        """Prepare shell startup so the hook is loaded before first prompt."""
        shell_name = shell_path.name.lower()
        if "zsh" in shell_name:
            bootstrap_dir = SHELL_BOOTSTRAP_DIR / session_id / "zsh"
            bootstrap_dir.mkdir(parents=True, exist_ok=True)
            zshrc_path = bootstrap_dir / ".zshrc"
            zshrc_content = (
                "#!/usr/bin/env zsh\n"
                "if [[ -f \"$HOME/.zshrc\" ]]; then\n"
                "  source \"$HOME/.zshrc\"\n"
                "fi\n"
                f"source {shlex.quote(str(SHELL_HOOK_PATH))} >/dev/null 2>&1 || true\n"
            )
            zshrc_path.write_text(zshrc_content, encoding="utf-8")
            zshrc_path.chmod(0o600)
            return [str(shell_path), "-i"], [f"ZDOTDIR={bootstrap_dir}"], bootstrap_dir

        # Default to bash bootstrap when shell detection is not zsh.
        bash_shell = shell_path
        if "bash" not in shell_name:
            for candidate in (Path("/bin/bash"), Path("/usr/bin/bash")):
                if candidate.exists():
                    bash_shell = candidate
                    break
        bootstrap_dir = SHELL_BOOTSTRAP_DIR / session_id / "bash"
        bootstrap_dir.mkdir(parents=True, exist_ok=True)
        bashrc_path = bootstrap_dir / "bashrc"
        bashrc_content = (
            "#!/usr/bin/env bash\n"
            "if [[ -f \"$HOME/.bashrc\" ]]; then\n"
            "  source \"$HOME/.bashrc\"\n"
            "fi\n"
            f"source {shlex.quote(str(SHELL_HOOK_PATH))} >/dev/null 2>&1 || true\n"
        )
        bashrc_path.write_text(bashrc_content, encoding="utf-8")
        bashrc_path.chmod(0o600)
        return [str(bash_shell), "--rcfile", str(bashrc_path), "-i"], [], bootstrap_dir

    async def _wait_for_shell_idle(
        self,
        session_data: TmuxSessionData,
        timeout: float = 10.0,
    ) -> bool:
        state_file = session_data.command_state_file
        if state_file is None:
            return True

        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if not session_data.session.is_alive:
                return False
            try:
                state = state_file.read_text(encoding="utf-8").strip()
            except FileNotFoundError:
                state = ""
            except OSError:
                state = ""
            if state == "idle":
                return True
            await asyncio.sleep(0.05)

        return False

    async def wait_for_command_completion(self, session_id: str, timeout: float = 10.0) -> bool:
        session_data = self._sessions.get(session_id)
        if not session_data or not session_data.session.is_alive:
            return False
        return await self._wait_for_shell_idle(session_data, timeout=timeout)

    def has_shell_state_tracking(self, session_id: str) -> bool:
        session_data = self._sessions.get(session_id)
        return bool(session_data and session_data.command_state_file is not None)

    def get_capabilities(self) -> TerminalCapabilities:
        return TerminalCapabilities(
            provider="tmux_ttyd",
            platform=platform.system().lower(),
            can_create_session=True,
            can_detach=True,
            websocket_mode="ttyd",
            reason_unavailable=None,
        )

    async def create_session(
        self,
        name: str,
        project_id: str | None = None,
        cols: int = 120,
        rows: int = 30,
        workspace_path: str | None = None,
        user_id: str | None = None,
    ) -> ConsoleSession:
        session_id = f"pwnpilot-{project_id or 'local'}-{uuid4().hex[:8]}"
        log_path = self.log_dir / f"{session_id}.log"
        workspace_dir = (
            Path(workspace_path).expanduser()
            if workspace_path
            else self.workspace_root / (project_id or "local")
        )
        workspace_dir.mkdir(parents=True, exist_ok=True)

        hook_bootstrap_dir: Path | None = None
        command_state_file: Path | None = None
        new_session_args: list[str] = [
            "new-session",
            "-d",
            "-s",
            session_id,
            "-x",
            str(cols),
            "-y",
            str(rows),
            "-c",
            str(workspace_dir),
        ]
        hook_enabled = bool(project_id and user_id and SHELL_HOOK_PATH.exists())
        if hook_enabled:
            session_token = self._generate_session_token(user_id, session_id)
            shell_path = self._resolve_interactive_shell()
            shell_command, shell_env, hook_bootstrap_dir = self._build_shell_bootstrap(
                shell_path=shell_path,
                session_id=session_id,
            )
            SHELL_STATE_DIR.mkdir(parents=True, exist_ok=True)
            command_state_file = SHELL_STATE_DIR / f"{session_id}.state"
            command_state_file.unlink(missing_ok=True)
            session_env = [
                f"PP_API_URL={settings.api_base_url}",
                f"PP_SESSION_ID={session_id}",
                f"PP_TOKEN={session_token}",
                f"PP_PROJECT_ID={project_id}",
                f"PP_SESSION_STATE_FILE={command_state_file}",
                "PP_HOOK_VERBOSE=0",
                *shell_env,
            ]
            for env_var in session_env:
                new_session_args.extend(["-e", env_var])
            new_session_args.extend(shell_command)

        try:
            await self._run_tmux(*new_session_args)
        except Exception:
            if hook_bootstrap_dir is not None:
                shutil.rmtree(hook_bootstrap_dir.parent, ignore_errors=True)
            if command_state_file is not None:
                command_state_file.unlink(missing_ok=True)
            raise
        await self._run_tmux("pipe-pane", "-o", "-t", session_id, f"cat >> {log_path}")

        try:
            port = self._acquire_free_port()
        except RuntimeError:
            await self._run_tmux("kill-session", "-t", session_id)
            raise
        try:
            ttyd_proc = subprocess.Popen(
                ["ttyd", "--port", str(port), "--writable", "tmux", "attach", "-t", session_id],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception as e:
            self.port_pool.release(port)
            await self._run_tmux("kill-session", "-t", session_id)
            if hook_bootstrap_dir is not None:
                shutil.rmtree(hook_bootstrap_dir.parent, ignore_errors=True)
            if command_state_file is not None:
                command_state_file.unlink(missing_ok=True)
            raise RuntimeError(f"Failed to start ttyd: {e}")

        ready = await self._wait_for_ttyd(port, ttyd_proc)
        if not ready:
            try:
                ttyd_proc.terminate()
                ttyd_proc.wait(timeout=5)
            except Exception:
                ttyd_proc.kill()
            self.port_pool.release(port)
            await self._run_tmux("kill-session", "-t", session_id)
            if hook_bootstrap_dir is not None:
                shutil.rmtree(hook_bootstrap_dir.parent, ignore_errors=True)
            if command_state_file is not None:
                command_state_file.unlink(missing_ok=True)
            raise RuntimeError("Failed to start ttyd: port not responding")

        master_token = secrets.token_urlsafe(32)
        viewer_token = secrets.token_urlsafe(32)

        session = ConsoleSession(
            id=session_id,
            project_id=project_id,
            name=name,
            websocket_url=f"{self.ws_scheme}://{self.host}:{port}/ws",
            master_token=master_token,
            viewer_token=viewer_token,
            is_alive=True,
            created_at=datetime.now(UTC),
        )

        session_data = TmuxSessionData(
            session=session,
            ttyd_port=port,
            ttyd_process=ttyd_proc,
            hook_bootstrap_dir=hook_bootstrap_dir.parent if hook_bootstrap_dir else None,
            command_state_file=command_state_file,
        )
        session_data.watcher_task = asyncio.create_task(self._watch_ttyd(session_id))
        self._sessions[session_id] = session_data
        return session

    async def _watch_ttyd(self, session_id: str) -> None:
        session_data = self._sessions.get(session_id)
        if not session_data:
            return
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, session_data.ttyd_process.wait)
        await self._cleanup_session(session_id)

    async def _cleanup_session(self, session_id: str) -> None:
        session_data = self._sessions.get(session_id)
        if not session_data:
            return
        session_data.session.is_alive = False
        try:
            self.port_pool.release(session_data.ttyd_port)
        except ValueError:
            pass
        log_path = self.log_dir / f"{session_id}.log"
        log_path.unlink(missing_ok=True)
        if session_data.hook_bootstrap_dir:
            shutil.rmtree(session_data.hook_bootstrap_dir, ignore_errors=True)
        if session_data.command_state_file:
            session_data.command_state_file.unlink(missing_ok=True)

    async def get_session(self, session_id: str) -> ConsoleSession | None:
        session_data = self._sessions.get(session_id)
        return session_data.session if session_data else None

    async def attach_session(self, session_id: str) -> ConsoleSession | None:
        session_data = self._sessions.get(session_id)
        if not session_data or not session_data.session.is_alive:
            return None
        return session_data.session

    async def destroy_session(self, session_id: str) -> bool:
        session_data = self._sessions.pop(session_id, None)
        if not session_data:
            return False
        if session_data.watcher_task:
            session_data.watcher_task.cancel()
        try:
            session_data.ttyd_process.terminate()
            session_data.ttyd_process.wait(timeout=5)
        except Exception:
            session_data.ttyd_process.kill()
        try:
            self.port_pool.release(session_data.ttyd_port)
        except ValueError:
            pass
        try:
            await self._run_tmux("kill-session", "-t", session_id)
        except Exception:
            pass
        log_path = self.log_dir / f"{session_id}.log"
        log_path.unlink(missing_ok=True)
        if session_data.hook_bootstrap_dir:
            shutil.rmtree(session_data.hook_bootstrap_dir, ignore_errors=True)
        if session_data.command_state_file:
            session_data.command_state_file.unlink(missing_ok=True)
        return True

    async def rename_session(self, session_id: str, name: str) -> ConsoleSession | None:
        session_data = self._sessions.get(session_id)
        if not session_data:
            return None
        session_data.session.name = name
        return session_data.session

    async def resize(self, session_id: str, cols: int, rows: int) -> bool:
        session_data = self._sessions.get(session_id)
        if not session_data or not session_data.session.is_alive:
            return False
        try:
            await self._run_tmux("resize-window", "-t", session_id, "-x", str(cols), "-y", str(rows))
            return True
        except Exception:
            return False

    async def send_input(self, session_id: str, data: str) -> bool:
        session_data = self._sessions.get(session_id)
        if not session_data or not session_data.session.is_alive:
            return False

        try:
            normalized = data.replace("\r\n", "\n")
            ends_with_newline = normalized.endswith("\n")
            chunks = normalized.split("\n")
            line_count = len(chunks) - (1 if ends_with_newline else 0)
            should_wait_for_prompt = line_count > 0 and (
                ends_with_newline or line_count > 1
            )

            async with session_data.input_lock:
                if should_wait_for_prompt and not await self._wait_for_shell_idle(session_data):
                    return False

                for index, chunk in enumerate(chunks[:line_count]):
                    if chunk:
                        await self._run_tmux("send-keys", "-t", session_id, "-l", chunk)
                    should_press_enter = index < line_count - 1 or ends_with_newline
                    if should_press_enter:
                        await self._run_tmux("send-keys", "-t", session_id, "Enter")
            return True
        except Exception:
            return False

    async def get_output_stream(self, session_id: str) -> AsyncIterator[str]:
        import aiofiles
        log_path = self.log_dir / f"{session_id}.log"
        for _ in range(50):
            if log_path.exists():
                break
            await asyncio.sleep(0.1)
        else:
            return
        try:
            async with aiofiles.open(log_path) as f:
                await f.seek(0, 2)
                while session_id in self._sessions and self._sessions[session_id].session.is_alive:
                    line = await f.readline()
                    if line:
                        yield line
                    else:
                        await asyncio.sleep(0.1)
        except (FileNotFoundError, asyncio.CancelledError):
            return

    def list_sessions(self, project_id: str | None = None) -> list[ConsoleSession]:
        sessions = [data.session for data in self._sessions.values()]
        if project_id:
            sessions = [s for s in sessions if s.project_id == project_id]
        return sessions
