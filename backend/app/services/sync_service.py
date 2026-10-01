"""Sync service — orchestrates git sync operations with dual-layer locking.

Composes GitService, SyncLockManager, and KBService to provide:
- sync_source: lock -> pull -> detect conflicts -> re-index
- clone_source: lock -> clone with configurable depth

Usage:
    from app.services.sync_service import SyncService

    service = SyncService(db)
    stats = await service.sync_source(source_id)
    await service.clone_source(url, dest, depth=1)
"""

from __future__ import annotations

import datetime
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ErrorCode
from app.core.exceptions import AppException
from app.models.knowledge import KnowledgeSource
from app.services.base import BaseService
from app.services.git_service import GitService
from app.services.kb_service import KBService
from app.services.sync_lock_manager import SyncLockManager

# Module-level lock manager (single-process app, shared across requests)
_lock_manager = SyncLockManager()


class SyncService(BaseService):
    """Orchestrates vault sync: lock -> git op -> re-index."""

    def __init__(self, db: AsyncSession):
        super().__init__("service.sync")
        self.db = db
        self.git = GitService()
        self.lock_manager = _lock_manager

    async def sync_source(self, source_id: str) -> dict:
        """Pull latest changes and re-index a source.

        Acquires dual locks (asyncio.Lock + AsyncFileLock) before
        any git operation. Detects merge conflicts and aborts.

        Returns index stats dict {added, updated, deleted, errors,
        duration_ms}.
        """
        # Load source
        source = await self._get_source(source_id)
        if not source.path:
            raise AppException(
                ErrorCode.KB_SYNC_FAILED,
                "Source has no vault path configured",
            )

        # Update sync_status to running
        source.sync_status = "running"
        await self.db.commit()

        try:
            # Dual-layer lock
            async with self.lock_manager.get_coroutine_lock(source_id):
                file_lock = self.lock_manager.get_file_lock(source.path)
                async with file_lock:
                    return await self._do_sync(source)
        except AppException:
            source.sync_status = "failed"
            await self.db.commit()
            raise
        except Exception as e:
            source.sync_status = "failed"
            await self.db.commit()
            raise AppException(
                ErrorCode.KB_SYNC_FAILED,
                f"Sync failed: {e}",
            ) from e

    async def _do_sync(self, source: KnowledgeSource) -> dict:
        """Inner sync logic (called within locks)."""
        # 1. Git pull
        stdout, stderr, rc = await self.git.pull(source.path)

        # 2. Check for merge conflicts (in stdout or stderr)
        if self.git.has_conflicts(stdout) or self.git.has_conflicts(
            stderr
        ):
            await self.git.abort_merge(source.path)
            raise AppException(
                ErrorCode.KB_SYNC_FAILED,
                "Merge conflict detected — pull aborted. "
                "Resolve manually.",
            )

        # 3. Check for errors
        if rc != 0:
            raise AppException(
                ErrorCode.KB_SYNC_FAILED,
                f"git pull failed (rc={rc}): {stderr.strip()}",
            )

        # 4. Re-index (uses existing hash-compare logic)
        kb = KBService(self.db)
        stats = await kb.index_vault(source.id, source.path)

        # 5. Update source metadata
        source.last_synced_at = datetime.datetime.now(datetime.UTC)
        source.sync_status = "completed"
        await self.db.commit()

        self.log.info(
            f"Sync complete for {source.name}: "
            f"+{stats['added']} ~{stats['updated']} "
            f"-{stats['deleted']}"
        )
        return stats

    async def clone_source(
        self,
        url: str,
        dest: str,
        depth: int | None = 1,
    ) -> None:
        """Clone a git repository to the destination path.

        Skips clone if dest already contains a .git directory.
        Uses depth=1 by default (community repos). Pass depth=None
        for full clone (user vaults).
        """
        dest_path = Path(dest)

        # Skip if already cloned
        if (dest_path / ".git").is_dir():
            self.log.info(f"Skipping clone — {dest} already has .git")
            return

        # Verify dest doesn't exist as non-git directory
        if dest_path.exists() and not (dest_path / ".git").is_dir():
            raise AppException(
                ErrorCode.KB_SYNC_FAILED,
                f"Destination exists but is not a git repo: {dest}",
            )

        stdout, stderr, rc = await self.git.clone(
            url, dest, depth=depth
        )
        if rc != 0:
            raise AppException(
                ErrorCode.KB_SYNC_FAILED,
                f"git clone failed: {stderr.strip()}",
            )

        self.log.info(f"Cloned {url} -> {dest}")

    async def _get_source(
        self, source_id: str
    ) -> KnowledgeSource:
        """Load a KnowledgeSource by ID."""
        source = await self.db.get(KnowledgeSource, source_id)
        if not source:
            raise AppException(
                ErrorCode.KB_SOURCE_NOT_FOUND,
                f"Source '{source_id}' not found",
            )
        return source
