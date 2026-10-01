"""Tests for SyncLockManager dual-layer lock manager.

Tests verify:
- Per-source asyncio.Lock identity
- AsyncFileLock creation via vault_file_lock
- Coroutine serialization behavior
"""

import asyncio

import pytest
from filelock import AsyncFileLock

from app.services.sync_lock_manager import SyncLockManager


@pytest.fixture
def lock_manager():
    """Create a fresh SyncLockManager instance."""
    return SyncLockManager()


# --------------------------------------------------------------------------
# 1. Same lock for same source
# --------------------------------------------------------------------------


def test_get_coroutine_lock_returns_same_lock_for_same_source(lock_manager):
    """get_coroutine_lock returns the same Lock object for the same source_id."""
    lock_a = lock_manager.get_coroutine_lock("src-1")
    lock_b = lock_manager.get_coroutine_lock("src-1")
    assert lock_a is lock_b


# --------------------------------------------------------------------------
# 2. Different locks for different sources
# --------------------------------------------------------------------------


def test_get_coroutine_lock_returns_different_lock_for_different_sources(
    lock_manager,
):
    """get_coroutine_lock returns distinct Lock objects for different source_ids."""
    lock_a = lock_manager.get_coroutine_lock("src-1")
    lock_b = lock_manager.get_coroutine_lock("src-2")
    assert lock_a is not lock_b


# --------------------------------------------------------------------------
# 3. File lock returns AsyncFileLock
# --------------------------------------------------------------------------


def test_get_file_lock_returns_async_file_lock(lock_manager, tmp_path):
    """get_file_lock returns an AsyncFileLock instance."""
    vault_path = str(tmp_path / "vault")
    # Create the directory so vault_file_lock can find it
    (tmp_path / "vault").mkdir()
    file_lock = lock_manager.get_file_lock(vault_path)
    assert isinstance(file_lock, AsyncFileLock)


# --------------------------------------------------------------------------
# 4. Coroutine lock serializes access
# --------------------------------------------------------------------------


@pytest.mark.anyio
async def test_coroutine_lock_serializes_access(lock_manager):
    """Acquiring the same source lock from two coroutines blocks the second."""
    lock = lock_manager.get_coroutine_lock("src-1")

    # First coroutine acquires the lock
    await lock.acquire()

    blocked = False

    async def try_acquire():
        nonlocal blocked
        blocked = True
        await lock.acquire()
        lock.release()

    # Second coroutine should block
    task = asyncio.create_task(try_acquire())

    # Give the task a chance to start and block
    await asyncio.sleep(0.01)
    assert blocked, "Second coroutine should have started"

    # Verify second task is still waiting (not done)
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(asyncio.shield(task), timeout=0.05)

    # Release the lock from first coroutine
    lock.release()

    # Now the second coroutine should complete
    await asyncio.wait_for(task, timeout=1.0)


# --------------------------------------------------------------------------
# 5. Concurrent coroutines are serialized
# --------------------------------------------------------------------------


@pytest.mark.anyio
async def test_concurrent_coroutines_are_serialized(lock_manager):
    """5 concurrent tasks incrementing a counter are serialized by the lock."""
    counter = {"value": 0}
    lock = lock_manager.get_coroutine_lock("shared")

    async def increment():
        async with lock:
            # Non-atomic read-modify-write: without lock this would race
            current = counter["value"]
            await asyncio.sleep(0.005)  # Yield to event loop
            counter["value"] = current + 1

    tasks = [asyncio.create_task(increment()) for _ in range(5)]
    await asyncio.gather(*tasks)

    # If serialized, counter should be exactly 5
    # If not serialized, the read-modify-write race would produce < 5
    assert counter["value"] == 5
