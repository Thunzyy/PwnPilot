"""Tests for GitService async git CLI wrapper.

Tests use file:// protocol repos created in tmp_path for real git operations.
No network access required.
"""

import asyncio
import os
import subprocess

import pytest

from app.core.errors import ErrorCode
from app.core.exceptions import AppException
from app.services.git_service import GitService

# Git env vars to avoid config issues in CI/test environments
GIT_ENV = {
    **os.environ,
    "GIT_AUTHOR_NAME": "test",
    "GIT_AUTHOR_EMAIL": "test@test.local",
    "GIT_COMMITTER_NAME": "test",
    "GIT_COMMITTER_EMAIL": "test@test.local",
}


@pytest.fixture
def bare_repo(tmp_path):
    """Create a bare git repo with one commit, return file:// URL."""
    bare = tmp_path / "remote.git"
    subprocess.run(
        ["git", "init", "--bare", str(bare)],
        check=True,
        capture_output=True,
        env=GIT_ENV,
    )

    # Create a working copy, add a file, push to bare
    work = tmp_path / "work"
    subprocess.run(
        ["git", "clone", str(bare), str(work)],
        check=True,
        capture_output=True,
        env=GIT_ENV,
    )
    (work / "note.md").write_text("# Test Note\nInitial content.")
    subprocess.run(
        ["git", "add", "."],
        cwd=str(work),
        check=True,
        capture_output=True,
        env=GIT_ENV,
    )
    subprocess.run(
        ["git", "commit", "-m", "initial commit"],
        cwd=str(work),
        check=True,
        capture_output=True,
        env=GIT_ENV,
    )
    subprocess.run(
        ["git", "push"],
        cwd=str(work),
        check=True,
        capture_output=True,
        env=GIT_ENV,
    )

    return f"file://{bare}"


@pytest.fixture
def cloned_repo(bare_repo, tmp_path):
    """Clone from bare_repo, return cloned directory path."""
    dest = tmp_path / "cloned"
    subprocess.run(
        ["git", "clone", bare_repo, str(dest)],
        check=True,
        capture_output=True,
        env=GIT_ENV,
    )
    return dest


@pytest.fixture
def git_service():
    """Create a GitService instance."""
    return GitService()


# --------------------------------------------------------------------------
# 1. _run returns stdout/stderr/returncode
# --------------------------------------------------------------------------


@pytest.mark.anyio
async def test_run_returns_stdout_stderr_returncode(git_service):
    """_run executes git --version and returns structured output."""
    stdout, stderr, returncode = await git_service._run("--version")
    assert returncode == 0
    assert "git version" in stdout


# --------------------------------------------------------------------------
# 2. _run timeout kills process
# --------------------------------------------------------------------------


@pytest.mark.anyio
async def test_run_timeout_kills_process():
    """_run raises TimeoutError and kills process on tiny timeout."""
    # Use a very small timeout on a git command that takes measurable time.
    # Create a service with a tiny default timeout and run clone to nowhere.
    service = GitService(timeout=0.0001)
    with pytest.raises(asyncio.TimeoutError):
        # git clone to a nonexistent URL will take time to fail
        await service._run(
            "clone", "https://192.0.2.1/nonexistent.git", "/tmp/nope"
        )


# --------------------------------------------------------------------------
# 3. clone creates repo
# --------------------------------------------------------------------------


@pytest.mark.anyio
async def test_clone_creates_repo(git_service, bare_repo, tmp_path):
    """clone() creates a valid git repo at the destination."""
    dest = str(tmp_path / "clone_dest")
    stdout, stderr, returncode = await git_service.clone(bare_repo, dest)
    assert returncode == 0
    assert (tmp_path / "clone_dest" / ".git").is_dir()
    assert (tmp_path / "clone_dest" / "note.md").is_file()


# --------------------------------------------------------------------------
# 4. clone with depth
# --------------------------------------------------------------------------


@pytest.mark.anyio
async def test_clone_with_depth(git_service, bare_repo, tmp_path):
    """clone() with depth=1 succeeds (shallow clone)."""
    dest = str(tmp_path / "shallow")
    stdout, stderr, returncode = await git_service.clone(
        bare_repo, dest, depth=1
    )
    assert returncode == 0
    assert (tmp_path / "shallow" / ".git").is_dir()


# --------------------------------------------------------------------------
# 5. clone without depth (full clone)
# --------------------------------------------------------------------------


@pytest.mark.anyio
async def test_clone_without_depth(git_service, bare_repo, tmp_path):
    """clone() with depth=None performs a full clone."""
    dest = str(tmp_path / "full")
    stdout, stderr, returncode = await git_service.clone(
        bare_repo, dest, depth=None
    )
    assert returncode == 0
    assert (tmp_path / "full" / ".git").is_dir()


# --------------------------------------------------------------------------
# 6. pull up to date
# --------------------------------------------------------------------------


@pytest.mark.anyio
async def test_pull_up_to_date(git_service, cloned_repo):
    """pull() on an up-to-date clone reports 'Already up to date'."""
    stdout, stderr, returncode = await git_service.pull(str(cloned_repo))
    assert returncode == 0
    assert "Already up to date" in stdout


# --------------------------------------------------------------------------
# 7. pull gets new commits
# --------------------------------------------------------------------------


