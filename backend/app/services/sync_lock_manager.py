"""Dual-layer lock manager for git sync operations.

Provides SyncLockManager with two locking layers:

Layer 1: asyncio.Lock per source_id
    Serializes coroutines within the same process. Prevents multiple
    sync operations on the same source from racing in-process.

Layer 2: AsyncFileLock per vault_path
    Serializes processes via filesystem locks. Prevents multiple
    server processes from racing on the same git repository.

Usage:
    from app.services.sync_lock_manager import SyncLockManager

    lock_manager = SyncLockManager()

    async with lock_manager.get_coroutine_lock(source_id):
        file_lock = lock_manager.get_file_lock(vault_path)
        async with file_lock:
            # All git operations happen here
            ...
"""

import asyncio
from collections import defaultdict

from filelock import AsyncFileLock

from app.core.file_lock import vault_file_lock


class SyncLockManager:
    """Dual-layer lock manager for git sync operations.

    Layer 1: asyncio.Lock per source_id -- serializes coroutines in-process.
    Layer 2: AsyncFileLock per vault_path -- serializes processes cross-process.
    """

    def __init__(self) -> None:
        self._locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    def get_coroutine_lock(self, source_id: str) -> asyncio.Lock:
        """Get the in-process asyncio.Lock for a source.

        Returns the same Lock instance for the same source_id,
        enabling coroutine serialization.

        Args:
            source_id: Unique identifier for the knowledge source.

        Returns:
            asyncio.Lock bound to this source_id.
        """
        return self._locks[source_id]

    @staticmethod
    def get_file_lock(
        vault_path: str, timeout: float = 60.0
    ) -> AsyncFileLock:
        """Get the cross-process AsyncFileLock for a vault path.

        Uses vault_file_lock() which places the lock file at
        .git/.gsd.lock (or vault_path/.gsd.lock if no .git dir).

        Args:
            vault_path: Path to the vault root directory.
            timeout: Lock acquisition timeout in seconds.

        Returns:
            AsyncFileLock instance (not yet acquired).
        """
        return vault_file_lock(vault_path, timeout=timeout)
