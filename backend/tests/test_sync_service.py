"""Tests for SyncService — git sync orchestration with dual-layer locking.

Tests use file:// protocol repos created in tmp_path for real git operations.
No network access required. Tests verify sync_source (lock -> pull -> conflict
detect -> re-index) and clone_source (skip-if-exists -> clone with depth).
"""

import asyncio
import os
import subprocess
import uuid
import tempfile
from pathlib import Path

import pytest

from app.core.errors import ErrorCode
from app.core.exceptions import AppException
from app.models.knowledge import KnowledgeSource
from app.models.project import Project
from app.models.user import User
from app.services.kb_service import KBService
from app.services.sync_service import SyncService

# Git env vars to avoid config issues in CI/test environments
GIT_ENV = {
    **os.environ,
    "GIT_AUTHOR_NAME": "test",
    "GIT_AUTHOR_EMAIL": "test@test.local",
    "GIT_COMMITTER_NAME": "test",
    "GIT_COMMITTER_EMAIL": "test@test.local",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _setup_user_project(db):
    """Create prerequisite user and project for sync tests."""
    user = User(
        username=f"syncuser_{uuid.uuid4().hex[:8]}",
        email=f"sync_{uuid.uuid4().hex[:8]}@example.com",
        password_hash="fakehash",
    )
    db.add(user)
    await db.flush()

    project = Project(
        name="Sync Test Project",
        slug=f"sync-test-{uuid.uuid4().hex[:8]}",
        workspace_path="/tmp/sync-test",
    )
    db.add(project)
    await db.flush()
    return user, project


async def _create_source(
    db, user, project, vault_path: str, source_type: str = "local"
) -> KnowledgeSource:
    """Create a KnowledgeSource pointing at *vault_path*."""
    source = KnowledgeSource(
        name="Test Vault",
        source_type=source_type,
        origin="git",
        path=vault_path,
        user_id=user.id,
        project_id=project.id,
    )
    db.add(source)
    await db.commit()
    await db.refresh(source)
    return source


def _git(*args, cwd=None):
    """Run a git command synchronously (for test setup)."""
    subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
        env=GIT_ENV,
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def bare_repo(tmp_path):
    """Create a bare git repo with 3 .md files committed, return file:// URL."""
    bare = tmp_path / "remote.git"
    _git("init", "--bare", str(bare))

    # Create working copy, add files, push to bare
    work = tmp_path / "work"
    _git("clone", str(bare), str(work))

    (work / "note1.md").write_text("# Note 1\nFirst note content.")
    (work / "note2.md").write_text("# Note 2\nSecond note content.")
    (work / "note3.md").write_text("# Note 3\nThird note content.")
    _git("add", ".", cwd=str(work))
    _git("commit", "-m", "initial: 3 notes", cwd=str(work))
    _git("push", cwd=str(work))

    return f"file://{bare}"


@pytest.fixture
async def cloned_source(bare_repo, tmp_path, test_db):
    """Clone from bare repo, create KnowledgeSource in DB, return source."""
    clone_dest = tmp_path / "cloned_vault"
    _git("clone", bare_repo, str(clone_dest))

    # Set pull strategy to merge (modern git requires explicit config)
    _git("config", "pull.rebase", "false", cwd=str(clone_dest))

    user, project = await _setup_user_project(test_db)
    source = await _create_source(
        test_db, user, project, str(clone_dest)
    )
    return source


# --------------------------------------------------------------------------
# 1. sync_source pulls and re-indexes
# --------------------------------------------------------------------------


@pytest.mark.anyio
async def test_sync_source_pulls_and_reindexes(
    cloned_source, bare_repo, tmp_path, test_db
):
    """sync_source pulls new commits and re-indexes changed files."""
    # First index the vault so we have a baseline
    kb = KBService(test_db)
    await kb.index_vault(cloned_source.id, cloned_source.path)

    # Add a new file to the remote
    work2 = tmp_path / "work_push"
    _git("clone", bare_repo, str(work2))
    (work2 / "new_note.md").write_text("# New Note\nFresh content.")
    _git("add", ".", cwd=str(work2))
    _git("commit", "-m", "add new note", cwd=str(work2))
    _git("push", cwd=str(work2))

    # Sync should pull the new file and re-index
    service = SyncService(test_db)
    stats = await service.sync_source(cloned_source.id)

    assert stats["added"] == 1
    assert cloned_source.last_synced_at is not None


# --------------------------------------------------------------------------
# 2. sync_source updates sync_status
# --------------------------------------------------------------------------


@pytest.mark.anyio
async def test_sync_source_updates_sync_status(
    cloned_source, test_db
):
    """sync_source sets sync_status to 'completed' after success."""
    service = SyncService(test_db)
    await service.sync_source(cloned_source.id)

    await test_db.refresh(cloned_source)
    assert cloned_source.sync_status == "completed"


# --------------------------------------------------------------------------
# 3. sync_source detects no changes
# --------------------------------------------------------------------------


@pytest.mark.anyio
async def test_sync_source_detects_no_changes(
    cloned_source, test_db
):
    """sync_source with no remote changes reports zero adds/updates/deletes."""
    # First index to establish baseline
    kb = KBService(test_db)
    await kb.index_vault(cloned_source.id, cloned_source.path)

    # Sync with no new remote commits
    service = SyncService(test_db)
    stats = await service.sync_source(cloned_source.id)

    assert stats["added"] == 0
    assert stats["updated"] == 0
    assert stats["deleted"] == 0


# --------------------------------------------------------------------------
# 4. sync_source conflict aborts and raises
# --------------------------------------------------------------------------


@pytest.mark.anyio
async def test_sync_source_conflict_aborts_and_raises(
    cloned_source, bare_repo, tmp_path, test_db
):
    """Merge conflict triggers abort and raises KB_SYNC_FAILED."""
    # Modify note1.md in a fresh clone and push to remote
    work2 = tmp_path / "work_conflict"
    _git("clone", bare_repo, str(work2))
    (work2 / "note1.md").write_text("# Remote Edit\nRemote content.")
    _git("add", ".", cwd=str(work2))
    _git("commit", "-m", "remote edit note1", cwd=str(work2))
    _git("push", cwd=str(work2))

    # Modify note1.md locally in the cloned source (creating conflict)
    local_path = Path(cloned_source.path)
    (local_path / "note1.md").write_text("# Local Edit\nLocal content.")
    _git("add", ".", cwd=str(local_path))
    _git("commit", "-m", "local edit note1", cwd=str(local_path))

    # Sync should detect conflict, abort merge, and raise
    service = SyncService(test_db)
    with pytest.raises(AppException) as exc_info:
        await service.sync_source(cloned_source.id)

    assert exc_info.value.code == ErrorCode.KB_SYNC_FAILED

    # Verify repo is clean (no MERGE_HEAD)
    merge_head = local_path / ".git" / "MERGE_HEAD"
    assert not merge_head.exists(), "MERGE_HEAD should be cleaned up"


# --------------------------------------------------------------------------
# 5. sync_source non-zero returncode raises
# --------------------------------------------------------------------------


@pytest.mark.anyio
async def test_sync_source_non_zero_returncode_raises(
    test_db
):
    """sync_source raises KB_SYNC_FAILED when git pull returns non-zero."""
    # Create a source pointing at a non-git directory
    user, project = await _setup_user_project(test_db)
    with tempfile.TemporaryDirectory(prefix="pp-sync-test-") as root:
        non_git_dir = Path(root) / "not_a_repo"
        non_git_dir.mkdir()

        source = await _create_source(
            test_db, user, project, str(non_git_dir)
        )

        service = SyncService(test_db)
        with pytest.raises(AppException) as exc_info:
            await service.sync_source(source.id)

        assert exc_info.value.code == ErrorCode.KB_SYNC_FAILED


# --------------------------------------------------------------------------
# 6. clone_source creates repo
# --------------------------------------------------------------------------


@pytest.mark.anyio
async def test_clone_source_creates_repo(bare_repo, tmp_path, test_db):
    """clone_source creates a valid git repo at the destination."""
    dest = str(tmp_path / "clone_dest")
    service = SyncService(test_db)
    await service.clone_source(bare_repo, dest)

    assert (Path(dest) / ".git").is_dir()
    assert (Path(dest) / "note1.md").is_file()


# --------------------------------------------------------------------------
# 7. clone_source depth 1 for community
# --------------------------------------------------------------------------


@pytest.mark.anyio
async def test_clone_source_depth_1_for_community(
    bare_repo, tmp_path, test_db
):
    """Community sources are cloned with depth=1 (shallow clone)."""
    dest = str(tmp_path / "community_clone")
    service = SyncService(test_db)
    await service.clone_source(bare_repo, dest, depth=1)

    assert (Path(dest) / ".git").is_dir()


# --------------------------------------------------------------------------
# 8. clone_source full clone for local
# --------------------------------------------------------------------------


@pytest.mark.anyio
async def test_clone_source_full_clone_for_local(
    bare_repo, tmp_path, test_db
):
    """Local sources are cloned without depth (full clone)."""
    dest = str(tmp_path / "full_clone")
    service = SyncService(test_db)
    await service.clone_source(bare_repo, dest, depth=None)

    assert (Path(dest) / ".git").is_dir()


# --------------------------------------------------------------------------
# 9. clone_source skips if already cloned
# --------------------------------------------------------------------------


@pytest.mark.anyio
async def test_clone_source_skips_if_already_cloned(
    bare_repo, tmp_path, test_db
):
    """Second clone_source call skips gracefully when .git exists."""
    dest = str(tmp_path / "skip_clone")

    service = SyncService(test_db)
    # First clone
    await service.clone_source(bare_repo, dest)

    assert (Path(dest) / ".git").is_dir()

    # Second clone should NOT raise
    await service.clone_source(bare_repo, dest)

    # Repo should still be intact
    assert (Path(dest) / "note1.md").is_file()


# --------------------------------------------------------------------------
# 10. concurrent syncs serialized
# --------------------------------------------------------------------------


@pytest.mark.anyio
async def test_concurrent_syncs_serialized(
    bare_repo, tmp_path
):
    """5 concurrent sync_source calls are serialized without errors."""
    from sqlalchemy.ext.asyncio import (
        async_sessionmaker,
        create_async_engine,
    )

    from app.database import Base, init_fts_tables

    # Use a file-based SQLite DB so multiple sessions share state
    db_path = tmp_path / "concurrent.db"
    db_url = f"sqlite+aiosqlite:///{db_path}"
    engine = create_async_engine(db_url, echo=False)
    session_maker = async_sessionmaker(engine, expire_on_commit=False)

    # Create tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await init_fts_tables(conn)

    # Set up user, project, source, and clone
    clone_dest = tmp_path / "concurrent_vault"
    _git("clone", bare_repo, str(clone_dest))
    _git("config", "pull.rebase", "false", cwd=str(clone_dest))

    async with session_maker() as setup_db:
        user, project = await _setup_user_project(setup_db)
        source = await _create_source(
            setup_db, user, project, str(clone_dest)
        )
        source_id = source.id

    async def do_sync():
        # Each concurrent sync gets its own fresh DB session
        async with session_maker() as session:
            service = SyncService(session)
            return await service.sync_source(source_id)

    # Launch 5 concurrent syncs
    results = await asyncio.gather(
        *[do_sync() for _ in range(5)],
        return_exceptions=True,
    )

    # All 5 should complete without errors
    for i, result in enumerate(results):
        assert not isinstance(result, Exception), (
            f"Sync {i} failed: {result}"
        )

    # No stale index.lock file should remain
    index_lock = clone_dest / ".git" / "index.lock"
    assert not index_lock.exists(), "index.lock should not remain"

    # Clean up engine
    await engine.dispose()
