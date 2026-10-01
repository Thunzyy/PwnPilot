"""
LegacyPtyProvider - Wrapper around existing terminal_manager

Implements ConsoleProvider interface while using the legacy ptyprocess-based
terminal_manager singleton. Generates tokens for backward compatibility.
"""

import platform
import secrets
from collections.abc import AsyncIterator
from urllib.parse import urlparse

from app.config import settings
from app.services.console_provider import (
    ConsoleProvider,
    ConsoleSession,
    TerminalCapabilities,
)
from app.services.terminal_manager import TerminalSession, terminal_manager


class LegacyPtyProvider(ConsoleProvider):
    """
    ConsoleProvider implementation using the existing terminal_manager.

    Since the legacy system doesn't have token-based authentication,
    we generate and store tokens for each session for API compatibility.
    """

    def __init__(self):
        self._token_map: dict[str, tuple[str, str]] = {}  # session_id -> (master_token, viewer_token)

    def _generate_tokens(self) -> tuple[str, str]:
        """Generate master and viewer tokens"""
        master_token = secrets.token_urlsafe(32)
        viewer_token = secrets.token_urlsafe(32)
        return master_token, viewer_token

    def _build_websocket_url(self, session_id: str) -> str:
        """Build the legacy WebSocket URL"""
        api_base = settings.api_base_url.rstrip("/")
        parsed = urlparse(api_base)
        ws_scheme = "wss" if parsed.scheme == "https" else "ws"
        base_path = parsed.path.rstrip("/")
        return f"{ws_scheme}://{parsed.netloc}{base_path}/terminal/ws/{session_id}"

    def _to_console_session(self, session: TerminalSession) -> ConsoleSession:
        """Convert TerminalSession to ConsoleSession"""
        # Get or create tokens for this session
        if session.id not in self._token_map:
            self._token_map[session.id] = self._generate_tokens()

        master_token, viewer_token = self._token_map[session.id]

        return ConsoleSession(
            id=session.id,
            project_id=session.project_id,
            name=session.name,
            websocket_url=self._build_websocket_url(session.id),
            master_token=master_token,
            viewer_token=viewer_token,
            is_alive=session.is_alive,
            created_at=session.created_at,
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
        """Create a new terminal session"""
        terminal_session = await terminal_manager.create_session(
            name=name,
            project_id=project_id,
            shell=None,  # Use default shell
            cols=cols,
            rows=rows,
        )
        return self._to_console_session(terminal_session)

    async def get_session(self, session_id: str) -> ConsoleSession | None:
        """Get current state of a session"""
        terminal_session = terminal_manager.get_session(session_id)
        if terminal_session is None:
            return None
        return self._to_console_session(terminal_session)

    async def attach_session(self, session_id: str) -> ConsoleSession | None:
        """Attach to existing session. Returns None if dead."""
        terminal_session = terminal_manager.get_session(session_id)
        if terminal_session is None or not terminal_session.is_alive:
            return None
        return self._to_console_session(terminal_session)

    async def destroy_session(self, session_id: str) -> bool:
        """Terminate and cleanup a session"""
        success = await terminal_manager.destroy_session(session_id)
        # Clean up token mapping
        if session_id in self._token_map:
            del self._token_map[session_id]
        return success

    async def rename_session(self, session_id: str, name: str) -> ConsoleSession | None:
        """Rename a session and return updated data"""
        renamed = await terminal_manager.rename_session(session_id, name)
        if not renamed:
            return None
        session = terminal_manager.get_session(session_id)
        return self._to_console_session(session) if session else None

    async def resize(self, session_id: str, cols: int, rows: int) -> bool:
        """Resize the PTY"""
        return await terminal_manager.resize(session_id, cols, rows)

    async def send_input(self, session_id: str, data: str) -> bool:
        """Write raw input into the terminal session."""
        return await terminal_manager.write(session_id, data)

    async def get_output_stream(self, session_id: str) -> AsyncIterator[str]:
        """
        Async stream of output. StopAsyncIteration when done.

        Yields from the session's output_buffer. This is a simple implementation
        that just returns existing buffered output. For real-time streaming,
        the WebSocket endpoint should be used instead.
        """
        terminal_session = terminal_manager.get_session(session_id)
        if terminal_session is None:
            return

        # Yield existing buffer
        for output in terminal_session.output_buffer:
            yield output

    def list_sessions(self, project_id: str | None = None) -> list[ConsoleSession]:
        """List active sessions"""
        terminal_sessions = terminal_manager.list_sessions(project_id=project_id)
        return [self._to_console_session(session) for session in terminal_sessions]

    def get_capabilities(self) -> TerminalCapabilities:
        return TerminalCapabilities(
            provider="legacy",
            platform=platform.system().lower(),
            can_create_session=True,
            can_detach=False,
            websocket_mode="legacy",
            reason_unavailable="Detach to native terminal requires the tmux_ttyd provider.",
        )
