"""Tests for KB rename endpoint — POST /kb/documents/{doc_id}/rename.

Covers: rename_doc service method, wikilink cascade, collision checks,
read-only guards, path traversal sanitization, frontmatter title update,
and full HTTP integration.
"""

import textwrap
from pathlib import Path

import pytest
from httpx import AsyncClient

from app.core.exceptions import AppException
from app.models.knowledge import KnowledgeDoc, KnowledgeSource
from app.models.project import Project
from app.models.user import User
from app.services.kb_service import KBService


# ---------------------------------------------------------------------------
# Helpers (same pattern as test_kb_service.py)
# ---------------------------------------------------------------------------


async def _setup_user_project(db):
    """Create prerequisite user and project for KB tests."""
    user = User(
        username="renameuser",
        email="rename@example.com",
        password_hash="fakehash",
    )
    db.add(user)
    await db.flush()

    project = Project(
        name="Rename Test Project",
        slug="rename-test",
        workspace_path="/tmp/rename-test",
    )
    db.add(project)
    await db.flush()
    return user, project


async def _create_source(
    db, user, project, vault_path: str, *, read_only: bool = False
) -> KnowledgeSource:
    """Create a KnowledgeSource pointing at *vault_path*."""
    source = KnowledgeSource(
        name="Test Vault",
        source_type="local",
        origin="filesystem",
        path=vault_path,
        read_only=read_only,
        user_id=user.id,
        project_id=project.id,
    )
    db.add(source)
    await db.commit()
    await db.refresh(source)
    return source


def _write_md(vault: Path, rel_path: str, content: str) -> Path:
    """Write a markdown file inside *vault* at *rel_path*."""
    target = vault / rel_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return target


# ---------------------------------------------------------------------------
# Service-level tests
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_rename_doc_updates_file_and_db(test_db, tmp_path):
    """Basic rename: file is moved on disk, DB row path and title updated."""
    user, project = await _setup_user_project(test_db)
    vault = tmp_path / "vault"
    vault.mkdir()
    _write_md(vault, "nmap.md", "---\ntitle: nmap\n---\nNmap scan guide")

    source = await _create_source(test_db, user, project, str(vault))
    service = KBService(test_db)
    await service.index_vault(source.id, str(vault))

    # Get doc
    docs = (await test_db.execute(
        __import__("sqlalchemy").select(KnowledgeDoc).where(
            KnowledgeDoc.source_id == source.id
        )
    )).scalars().all()
    doc = docs[0]
    old_id = doc.id

    # Rename
    renamed_doc, refs = await service.rename_doc(doc.id, "nmap-guide")

    # UUID preserved
    assert renamed_doc.id == old_id

    # DB row updated
    assert renamed_doc.relative_path == "nmap-guide.md"
    assert renamed_doc.title == "nmap-guide"

    # Old file gone, new file exists
    assert not (vault / "nmap.md").exists()
    assert (vault / "nmap-guide.md").exists()


@pytest.mark.anyio
async def test_rename_doc_updates_frontmatter_title(test_db, tmp_path):
    """Frontmatter title field in the file is updated after rename."""
    user, project = await _setup_user_project(test_db)
    vault = tmp_path / "vault"
    vault.mkdir()
    _write_md(vault, "old-name.md", "---\ntitle: old-name\n---\nContent here")

    source = await _create_source(test_db, user, project, str(vault))
    service = KBService(test_db)
    await service.index_vault(source.id, str(vault))

    docs = (await test_db.execute(
        __import__("sqlalchemy").select(KnowledgeDoc).where(
            KnowledgeDoc.source_id == source.id
        )
    )).scalars().all()
    doc = docs[0]

    await service.rename_doc(doc.id, "new-name")

    # Read the new file and check frontmatter
    new_content = (vault / "new-name.md").read_text(encoding="utf-8")
    assert "title: new-name" in new_content


