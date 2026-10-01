import asyncio

import pytest
from filelock import Timeout

from app.core.file_lock import vault_file_lock


@pytest.mark.anyio
async def test_lock_acquire_release(tmp_path):
    (tmp_path / ".git").mkdir()
    lock = vault_file_lock(tmp_path)

    async with lock:
        assert lock.is_locked
    assert not lock.is_locked


@pytest.mark.anyio
async def test_concurrent_blocking(tmp_path):
    (tmp_path / ".git").mkdir()

    acquired_event = asyncio.Event()
    release_event = asyncio.Event()
    second_acquired = asyncio.Event()

    async def holder():
        lock = vault_file_lock(tmp_path)
        async with lock:
            acquired_event.set()
            await release_event.wait()

    async def waiter():
        await acquired_event.wait()
        lock = vault_file_lock(tmp_path)
        # Signal to release
        release_event.set()
        async with lock:
            second_acquired.set()

    await asyncio.gather(holder(), waiter())
    assert second_acquired.is_set()


@pytest.mark.anyio
async def test_no_git_fallback(tmp_path):
    # No .git directory — should fall back to vault root
    lock = vault_file_lock(tmp_path)

    async with lock:
        assert lock.is_locked
        lock_file = tmp_path / ".gsd.lock"
        assert lock_file.exists()


@pytest.mark.anyio
async def test_timeout_raises(tmp_path):
    (tmp_path / ".git").mkdir()

    lock1 = vault_file_lock(tmp_path, timeout=0.1)
    lock2 = vault_file_lock(tmp_path, timeout=0.1)

    async with lock1:
        with pytest.raises(Timeout):
            await lock2.acquire()
