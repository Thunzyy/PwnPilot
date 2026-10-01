"""Tests for KB delete endpoint -- DELETE /kb/documents/{doc_id}.

Covers: delete_doc service method, FTS5 cleanup via AFTER DELETE trigger,
read-only guards, not-found handling, orphaned wikilink preservation,
missing-file edge case, and full HTTP integration.
"""

from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text

from app.core.exceptions import AppException
from app.models.knowledge import KnowledgeDoc, KnowledgeSource
from app.models.project import Project
from app.models.user import User
from app.services.kb_service import KBService


# ---------------------------------------------------------------------------
# Helpers (same pattern as test_kb_rename.py)
# ---------------------------------------------------------------------------


async def _setup_user_project(db):
    """Create prerequisite user and project for KB tests."""
    user = User(
        username="deleteuser",
        email="delete@example.com",
        password_hash="fakehash",
    )
    db.add(user)
    await db.flush()

    project = Project(
        name="Delete Test Project",
        slug="delete-test",
        workspace_path="/tmp/delete-test",
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
async def test_delete_doc_removes_file_and_db_row(test_db, tmp_path):
    """Basic delete: file removed from disk, DB row gone, no errors."""
    user, project = await _setup_user_project(test_db)
    vault = tmp_path / "vault"
    vault.mkdir()
    _write_md(vault, "nmap.md", "---\ntitle: nmap\n---\nNmap scan guide")

    source = await _create_source(test_db, user, project, str(vault))
    service = KBService(test_db)
    await service.index_vault(source.id, str(vault))

    # Get doc
    docs = (
        await test_db.execute(
            select(KnowledgeDoc).where(
                KnowledgeDoc.source_id == source.id
            )
        )
    ).scalars().all()
    assert len(docs) == 1
    doc_id = docs[0].id

    # Delete
    await service.delete_doc(doc_id)

    # File gone from disk
    assert not (vault / "nmap.md").exists()

    # DB row gone
    result = await test_db.execute(
        select(KnowledgeDoc).where(KnowledgeDoc.id == doc_id)
    )
    assert result.scalar_one_or_none() is None


@pytest.mark.anyio
async def test_delete_doc_read_only_returns_403(test_db, tmp_path):
    """Deleting from a read-only source raises KB_DOC_READ_ONLY."""
    user, project = await _setup_user_project(test_db)
    vault = tmp_path / "vault"
    vault.mkdir()
    _write_md(vault, "nmap.md", "---\ntitle: nmap\n---\nNmap")

    source = await _create_source(
        test_db, user, project, str(vault), read_only=True
    )
    service = KBService(test_db)
    await service.index_vault(source.id, str(vault))

    docs = (
        await test_db.execute(
            select(KnowledgeDoc).where(
                KnowledgeDoc.source_id == source.id
            )
        )
    ).scalars().all()
    doc = docs[0]

    with pytest.raises(AppException) as exc_info:
        await service.delete_doc(doc.id)

    assert "KB_DOC_READ_ONLY" in exc_info.value.code

    # File must still exist (untouched)
    assert (vault / "nmap.md").exists()


@pytest.mark.anyio
async def test_delete_doc_not_found_returns_404(test_db):
    """Deleting a nonexistent doc raises KB_DOC_NOT_FOUND."""
    service = KBService(test_db)

    with pytest.raises(AppException) as exc_info:
        await service.delete_doc("nonexistent-id")

    assert "KB_DOC_NOT_FOUND" in exc_info.value.code


@pytest.mark.anyio
async def test_delete_doc_fts5_cleanup(test_db, tmp_path):
    """After delete, FTS5 search no longer returns the deleted doc."""
    user, project = await _setup_user_project(test_db)
    vault = tmp_path / "vault"
    vault.mkdir()
    _write_md(
        vault, "nmap.md",
        "---\ntitle: nmap\n---\nNmap port scanning tool guide"
    )

    source = await _create_source(test_db, user, project, str(vault))
    service = KBService(test_db)
    await service.index_vault(source.id, str(vault))

    # Verify FTS5 finds the doc before delete
    pre_search = await service.search_docs("nmap")
    assert pre_search["total"] >= 1

    # Get and delete the doc
    docs = (
        await test_db.execute(
            select(KnowledgeDoc).where(
                KnowledgeDoc.source_id == source.id
            )
        )
    ).scalars().all()
    doc_id = docs[0].id

    await service.delete_doc(doc_id)

    # FTS5 should no longer return the deleted doc
    post_search = await service.search_docs("nmap")
    found_ids = [item["id"] for item in post_search["items"]]
    assert doc_id not in found_ids


@pytest.mark.anyio
async def test_delete_doc_orphaned_wikilinks_preserved(test_db, tmp_path):
    """Other docs with [[deleted-doc]] wikilinks are NOT modified."""
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
    docs = (
        await test_db.execute(
            select(KnowledgeDoc).where(
                KnowledgeDoc.relative_path == "nmap.md"
            )
        )
    ).scalars().all()
    nmap_doc = docs[0]

    # Delete nmap
    await service.delete_doc(nmap_doc.id)

    # recon.md on disk still contains the [[nmap]] wikilink (orphaned)
    recon_content = (vault / "recon.md").read_text(encoding="utf-8")
    assert "[[nmap]]" in recon_content

    # recon.md DB row is untouched (wikilinks JSON still references nmap)
    recon_docs = (
        await test_db.execute(
            select(KnowledgeDoc).where(
                KnowledgeDoc.relative_path == "recon.md"
            )
        )
    ).scalars().all()
    assert len(recon_docs) == 1
    assert any(
        wl.get("target", "").lower() == "nmap"
        for wl in (recon_docs[0].wikilinks or [])
    )


@pytest.mark.anyio
async def test_delete_doc_missing_file_still_cleans_db(test_db, tmp_path):
    """If file was externally deleted, DB row is still removed."""
    user, project = await _setup_user_project(test_db)
    vault = tmp_path / "vault"
    vault.mkdir()
    _write_md(vault, "nmap.md", "---\ntitle: nmap\n---\nNmap guide")

    source = await _create_source(test_db, user, project, str(vault))
    service = KBService(test_db)
    await service.index_vault(source.id, str(vault))

    docs = (
        await test_db.execute(
            select(KnowledgeDoc).where(
                KnowledgeDoc.source_id == source.id
            )
        )
    ).scalars().all()
    doc_id = docs[0].id

    # Externally delete the file (simulating out-of-band removal)
    (vault / "nmap.md").unlink()

    # delete_doc should still succeed (clean up DB row)
    await service.delete_doc(doc_id)

    # DB row gone
    result = await test_db.execute(
        select(KnowledgeDoc).where(KnowledgeDoc.id == doc_id)
    )
    assert result.scalar_one_or_none() is None


# ---------------------------------------------------------------------------
# Integration test (full HTTP round-trip)
# ---------------------------------------------------------------------------


async def _create_project_api(client: AsyncClient, headers: dict) -> dict:
    """Create a project via API."""
    import uuid

    resp = await client.post(
        "/api/v1/projects",
        json={
            "name": f"Delete Test {uuid.uuid4().hex[:8]}",
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
async def test_delete_endpoint_integration(
    client: AsyncClient, auth_headers: dict, test_db, tmp_path
):
    """DELETE /kb/documents/{id} returns 204 No Content."""
    project = await _create_project_api(client, auth_headers)
    vault = tmp_path / "delete_vault"
    vault.mkdir()
    _write_md(vault, "nmap.md", "---\ntitle: nmap\n---\nNmap scan guide")

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

    # Delete via HTTP
    resp = await client.delete(
        f"/api/v1/kb/documents/{nmap_doc['id']}",
        headers=auth_headers,
    )
    assert resp.status_code == 204

    # Verify doc is gone via API
    get_resp = await client.get(
        f"/api/v1/kb/documents/{nmap_doc['id']}",
        headers=auth_headers,
    )
    assert get_resp.status_code == 404

    # File gone from disk
    assert not (vault / "nmap.md").exists()