@pytest.mark.anyio
async def test_rename_doc_cascades_wikilinks(test_db, tmp_path):
    """Wikilinks [[old_stem]] in other docs are updated to [[new_stem]]."""
    user, project = await _setup_user_project(test_db)
    vault = tmp_path / "vault"
    vault.mkdir()
    _write_md(vault, "nmap.md", "---\ntitle: nmap\n---\nNmap tool guide")
    _write_md(
        vault, "recon.md",
        "---\ntitle: recon\n---\nSee [[nmap]] for port scanning."
    )

    source = await _create_source(test_db, user, project, str(vault))
    service = KBService(test_db)
    await service.index_vault(source.id, str(vault))

    # Find the nmap doc
    docs = (await test_db.execute(
        __import__("sqlalchemy").select(KnowledgeDoc).where(
            KnowledgeDoc.relative_path == "nmap.md"
        )
    )).scalars().all()
    nmap_doc = docs[0]

    _, refs_updated = await service.rename_doc(nmap_doc.id, "nmap-guide")

    assert refs_updated == 1

    # Verify the recon.md file on disk was updated
    recon_content = (vault / "recon.md").read_text(encoding="utf-8")
    assert "[[nmap-guide]]" in recon_content
    assert "[[nmap]]" not in recon_content


@pytest.mark.anyio
async def test_rename_doc_cascades_wikilinks_with_display_text(
    test_db, tmp_path
):
    """Wikilinks [[old_stem|Display]] become [[new_stem|Display]]."""
    user, project = await _setup_user_project(test_db)
    vault = tmp_path / "vault"
    vault.mkdir()
    _write_md(vault, "nmap.md", "---\ntitle: nmap\n---\nNmap tool")
    _write_md(
        vault, "overview.md",
        "---\ntitle: overview\n---\nUse [[nmap|Nmap Tool]] for scanning."
    )

    source = await _create_source(test_db, user, project, str(vault))
    service = KBService(test_db)
    await service.index_vault(source.id, str(vault))

    docs = (await test_db.execute(
        __import__("sqlalchemy").select(KnowledgeDoc).where(
            KnowledgeDoc.relative_path == "nmap.md"
        )
    )).scalars().all()
    nmap_doc = docs[0]

    _, refs_updated = await service.rename_doc(nmap_doc.id, "nmap-guide")

    assert refs_updated == 1
    overview_content = (vault / "overview.md").read_text(encoding="utf-8")
    assert "[[nmap-guide|Nmap Tool]]" in overview_content
    assert "[[nmap|" not in overview_content


@pytest.mark.anyio
async def test_rename_doc_cascade_case_insensitive(test_db, tmp_path):
    """Wikilinks [[Nmap]] (different case) are also updated."""
    user, project = await _setup_user_project(test_db)
    vault = tmp_path / "vault"
    vault.mkdir()
    _write_md(vault, "nmap.md", "---\ntitle: nmap\n---\nNmap guide")
    _write_md(
        vault, "notes.md",
        "---\ntitle: notes\n---\nSee [[Nmap]] for details."
    )

    source = await _create_source(test_db, user, project, str(vault))
    service = KBService(test_db)
    await service.index_vault(source.id, str(vault))

    docs = (await test_db.execute(
        __import__("sqlalchemy").select(KnowledgeDoc).where(
            KnowledgeDoc.relative_path == "nmap.md"
        )
    )).scalars().all()
    nmap_doc = docs[0]

    _, refs_updated = await service.rename_doc(nmap_doc.id, "nmap-guide")

    assert refs_updated == 1
    notes_content = (vault / "notes.md").read_text(encoding="utf-8")
    assert "[[nmap-guide]]" in notes_content
    assert "[[Nmap]]" not in notes_content


@pytest.mark.anyio
async def test_rename_doc_collision_returns_409(test_db, tmp_path):
    """Renaming to an existing filename raises KB_DOC_RENAME_COLLISION."""
    user, project = await _setup_user_project(test_db)
    vault = tmp_path / "vault"
    vault.mkdir()
    _write_md(vault, "nmap.md", "---\ntitle: nmap\n---\nNmap")
    _write_md(vault, "gobuster.md", "---\ntitle: gobuster\n---\nGobuster")

    source = await _create_source(test_db, user, project, str(vault))
    service = KBService(test_db)
    await service.index_vault(source.id, str(vault))

    docs = (await test_db.execute(
        __import__("sqlalchemy").select(KnowledgeDoc).where(
            KnowledgeDoc.relative_path == "nmap.md"
        )
    )).scalars().all()
    nmap_doc = docs[0]

    with pytest.raises(AppException) as exc_info:
        await service.rename_doc(nmap_doc.id, "gobuster")

    assert "KB_DOC_RENAME_COLLISION" in exc_info.value.code