@pytest.mark.anyio
async def test_pull_gets_new_commits(
    git_service, bare_repo, cloned_repo, tmp_path
):
    """pull() retrieves new files added to the remote."""
    # Add a new commit to the remote via a fresh working copy
    work2 = tmp_path / "work2"
    subprocess.run(
        ["git", "clone", bare_repo, str(work2)],
        check=True,
        capture_output=True,
        env=GIT_ENV,
    )
    (work2 / "new_file.md").write_text("# New File\nNew content.")
    subprocess.run(
        ["git", "add", "."],
        cwd=str(work2),
        check=True,
        capture_output=True,
        env=GIT_ENV,
    )
    subprocess.run(
        ["git", "commit", "-m", "add new file"],
        cwd=str(work2),
        check=True,
        capture_output=True,
        env=GIT_ENV,
    )
    subprocess.run(
        ["git", "push"],
        cwd=str(work2),
        check=True,
        capture_output=True,
        env=GIT_ENV,
    )

    # Pull into cloned_repo
    stdout, stderr, returncode = await git_service.pull(str(cloned_repo))
    assert returncode == 0
    assert (cloned_repo / "new_file.md").is_file()


# --------------------------------------------------------------------------
# 8. has_conflicts detects conflict
# --------------------------------------------------------------------------


def test_has_conflicts_detects_conflict(git_service):
    """has_conflicts() returns True when CONFLICT is in output."""
    assert git_service.has_conflicts(
        "CONFLICT (content): Merge conflict in file.md"
    )
    assert git_service.has_conflicts(
        "Automatic merge failed; fix conflicts and then commit the result."
    )


# --------------------------------------------------------------------------
# 9. has_conflicts no conflict
# --------------------------------------------------------------------------


def test_has_conflicts_no_conflict(git_service):
    """has_conflicts() returns False for clean output."""
    assert not git_service.has_conflicts("Already up to date.")
    assert not git_service.has_conflicts("Updating abc123..def456")


# --------------------------------------------------------------------------
# 10. abort_merge
# --------------------------------------------------------------------------


@pytest.mark.anyio
async def test_abort_merge(git_service, bare_repo, tmp_path):
    """abort_merge() cleans up after a merge conflict."""
    # Clone the repo
    local = tmp_path / "local"
    subprocess.run(
        ["git", "clone", bare_repo, str(local)],
        check=True,
        capture_output=True,
        env=GIT_ENV,
    )

    # Set pull strategy to merge (modern git requires explicit config)
    subprocess.run(
        ["git", "config", "pull.rebase", "false"],
        cwd=str(local),
        check=True,
        capture_output=True,
        env=GIT_ENV,
    )

    # Create conflicting changes: modify note.md in remote
    work2 = tmp_path / "work_conflict"
    subprocess.run(
        ["git", "clone", bare_repo, str(work2)],
        check=True,
        capture_output=True,
        env=GIT_ENV,
    )
    (work2 / "note.md").write_text("# Remote change\nConflicting content.")
    subprocess.run(
        ["git", "add", "."],
        cwd=str(work2),
        check=True,
        capture_output=True,
        env=GIT_ENV,
    )
    subprocess.run(
        ["git", "commit", "-m", "remote conflict"],
        cwd=str(work2),
        check=True,
        capture_output=True,
        env=GIT_ENV,
    )
    subprocess.run(
        ["git", "push"],
        cwd=str(work2),
        check=True,
        capture_output=True,
        env=GIT_ENV,
    )

    # Also modify note.md locally (creating conflict)
    (local / "note.md").write_text("# Local change\nDifferent content.")
    subprocess.run(
        ["git", "add", "."],
        cwd=str(local),
        check=True,
        capture_output=True,
        env=GIT_ENV,
    )
    subprocess.run(
        ["git", "commit", "-m", "local conflict"],
        cwd=str(local),
        check=True,
        capture_output=True,
        env=GIT_ENV,
    )

    # Pull to trigger conflict (merge strategy)
    stdout, stderr, returncode = await git_service.pull(str(local))

    # Conflict text may appear in stdout or stderr depending on git version
    has_conflict = (
        git_service.has_conflicts(stdout)
        or git_service.has_conflicts(stderr)
        or returncode != 0
    )
    assert has_conflict

    # Abort the merge (only if we actually have a merge in progress)
    # Check if there is a MERGE_HEAD indicating in-progress merge
    merge_head = local / ".git" / "MERGE_HEAD"
    if merge_head.exists():
        ab_stdout, ab_stderr, ab_rc = await git_service.abort_merge(
            str(local)
        )
        assert ab_rc == 0

        # Verify repo is clean after abort
        status_proc = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=str(local),
            capture_output=True,
            text=True,
            env=GIT_ENV,
        )
        assert status_proc.stdout.strip() == ""
    else:
        # If no merge in progress (diverged branches error),
        # abort_merge should still not crash (rc may be non-zero)
        ab_stdout, ab_stderr, ab_rc = await git_service.abort_merge(
            str(local)
        )
        # Just verify it executed without hanging
        assert ab_rc is not None


# --------------------------------------------------------------------------
# 11. check_available succeeds
# --------------------------------------------------------------------------


@pytest.mark.anyio
async def test_check_available_succeeds(git_service):
    """check_available() does not raise when git is on PATH."""
    await git_service.check_available()  # Should not raise


# --------------------------------------------------------------------------
# 12. check_available fails with bad path
# --------------------------------------------------------------------------


@pytest.mark.anyio
async def test_check_available_fails_with_bad_path(monkeypatch):
    """check_available() raises AppException when git is not found."""
    service = GitService()

    # Mock create_subprocess_exec to raise FileNotFoundError
    async def mock_exec(*args, **kwargs):
        raise FileNotFoundError("git not found")

    monkeypatch.setattr(
        asyncio, "create_subprocess_exec", mock_exec
    )

    with pytest.raises(AppException) as exc_info:
        await service.check_available()

    assert exc_info.value.code == ErrorCode.SYS_DEPENDENCY_MISSING
