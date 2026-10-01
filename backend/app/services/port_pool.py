"""
Port Pool - Manages dynamic port allocation for ttyd instances
"""

import threading
from collections.abc import Iterable


class PortPool:
    """Thread-safe port pool for ttyd instances"""

    def __init__(self, port_range: Iterable[int]):
        self._all_ports = set(port_range)
        self._available = set(port_range)
        self._lock = threading.Lock()

    @property
    def available_count(self) -> int:
        with self._lock:
            return len(self._available)

    def acquire(self) -> int:
        """Acquire an available port. Raises RuntimeError if exhausted."""
        with self._lock:
            if not self._available:
                raise RuntimeError("No available ports in pool")
            port = min(self._available)
            self._available.remove(port)
            return port

    def release(self, port: int) -> None:
        """Release a port back to the pool."""
        with self._lock:
            if port not in self._all_ports:
                raise ValueError(f"Port {port} not in pool")
            if port in self._available:
                raise ValueError(f"Port {port} already available")
            self._available.add(port)


# Module-level singleton shared by TmuxTtydProvider and AgentProcessManager
shared_port_pool = PortPool(range(7680, 7780))
