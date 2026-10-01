"""
Console Provider - Abstract interface for terminal backends

Supports multiple implementations:
- LegacyPtyProvider: Existing ptyprocess implementation
- TmuxTtydProvider: tmux + ttyd for shared sessions
"""

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime
from enum import Enum


class ViewerRole(Enum):
    """Role of a viewer in a terminal session"""

    MASTER = "master"  # read-write, session creator
    CONTROLLER = "controller"  # read-write, promoted viewer
    VIEWER = "viewer"  # read-only


@dataclass
class ConsoleSession:
    """Represents a terminal session"""

    id: str
    project_id: str | None
    name: str
    websocket_url: str
    master_token: str
    viewer_token: str
    is_alive: bool
    created_at: datetime


@dataclass
class SessionViewer:
    """A connected viewer with their role"""

    id: str
    user_id: str | None  # None = anonymous
    role: ViewerRole
    connected_at: datetime


@dataclass
class TerminalCapabilities:
    """Describes what the active terminal provider can do on this platform."""

    provider: str
    platform: str
    can_create_session: bool
    can_detach: bool
    websocket_mode: str
    reason_unavailable: str | None = None


class ConsoleProvider(ABC):
    """Abstract interface for terminal backends"""

    @abstractmethod
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

    @abstractmethod
    async def get_session(self, session_id: str) -> ConsoleSession | None:
        """Get current state of a session"""

    @abstractmethod
    async def attach_session(self, session_id: str) -> ConsoleSession | None:
        """Attach to existing session. Returns None if dead."""

    @abstractmethod
    async def destroy_session(self, session_id: str) -> bool:
        """Terminate and cleanup a session"""

    @abstractmethod
    async def rename_session(self, session_id: str, name: str) -> ConsoleSession | None:
        """Rename a session and return updated session"""

    @abstractmethod
    async def resize(self, session_id: str, cols: int, rows: int) -> bool:
        """Resize the PTY"""

    @abstractmethod
    async def send_input(self, session_id: str, data: str) -> bool:
        """Send raw input to the terminal session."""

    @abstractmethod
    async def get_output_stream(self, session_id: str) -> AsyncIterator[str]:
        """Async stream of output. StopAsyncIteration when done."""
        yield ""  # Make it a generator for type checking

    @abstractmethod
    def list_sessions(self, project_id: str | None = None) -> list[ConsoleSession]:
        """List active sessions"""

    @abstractmethod
    def get_capabilities(self) -> TerminalCapabilities:
        """Describe the current provider capabilities."""
