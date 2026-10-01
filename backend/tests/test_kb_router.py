"""Integration tests for KB router endpoints.

Uses httpx AsyncClient with the full FastAPI app to test all KB
API endpoints: search, document list/detail/tree, attachments,
source CRUD, and background indexing.
"""

import asyncio
import textwrap
from pathlib import Path

import pytest
from httpx import AsyncClient


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create_project(client: AsyncClient, headers: dict) -> dict:
    """Create a project and return its JSON response."""
    import uuid

    resp = await client.post(
        "/api/v1/projects",
        json={
            "name": f"KB Test {uuid.uuid4().hex[:8]}",
            "type": "htb",
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_source(
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


async def _index_vault_directly(
    test_db, source_id: str, vault_path: str
) -> dict:
    """Index a vault using the service directly (synchronous for tests)."""
    from app.services.kb_service import KBService

    service = KBService(test_db)
    return await service.index_vault(source_id, vault_path)


# ---------------------------------------------------------------------------
# Source CRUD tests
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_create_source(
    client: AsyncClient, auth_headers: dict
):
    """POST /kb/sources creates a knowledge source (201)."""
    project = await _create_project(client, auth_headers)
    resp = await client.post(
        "/api/v1/kb/sources",
        json={
            "name": "My Vault",
            "source_type": "local",
            "path": "/tmp/vault",
            "project_id": project["id"],
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "My Vault"
    assert data["source_type"] == "local"
    assert data["project_id"] == project["id"]
    assert "id" in data


@pytest.mark.anyio
async def test_get_source(
    client: AsyncClient, auth_headers: dict
):
    """GET /kb/sources/{id} returns source details."""
    project = await _create_project(client, auth_headers)
    source = await _create_source(
        client, auth_headers, project["id"], "/tmp/vault"
    )
    resp = await client.get(
        f"/api/v1/kb/sources/{source['id']}",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == source["id"]
    assert data["name"] == "Test Vault"


@pytest.mark.anyio
async def test_list_sources(
    client: AsyncClient, auth_headers: dict
):
    """GET /kb/sources returns list of sources."""
    project = await _create_project(client, auth_headers)
    await _create_source(
        client, auth_headers, project["id"], "/tmp/v1", "Vault A"
    )
    await _create_source(
        client, auth_headers, project["id"], "/tmp/v2", "Vault B"
    )
    resp = await client.get(
        "/api/v1/kb/sources",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 2


@pytest.mark.anyio
async def test_get_source_not_found(
    client: AsyncClient, auth_headers: dict
):
    """GET /kb/sources/{id} returns 404 for nonexistent source."""
    resp = await client.get(
        "/api/v1/kb/sources/nonexistent-id",
        headers=auth_headers,
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Search endpoint tests
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_search_returns_ranked_results(
    client: AsyncClient, auth_headers: dict, test_db, tmp_path
):
    """GET /kb/search?q=nmap returns BM25-ranked results with snippets."""
    project = await _create_project(client, auth_headers)
    vault = tmp_path / "search_vault"
    vault.mkdir()
    _write_md(
        vault,
        "nmap_guide.md",
        "---\ntitle: Nmap Guide\ntags: [nmap, recon]\n---\n"
        "Use nmap to scan open ports on the target host.",
    )
    _write_md(
        vault,
        "gobuster.md",
        "---\ntitle: Gobuster\ntags: [web]\n---\n"
        "Gobuster is a directory brute-forcing tool.",
    )
    _write_md(
        vault,
        "advanced_nmap.md",
        "---\ntitle: Advanced Nmap\ntags: [nmap]\n---\n"
        "Advanced nmap techniques including scripting engine.",
    )

    source = await _create_source(
        client, auth_headers, project["id"], str(vault)
    )
    await _index_vault_directly(test_db, source["id"], str(vault))

    resp = await client.get(
        "/api/v1/kb/search",
        params={"q": "nmap"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["query"] == "nmap"
    assert data["total"] >= 2
    assert len(data["items"]) >= 2

    # Check snippets contain <mark> highlighting
    for item in data["items"]:
        assert "snippet" in item
        assert "rank" in item
    # At least one snippet should contain the highlight marker
    snippets = [it["snippet"] for it in data["items"]]
    assert any("<mark>" in s for s in snippets)


@pytest.mark.anyio
async def test_search_empty_query_returns_empty(
    client: AsyncClient, auth_headers: dict
):
    """GET /kb/search?q= (empty) returns empty list."""
    resp = await client.get(
        "/api/v1/kb/search",
        params={"q": ""},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["items"] == []
    assert data["total"] == 0


@pytest.mark.anyio
async def test_search_no_results(
    client: AsyncClient, auth_headers: dict, test_db, tmp_path
):
    """GET /kb/search?q=zzzzz returns empty when no match."""
    project = await _create_project(client, auth_headers)
    vault = tmp_path / "no_match_vault"
    vault.mkdir()
    _write_md(vault, "note.md", "---\ntitle: Note\n---\nSome content")
    source = await _create_source(
        client, auth_headers, project["id"], str(vault)
    )
    await _index_vault_directly(test_db, source["id"], str(vault))

    resp = await client.get(
        "/api/v1/kb/search",
        params={"q": "zzzznonexistent"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["items"] == []


@pytest.mark.anyio
async def test_search_with_source_filter(
    client: AsyncClient, auth_headers: dict, test_db, tmp_path
):
    """GET /kb/search?q=...&source_id=... limits results to one source."""
    project = await _create_project(client, auth_headers)

    vault_a = tmp_path / "vault_a"
    vault_a.mkdir()
    _write_md(
        vault_a,
        "nmap_a.md",
        "---\ntitle: Nmap A\ntags: [nmap]\n---\nNmap from source A",
    )

    vault_b = tmp_path / "vault_b"
    vault_b.mkdir()
    _write_md(
        vault_b,
        "nmap_b.md",
        "---\ntitle: Nmap B\ntags: [nmap]\n---\nNmap from source B",
    )

    src_a = await _create_source(
        client, auth_headers, project["id"], str(vault_a), "Source A"
    )
    src_b = await _create_source(
        client, auth_headers, project["id"], str(vault_b), "Source B"
    )
    await _index_vault_directly(test_db, src_a["id"], str(vault_a))
    await _index_vault_directly(test_db, src_b["id"], str(vault_b))

    # Search with source filter
    resp = await client.get(
        "/api/v1/kb/search",
        params={"q": "nmap", "source_id": src_a["id"]},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1
    for item in data["items"]:
        assert item["source_id"] == src_a["id"]


# ---------------------------------------------------------------------------
# Document list tests
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_list_documents_returns_paginated(
    client: AsyncClient, auth_headers: dict, test_db, tmp_path
):
    """GET /kb/documents returns paginated document list."""
    project = await _create_project(client, auth_headers)
    vault = tmp_path / "list_vault"
    vault.mkdir()
    for i in range(5):
        _write_md(
            vault, f"note_{i}.md",
            f"---\ntitle: Note {i}\n---\nContent {i}",
        )
    source = await _create_source(
        client, auth_headers, project["id"], str(vault)
    )
    await _index_vault_directly(test_db, source["id"], str(vault))

    resp = await client.get(
        "/api/v1/kb/documents",
        params={"limit": 3},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 3
    assert data["has_more"] is True
    assert data["next_cursor"] is not None


@pytest.mark.anyio
async def test_list_documents_cursor_pagination(
    client: AsyncClient, auth_headers: dict, test_db, tmp_path
):
    """Cursor pagination returns different items on second page."""
    project = await _create_project(client, auth_headers)
    vault = tmp_path / "page_vault"
    vault.mkdir()
    for i in range(6):
        _write_md(
            vault, f"doc_{i}.md",
            f"---\ntitle: Doc {i}\n---\nContent {i}",
        )
    source = await _create_source(
        client, auth_headers, project["id"], str(vault)
    )
    await _index_vault_directly(test_db, source["id"], str(vault))

    # Page 1
    resp1 = await client.get(
        "/api/v1/kb/documents",
        params={"limit": 2},
        headers=auth_headers,
    )
    page1 = resp1.json()
    page1_ids = {item["id"] for item in page1["items"]}

    # Page 2
    resp2 = await client.get(
        "/api/v1/kb/documents",
        params={"limit": 2, "cursor": page1["next_cursor"]},
        headers=auth_headers,
    )
    page2 = resp2.json()
    page2_ids = {item["id"] for item in page2["items"]}

    # Pages must not overlap
    assert page1_ids.isdisjoint(page2_ids)


@pytest.mark.anyio
async def test_list_documents_source_filter(
    client: AsyncClient, auth_headers: dict, test_db, tmp_path
):
    """GET /kb/documents?source_id=... filters by source."""
    project = await _create_project(client, auth_headers)

    vault_a = tmp_path / "filter_a"
    vault_a.mkdir()
    _write_md(vault_a, "a.md", "---\ntitle: Doc A\n---\nA")

    vault_b = tmp_path / "filter_b"
    vault_b.mkdir()
    _write_md(vault_b, "b.md", "---\ntitle: Doc B\n---\nB")

    src_a = await _create_source(
        client, auth_headers, project["id"], str(vault_a), "A"
    )
    src_b = await _create_source(
        client, auth_headers, project["id"], str(vault_b), "B"
    )
    await _index_vault_directly(test_db, src_a["id"], str(vault_a))
    await _index_vault_directly(test_db, src_b["id"], str(vault_b))

    resp = await client.get(
        "/api/v1/kb/documents",
        params={"source_id": src_a["id"]},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 1
    assert data["items"][0]["source_id"] == src_a["id"]


# ---------------------------------------------------------------------------
# Document detail tests
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_get_document_returns_full_detail(
    client: AsyncClient, auth_headers: dict, test_db, tmp_path
):
    """GET /kb/documents/{id} returns body, frontmatter, source info."""
    project = await _create_project(client, auth_headers)
    vault = tmp_path / "detail_vault"
    vault.mkdir()
    _write_md(
        vault,
        "detailed.md",
        "---\ntitle: Detailed Note\ntags: [recon]\n---\n"
        "Full body content here with [[other_note]] wikilink.",
    )
    source = await _create_source(
        client, auth_headers, project["id"], str(vault)
    )
    await _index_vault_directly(test_db, source["id"], str(vault))

    # Get the doc ID from list
    list_resp = await client.get(
        "/api/v1/kb/documents",
        headers=auth_headers,
    )
    doc_id = list_resp.json()["items"][0]["id"]

    resp = await client.get(
        f"/api/v1/kb/documents/{doc_id}",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "Detailed Note"
    assert data["body"] is not None
    assert "body content" in data["body"]
    assert data["source"] is not None
    assert data["source"]["id"] == source["id"]
    assert "backlinks" in data


@pytest.mark.anyio
async def test_get_document_includes_backlinks(
    client: AsyncClient, auth_headers: dict, test_db, tmp_path
):
    """GET /kb/documents/{id} includes backlinks from linking docs."""
    project = await _create_project(client, auth_headers)
    vault = tmp_path / "backlink_vault"
    vault.mkdir()
    _write_md(
        vault, "target.md",
        "---\ntitle: Target Note\n---\nI am the target.",
    )
    _write_md(
        vault, "linker.md",
        "---\ntitle: Linker Note\n---\nSee [[target]] for info.",
    )
    source = await _create_source(
        client, auth_headers, project["id"], str(vault)
    )
    await _index_vault_directly(test_db, source["id"], str(vault))

    # Find the target doc
    list_resp = await client.get(
        "/api/v1/kb/documents",
        headers=auth_headers,
    )
    docs = list_resp.json()["items"]
    target_doc = next(d for d in docs if d["title"] == "Target Note")

    resp = await client.get(
        f"/api/v1/kb/documents/{target_doc['id']}",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    backlinks = data["backlinks"]
    assert len(backlinks) >= 1
    assert any(bl["title"] == "Linker Note" for bl in backlinks)


@pytest.mark.anyio
async def test_get_document_not_found(
    client: AsyncClient, auth_headers: dict
):
    """GET /kb/documents/{id} returns 404 for nonexistent doc."""
    resp = await client.get(
        "/api/v1/kb/documents/nonexistent-id",
        headers=auth_headers,
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Document tree tests
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_get_tree_returns_nested_structure(
    client: AsyncClient, auth_headers: dict, test_db, tmp_path
):
    """GET /kb/documents/tree returns nested folder hierarchy."""
    project = await _create_project(client, auth_headers)
    vault = tmp_path / "tree_vault"
    vault.mkdir()
    _write_md(vault, "root.md", "---\ntitle: Root\n---\nRoot note")
    _write_md(
        vault, "recon/nmap.md",
        "---\ntitle: Nmap\n---\nNmap notes",
    )
    _write_md(
        vault, "recon/web/gobuster.md",
        "---\ntitle: Gobuster\n---\nGobuster notes",
    )
    _write_md(
        vault, "exploit/privesc.md",
        "---\ntitle: Privesc\n---\nPrivesc notes",
    )
    source = await _create_source(
        client, auth_headers, project["id"], str(vault)
    )
    await _index_vault_directly(test_db, source["id"], str(vault))

    resp = await client.get(
        "/api/v1/kb/documents/tree",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "/"
    assert data["type"] == "folder"

    child_names = [c["name"] for c in data["children"]]
    assert "recon" in child_names
    assert "exploit" in child_names
    assert len(data["docs"]) >= 1


# ---------------------------------------------------------------------------
# Attachment tests
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_get_attachment_serves_file(
    client: AsyncClient, auth_headers: dict, test_db, tmp_path
):
    """GET /kb/documents/{id}/attachments/{name} serves allowed files."""
    project = await _create_project(client, auth_headers)
    vault = tmp_path / "attach_vault"
    vault.mkdir()
    _write_md(vault, "note.md", "---\ntitle: Note\n---\nSee image")

    # Create a test image alongside the note
    img_path = vault / "screenshot.png"
    img_path.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)

    source = await _create_source(
        client, auth_headers, project["id"], str(vault)
    )
    await _index_vault_directly(test_db, source["id"], str(vault))

    # Get doc ID
    list_resp = await client.get(
        "/api/v1/kb/documents",
        headers=auth_headers,
    )
    doc_id = list_resp.json()["items"][0]["id"]

    resp = await client.get(
        f"/api/v1/kb/documents/{doc_id}/attachments/screenshot.png",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert "image/png" in resp.headers.get("content-type", "")


@pytest.mark.anyio
async def test_get_attachment_rejects_traversal(
    client: AsyncClient, auth_headers: dict, test_db, tmp_path
):
    """Attachment with ../../etc/passwd path returns 403."""
    project = await _create_project(client, auth_headers)
    vault = tmp_path / "traversal_vault"
    vault.mkdir()
    _write_md(vault, "note.md", "---\ntitle: Note\n---\nContent")
    source = await _create_source(
        client, auth_headers, project["id"], str(vault)
    )
    await _index_vault_directly(test_db, source["id"], str(vault))

    list_resp = await client.get(
        "/api/v1/kb/documents",
        headers=auth_headers,
    )
    doc_id = list_resp.json()["items"][0]["id"]

    resp = await client.get(
        f"/api/v1/kb/documents/{doc_id}/attachments/../../etc/passwd",
        headers=auth_headers,
    )
    # Should be 403 (path traversal) or 404 (not found)
    assert resp.status_code in (403, 404)


@pytest.mark.anyio
async def test_get_attachment_rejects_disallowed_extension(
    client: AsyncClient, auth_headers: dict, test_db, tmp_path
):
    """Attachment with disallowed extension (.php) returns 403."""
    project = await _create_project(client, auth_headers)
    vault = tmp_path / "ext_vault"
    vault.mkdir()
    _write_md(vault, "note.md", "---\ntitle: Note\n---\nContent")

    # Create a .php file (disallowed extension)
    (vault / "backdoor.php").write_text("<?php echo 'pwned'; ?>")

    source = await _create_source(
        client, auth_headers, project["id"], str(vault)
    )
    await _index_vault_directly(test_db, source["id"], str(vault))

    list_resp = await client.get(
        "/api/v1/kb/documents",
        headers=auth_headers,
    )
    doc_id = list_resp.json()["items"][0]["id"]

    resp = await client.get(
        f"/api/v1/kb/documents/{doc_id}/attachments/backdoor.php",
        headers=auth_headers,
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Background indexing tests
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_trigger_index_returns_task_id(
    client: AsyncClient, auth_headers: dict, tmp_path
):
    """POST /kb/sources/{id}/index returns 202 with task_id."""
    project = await _create_project(client, auth_headers)
    vault = tmp_path / "index_vault"
    vault.mkdir()
    _write_md(vault, "note.md", "---\ntitle: Note\n---\nContent")

    source = await _create_source(
        client, auth_headers, project["id"], str(vault)
    )

    resp = await client.post(
        f"/api/v1/kb/sources/{source['id']}/index",
        headers=auth_headers,
    )
    assert resp.status_code == 202
    data = resp.json()
    assert "task_id" in data
    assert data["status"] == "pending"


@pytest.mark.anyio
async def test_poll_index_status(
    client: AsyncClient, auth_headers: dict, tmp_path
):
    """Trigger index and poll until completed with stats."""
    project = await _create_project(client, auth_headers)
    vault = tmp_path / "poll_vault"
    vault.mkdir()
    _write_md(vault, "a.md", "---\ntitle: A\n---\nAlpha")
    _write_md(vault, "b.md", "---\ntitle: B\n---\nBravo")

    source = await _create_source(
        client, auth_headers, project["id"], str(vault)
    )

    # Trigger indexing
    trigger_resp = await client.post(
        f"/api/v1/kb/sources/{source['id']}/index",
        headers=auth_headers,
    )
    task_id = trigger_resp.json()["task_id"]

    # Poll until completed (max 10 seconds)
    for _ in range(20):
        status_resp = await client.get(
            f"/api/v1/kb/index-tasks/{task_id}",
            headers=auth_headers,
        )
        assert status_resp.status_code == 200
        task_data = status_resp.json()

        if task_data["status"] in ("completed", "failed"):
            break
        await asyncio.sleep(0.5)

    assert task_data["status"] == "completed"
    assert task_data["stats"] is not None
    assert task_data["stats"]["added"] == 2


@pytest.mark.anyio
async def test_poll_index_nonexistent_task(
    client: AsyncClient, auth_headers: dict
):
    """GET /kb/index-tasks/{bad_id} returns error."""
    resp = await client.get(
        "/api/v1/kb/index-tasks/nonexistent-task-id",
        headers=auth_headers,
    )
    assert resp.status_code == 500  # KB_INDEX_FAILED maps to 500


# ---------------------------------------------------------------------------
# Auth required tests
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_search_requires_auth(client: AsyncClient):
    """KB endpoints require authentication."""
    resp = await client.get("/api/v1/kb/search", params={"q": "test"})
    assert resp.status_code == 401
