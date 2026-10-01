"""Integration tests for KB sync, community catalog, and enhanced source endpoints.

Tests cover:
- Sync trigger (POST /sources/{id}/sync) returns 202
- Sync task status polling (GET /sync-tasks/{task_id})
- Sync re-indexes changes (direct service call)
- Community catalog listing (GET /community-catalog)
- Community source creation validation
- Auto-detect origin (git URL vs filesystem path)
- OPSEC warning with remote_url
- include_paths subdirectory filtering
- Error cases and authentication
"""

import os
import subprocess
import uuid
from pathlib import Path

import pytest
from httpx import AsyncClient

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


async def _create_project(
    client: AsyncClient, headers: dict
) -> dict:
    """Create a project and return its JSON response."""
    resp = await client.post(
        "/api/v1/projects",
        json={
            "name": f"Sync Test {uuid.uuid4().hex[:8]}",
            "type": "htb",
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_local_source(
    client: AsyncClient,
    headers: dict,
    project_id: str,
    vault_path: str,
    name: str = "Test Vault",
) -> dict:
    """Create a KB source via the API."""
    resp = await client.post(
        "/api/v1/kb/sources",
        json={
            "name": name,
            "source_type": "local",
            "path": vault_path,
            "project_id": project_id,
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _write_md(vault: Path, rel_path: str, content: str) -> Path:
    """Write a markdown file inside *vault* at *rel_path*."""
    target = vault / rel_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return target


def _git(*args, cwd=None):
    """Run a git command synchronously (for test setup)."""
    subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
        env=GIT_ENV,
    )


def _create_git_test_repo(tmp_path: Path) -> str:
    """Create bare repo + working copy with 3 .md files.

    Returns file:// URL to the bare repo.
    """
    bare = tmp_path / "remote.git"
    _git("init", "--bare", str(bare))

    work = tmp_path / "work_setup"
    _git("clone", str(bare), str(work))

    (work / "note1.md").write_text("# Note 1\nFirst note content.")
    (work / "note2.md").write_text("# Note 2\nSecond note content.")
    (work / "note3.md").write_text("# Note 3\nThird note content.")
    _git("add", ".", cwd=str(work))
    _git("commit", "-m", "initial: 3 notes", cwd=str(work))
    _git("push", cwd=str(work))

    return f"file://{bare}"


def _add_commit_to_remote(
    bare_url: str,
    tmp_path: Path,
    filename: str,
    content: str,
) -> None:
    """Clone bare repo, add a file, commit, and push."""
    work = tmp_path / f"work_push_{uuid.uuid4().hex[:8]}"
    _git("clone", bare_url, str(work))
    (work / filename).write_text(content)
    _git("add", ".", cwd=str(work))
    _git("commit", "-m", f"add {filename}", cwd=str(work))
    _git("push", cwd=str(work))


async def _setup_user_project(db):
    """Create prerequisite user and project for direct service tests."""
    user = User(
        username=f"syncuser_{uuid.uuid4().hex[:8]}",
        email=f"sync_{uuid.uuid4().hex[:8]}@example.com",
        password_hash="fakehash",
    )
    db.add(user)
    await db.flush()

    project = Project(
        name="Sync Router Test",
        slug=f"sync-rt-{uuid.uuid4().hex[:8]}",
        workspace_path="/tmp/sync-router-test",
    )
    db.add(project)
    await db.flush()
    return user, project


# ---------------------------------------------------------------------------
# 1. Sync endpoint returns 202
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_sync_endpoint_returns_202(
    client: AsyncClient, auth_headers: dict, tmp_path
):
    """POST /kb/sources/{id}/sync returns 202 with task_id."""
    project = await _create_project(client, auth_headers)
    vault = tmp_path / "sync_vault"
    vault.mkdir()
    _write_md(vault, "note.md", "---\ntitle: Note\n---\nContent")

    source = await _create_local_source(
        client, auth_headers, project["id"], str(vault)
    )

    resp = await client.post(
        f"/api/v1/kb/sources/{source['id']}/sync",
        headers=auth_headers,
    )
    assert resp.status_code == 202
    data = resp.json()
    assert "task_id" in data
    assert data["status"] == "pending"


# ---------------------------------------------------------------------------
# 2. Sync task status polling
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_sync_task_status_polling(
    client: AsyncClient, auth_headers: dict, tmp_path
):
    """GET /kb/sync-tasks/{task_id} returns task status."""
    project = await _create_project(client, auth_headers)
    vault = tmp_path / "poll_vault"
    vault.mkdir()
    _write_md(vault, "note.md", "---\ntitle: Note\n---\nContent")

    source = await _create_local_source(
        client, auth_headers, project["id"], str(vault)
    )

    # Trigger sync
    trigger_resp = await client.post(
        f"/api/v1/kb/sources/{source['id']}/sync",
        headers=auth_headers,
    )
    task_id = trigger_resp.json()["task_id"]

    # Poll status -- should return a valid task dict
    status_resp = await client.get(
        f"/api/v1/kb/sync-tasks/{task_id}",
        headers=auth_headers,
    )
    assert status_resp.status_code == 200
    task_data = status_resp.json()
    assert task_data["task_id"] == task_id
    assert "status" in task_data


# ---------------------------------------------------------------------------
# 3. Sync re-indexes changes (direct service call)
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_sync_reindexes_changes(test_db, tmp_path):
    """sync_source pulls new commits and re-indexes added files."""
    bare_url = _create_git_test_repo(tmp_path)

    # Clone for the source
    clone_dest = tmp_path / "cloned_vault"
    _git("clone", bare_url, str(clone_dest))
    _git("config", "pull.rebase", "false", cwd=str(clone_dest))

    # Create DB records
    user, project = await _setup_user_project(test_db)
    source = KnowledgeSource(
        name="Sync Test Vault",
        source_type="local",
        origin="git",
        path=str(clone_dest),
        user_id=user.id,
        project_id=project.id,
    )
    test_db.add(source)
    await test_db.commit()
    await test_db.refresh(source)

    # First index to establish baseline
    kb = KBService(test_db)
    await kb.index_vault(source.id, source.path)

    # Add a new file to the remote
    _add_commit_to_remote(
        bare_url, tmp_path, "new_note.md", "# New\nFresh content."
    )

    # Sync should pull + re-index
    sync_svc = SyncService(test_db)
    stats = await sync_svc.sync_source(source.id)

    assert stats["added"] == 1


# ---------------------------------------------------------------------------
# 4. Community catalog returns entries
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_community_catalog_returns_entries(
    client: AsyncClient, auth_headers: dict
):
    """GET /kb/community-catalog returns 200 with 5+ entries."""
    resp = await client.get(
        "/api/v1/kb/community-catalog",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 5

    # Each entry has required fields
    for entry in data:
        assert "slug" in entry
        assert "name" in entry
        assert "url" in entry


# ---------------------------------------------------------------------------
# 5. Community source slug not found
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_add_community_source_invalid_slug_returns_error(
    client: AsyncClient, auth_headers: dict
):
    """POST /kb/sources/community with nonexistent slug returns 404."""
    project = await _create_project(client, auth_headers)
    resp = await client.post(
        "/api/v1/kb/sources/community",
        json={
            "project_id": project["id"],
            "slug": "nonexistent-slug",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# 6. Auto-detect git origin
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_create_source_auto_detects_git_origin(
    client: AsyncClient, auth_headers: dict
):
    """POST /kb/sources with git URL path auto-detects origin='git'."""
    project = await _create_project(client, auth_headers)
    resp = await client.post(
        "/api/v1/kb/sources",
        json={
            "name": "Git Source",
            "source_type": "local",
            "path": "https://github.com/user/repo.git",
            "project_id": project["id"],
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["origin"] == "git"


# ---------------------------------------------------------------------------
# 7. Auto-detect filesystem origin
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_create_source_auto_detects_filesystem_origin(
    client: AsyncClient, auth_headers: dict
):
    """POST /kb/sources with local path auto-detects origin='filesystem'."""
    project = await _create_project(client, auth_headers)
    resp = await client.post(
        "/api/v1/kb/sources",
        json={
            "name": "Local Source",
            "source_type": "local",
            "path": "/tmp/vault",
            "project_id": project["id"],
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["origin"] == "filesystem"


# ---------------------------------------------------------------------------
# 8. Default no remote URL
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_create_source_default_no_remote_url(
    client: AsyncClient, auth_headers: dict
):
    """POST /kb/sources without remote_url has null remote and no warning."""
    project = await _create_project(client, auth_headers)
    resp = await client.post(
        "/api/v1/kb/sources",
        json={
            "name": "Safe Source",
            "source_type": "local",
            "path": "/tmp/vault",
            "project_id": project["id"],
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["remote_url"] is None
    assert data["opsec_warning"] is None


# ---------------------------------------------------------------------------
# 9. Remote URL triggers OPSEC warning
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_create_source_with_remote_url_has_opsec_warning(
    client: AsyncClient, auth_headers: dict
):
    """POST /kb/sources with remote_url includes OPSEC warning."""
    project = await _create_project(client, auth_headers)
    resp = await client.post(
        "/api/v1/kb/sources",
        json={
            "name": "Remote Source",
            "source_type": "local",
            "path": "/tmp/vault",
            "remote_url": "https://github.com/user/repo.git",
            "project_id": project["id"],
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["opsec_warning"] is not None
    assert "WARNING" in data["opsec_warning"]


# ---------------------------------------------------------------------------
# 10. index_vault respects include_paths
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_index_vault_respects_include_paths(
    test_db, tmp_path
):
    """index_vault with include_paths only indexes specified subdirs."""
    vault = tmp_path / "filter_vault"
    vault.mkdir()

    # Create two subdirectories
    _write_md(vault, "subdir_a/a1.md", "---\ntitle: A1\n---\nAlpha one")
    _write_md(vault, "subdir_a/a2.md", "---\ntitle: A2\n---\nAlpha two")
    _write_md(
        vault, "subdir_a/a3.md", "---\ntitle: A3\n---\nAlpha three"
    )
    _write_md(vault, "subdir_b/b1.md", "---\ntitle: B1\n---\nBravo one")
    _write_md(vault, "subdir_b/b2.md", "---\ntitle: B2\n---\nBravo two")

    # Create DB records
    user, project = await _setup_user_project(test_db)
    source = KnowledgeSource(
        name="Filter Vault",
        source_type="local",
        origin="filesystem",
        path=str(vault),
        include_paths=["subdir_a"],
        user_id=user.id,
        project_id=project.id,
    )
    test_db.add(source)
    await test_db.commit()
    await test_db.refresh(source)

    # Index with include_paths
    kb = KBService(test_db)
    stats = await kb.index_vault(
        source.id, str(vault), include_paths=["subdir_a"]
    )

    # Only subdir_a files should be indexed (3, not 5)
    assert stats["added"] == 3
    assert stats["errors"] == []


# ---------------------------------------------------------------------------
# 11. Sync task not found
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_sync_task_not_found_returns_error(
    client: AsyncClient, auth_headers: dict
):
    """GET /kb/sync-tasks/nonexistent returns error."""
    resp = await client.get(
        "/api/v1/kb/sync-tasks/nonexistent-id",
        headers=auth_headers,
    )
    # KB_SYNC_FAILED maps to 500 in the exception handler
    assert resp.status_code == 500


# ---------------------------------------------------------------------------
# 12. Unauthenticated sync returns 401
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_unauthenticated_sync_returns_401(
    client: AsyncClient, auth_headers: dict, tmp_path
):
    """POST /kb/sources/{id}/sync without auth returns 401."""
    project = await _create_project(client, auth_headers)
    vault = tmp_path / "noauth_vault"
    vault.mkdir()
    _write_md(vault, "note.md", "---\ntitle: Note\n---\nContent")

    source = await _create_local_source(
        client, auth_headers, project["id"], str(vault)
    )

    # Call without auth headers
    resp = await client.post(
        f"/api/v1/kb/sources/{source['id']}/sync",
    )
    assert resp.status_code == 401
