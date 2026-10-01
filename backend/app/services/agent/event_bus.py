"""Agent event bus -- fan-out pub/sub for live tool call streaming.

Subscribers (SSE handlers) receive tool call events in real-time via
per-project asyncio Queues. Follows the same singleton pattern as
MCPSessionManager.
"""

from __future__ import annotations

import asyncio


class AgentEventBus:
    """Fan-out event bus for agent tool call notifications."""

    def __init__(self) -> None:
        self._subscribers: dict[str, list[asyncio.Queue]] = {}

    def subscribe(self, project_id: str) -> asyncio.Queue:
        """Create a bounded queue for a subscriber and return it."""
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._subscribers.setdefault(project_id, []).append(q)
        return q

    def unsubscribe(self, project_id: str, q: asyncio.Queue) -> None:
        """Remove a subscriber queue."""
        subs = self._subscribers.get(project_id, [])
        if q in subs:
            subs.remove(q)
        if not subs:
            self._subscribers.pop(project_id, None)

    def publish(self, project_id: str, event: dict) -> None:
        """Broadcast event to all subscribers for a project."""
        for q in self._subscribers.get(project_id, []):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                pass  # Drop event if subscriber is too slow


agent_event_bus = AgentEventBus()