@pytest.mark.anyio
async def test_rename_doc_read_only_returns_403(test_db, tmp_path):
    """Renaming in a read-only source raises KB_DOC_READ_ONLY."""
    user, project = await _setup_user_project(test_db)
    vault = tmp_path / "vault"
    vault.mkdir()
    _write_md(vault, "nmap.md", "---\ntitle: nmap\n---\nNmap")

    source = await _create_source(
        test_db, user, project, str(vault), read_only=True
    )
    service = KBService(test_db)
    await service.index_vault(source.id, str(vault))

    docs = (await test_db.execute(
        __import__("sqlalchemy").select(KnowledgeDoc).where(
            KnowledgeDoc.source_id == source.id
        )
    )).scalars().all()
    doc = docs[0]

    with pytest.raises(AppException) as exc_info:
        await service.rename_doc(doc.id, "new-name")

    assert "KB_DOC_READ_ONLY" in exc_info.value.code


@pytest.mark.anyio
async def test_rename_doc_not_found_returns_404(test_db):
    """Renaming a nonexistent doc raises KB_DOC_NOT_FOUND."""
    service = KBService(test_db)

    with pytest.raises(AppException) as exc_info:
        await service.rename_doc("nonexistent-id", "whatever")

    assert "KB_DOC_NOT_FOUND" in exc_info.value.code


@pytest.mark.anyio
async def test_rename_doc_path_traversal_sanitized(test_db, tmp_path):
    """Path traversal in new_title is sanitized by sanitize_filename."""
    user, project = await _setup_user_project(test_db)
    vault = tmp_path / "vault"
    vault.mkdir()
    _write_md(vault, "nmap.md", "---\ntitle: nmap\n---\nNmap")

    source = await _create_source(test_db, user, project, str(vault))
    service = KBService(test_db)
    await service.index_vault(source.id, str(vault))

    docs = (await test_db.execute(
        __import__("sqlalchemy").select(KnowledgeDoc).where(
            KnowledgeDoc.source_id == source.id
        )
    )).scalars().all()
    doc = docs[0]

    # Attempt path traversal -- sanitize_filename should strip "../"
    renamed_doc, _ = await service.rename_doc(
        doc.id, "../../etc/cron.d/backdoor"
    )

    # The file must remain inside the vault
    new_file = vault / renamed_doc.relative_path
    assert new_file.exists()
    assert str(new_file.resolve()).startswith(str(vault.resolve()))

    # No file should exist at the traversal target
    assert not Path("/etc/cron.d/backdoor.md").exists()


# ---------------------------------------------------------------------------
# Integration test (full HTTP round-trip)
# ---------------------------------------------------------------------------


async def _create_project_api(client: AsyncClient, headers: dict) -> dict:
    """Create a project via API."""
    import uuid

    resp = await client.post(
        "/api/v1/projects",
        json={
            "name": f"Rename Test {uuid.uuid4().hex[:8]}",
            "type": "htb",
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_source_api(
    client: AsyncClient,
    headers: dict,
    project_id: str,
    vault_path: str,
) -> dict:
    """Create a KB source via API."""
    resp = await client.post(
        "/api/v1/kb/sources",
        json={
            "name": "Test Vault",
            "source_type": "local",
            "path": vault_path,
            "project_id": project_id,
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.mark.anyio
async def test_rename_endpoint_integration(
    client: AsyncClient, auth_headers: dict, test_db, tmp_path
):
    """POST /kb/documents/{id}/rename returns 200 with updated document."""
    project = await _create_project_api(client, auth_headers)
    vault = tmp_path / "rename_vault"
    vault.mkdir()
    _write_md(vault, "nmap.md", "---\ntitle: nmap\n---\nNmap scan guide")
    _write_md(
        vault, "recon.md",
        "---\ntitle: recon\n---\nSee [[nmap]] for details."
    )

    source = await _create_source_api(
        client, auth_headers, project["id"], str(vault)
    )

    # Index via service directly (not background task)
    service = KBService(test_db)
    await service.index_vault(source["id"], str(vault))

    # Find the nmap doc
    list_resp = await client.get(
        "/api/v1/kb/documents",
        headers=auth_headers,
    )
    docs = list_resp.json()["items"]
    nmap_doc = next(d for d in docs if d["title"] == "nmap")

    # Rename via HTTP
    resp = await client.post(
        f"/api/v1/kb/documents/{nmap_doc['id']}/rename",
        json={"new_title": "nmap-guide"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["relative_path"] == "nmap-guide.md"
    assert data["title"] == "nmap-guide"
    assert data["refs_updated"] >= 1
    assert data["id"] == nmap_doc["id"]  # UUID preserved
    assert "backlinks" in data
    assert "source" in data
