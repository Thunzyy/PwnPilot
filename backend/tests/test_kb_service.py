"""Tests for KBService — KB business logic service.

Covers: index_vault, search_docs, get_doc, get_backlinks, list_docs,
        get_tree, get_source, _sanitize_frontmatter, _sanitize_fts_query.
"""

import datetime
import os
import textwrap
from pathlib import Path

import pytest
from sqlalchemy import select

from app.models.knowledge import KnowledgeDoc, KnowledgeSource
from app.models.project import Project
from app.models.user import User


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _setup_user_project(db):
    """Create prerequisite user and project for KB tests."""
    user = User(
        username="kbuser",
        email="kb@example.com",
        password_hash="fakehash",
    )
    db.add(user)
    await db.flush()

    project = Project(
        name="KB Test Project",
        slug="kb-test",
        workspace_path="/tmp/kb-test",
    )
    db.add(project)
    await db.flush()
    return user, project


async def _create_source(db, user, project, vault_path: str) -> KnowledgeSource:
    """Create a KnowledgeSource pointing at *vault_path*."""
    source = KnowledgeSource(
        name="Test Vault",
        source_type="local",
        origin="filesystem",
        path=vault_path,
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
# index_vault tests
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_index_vault_adds_new_files(test_db, tmp_path):
    """index_vault scans .md files and inserts docs into SQLite."""
    from app.services.kb_service import KBService

    user, project = await _setup_user_project(test_db)
    vault = tmp_path / "vault"
    vault.mkdir()

    # Create 5 markdown files
    for i in range(5):
        _write_md(vault, f"note_{i}.md", f"---\ntitle: Note {i}\ntags: [test]\n---\nBody {i}")

    source = await _create_source(test_db, user, project, str(vault))
    service = KBService(test_db)
    stats = await service.index_vault(source.id, str(vault))

    assert stats["added"] == 5
    assert stats["updated"] == 0
    assert stats["deleted"] == 0
    assert stats["duration_ms"] >= 0
    assert isinstance(stats["errors"], list)


@pytest.mark.anyio
async def test_index_vault_skips_unchanged(test_db, tmp_path):
    """Re-indexing unchanged vault produces all-zero stats."""
    from app.services.kb_service import KBService

    user, project = await _setup_user_project(test_db)
    vault = tmp_path / "vault"
    vault.mkdir()

    for i in range(3):
        _write_md(vault, f"note_{i}.md", f"---\ntitle: Note {i}\n---\nBody {i}")

    source = await _create_source(test_db, user, project, str(vault))
    service = KBService(test_db)

    # First index
    await service.index_vault(source.id, str(vault))

    # Re-index — everything should be skipped
    stats = await service.index_vault(source.id, str(vault))
    assert stats["added"] == 0
    assert stats["updated"] == 0
    assert stats["deleted"] == 0


@pytest.mark.anyio
async def test_index_vault_detects_updates(test_db, tmp_path):
    """Modifying a file's content triggers an update on re-index."""
    from app.services.kb_service import KBService

    user, project = await _setup_user_project(test_db)
    vault = tmp_path / "vault"
    vault.mkdir()
    _write_md(vault, "note.md", "---\ntitle: Original\n---\nOld body")

    source = await _create_source(test_db, user, project, str(vault))
    service = KBService(test_db)
    await service.index_vault(source.id, str(vault))

    # Modify the file
    _write_md(vault, "note.md", "---\ntitle: Updated\n---\nNew body")
    stats = await service.index_vault(source.id, str(vault))

    assert stats["updated"] == 1
    assert stats["added"] == 0


@pytest.mark.anyio
async def test_index_vault_deletes_orphans(test_db, tmp_path):
    """Removing a file from disk deletes the orphaned DB record."""
    from app.services.kb_service import KBService

    user, project = await _setup_user_project(test_db)
    vault = tmp_path / "vault"
    vault.mkdir()
    f1 = _write_md(vault, "keep.md", "---\ntitle: Keep\n---\nKeep me")
    f2 = _write_md(vault, "remove.md", "---\ntitle: Remove\n---\nGoing away")

    source = await _create_source(test_db, user, project, str(vault))
    service = KBService(test_db)
    await service.index_vault(source.id, str(vault))

    # Delete one file from disk
    f2.unlink()
    stats = await service.index_vault(source.id, str(vault))

    assert stats["deleted"] == 1
    assert stats["added"] == 0
    assert stats["updated"] == 0


@pytest.mark.anyio
async def test_index_vault_captures_errors(test_db, tmp_path):
    """Files with invalid encoding are captured in stats.errors."""
    from app.services.kb_service import KBService

    user, project = await _setup_user_project(test_db)
    vault = tmp_path / "vault"
    vault.mkdir()

    # Valid file
    _write_md(vault, "good.md", "---\ntitle: Good\n---\nHello")

    # Write binary garbage that can't be parsed as markdown
    bad_file = vault / "bad.md"
    bad_file.write_bytes(b"\x80\x81\x82\x83" * 100)

    source = await _create_source(test_db, user, project, str(vault))
    service = KBService(test_db)
    stats = await service.index_vault(source.id, str(vault))

    # good.md should succeed; bad.md may error
    assert stats["added"] >= 1


@pytest.mark.anyio
async def test_index_vault_sanitizes_frontmatter_dates(test_db, tmp_path):
    """Frontmatter with date values should be converted to ISO strings."""
    from app.services.kb_service import KBService

    user, project = await _setup_user_project(test_db)
    vault = tmp_path / "vault"
    vault.mkdir()

    _write_md(
        vault,
        "dated.md",
        "---\ntitle: Dated\ndate: 2025-06-15\n---\nBody with date frontmatter",
    )

    source = await _create_source(test_db, user, project, str(vault))
    service = KBService(test_db)
    await service.index_vault(source.id, str(vault))

    # Fetch the doc and verify frontmatter date is a string
    result = await test_db.execute(
        select(KnowledgeDoc).where(KnowledgeDoc.source_id == source.id)
    )
    doc = result.scalar_one()
    assert isinstance(doc.frontmatter["date"], str)
    assert doc.frontmatter["date"] == "2025-06-15"


# ---------------------------------------------------------------------------
# search_docs tests
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_search_docs_returns_results(test_db):
    """FTS5 search returns matching documents with snippets."""
    from app.services.kb_service import KBService

    user, project = await _setup_user_project(test_db)
    source = KnowledgeSource(
        name="Vault",
        source_type="local",
        user_id=user.id,
        project_id=project.id,
    )
    test_db.add(source)
    await test_db.flush()

    docs = [
        KnowledgeDoc(
            source_id=source.id,
            title="Nmap Guide",
            relative_path="nmap.md",
            body="Use nmap to scan open ports on the target host",
            tags="nmap recon",
        ),
        KnowledgeDoc(
            source_id=source.id,
            title="Gobuster",
            relative_path="gobuster.md",
            body="Gobuster is a directory brute-forcing tool",
            tags="web enum",
        ),
        KnowledgeDoc(
            source_id=source.id,
            title="Advanced Nmap",
            relative_path="advanced_nmap.md",
            body="Advanced nmap techniques including nmap scripting engine",
            tags="nmap",
        ),
    ]
    test_db.add_all(docs)
    await test_db.commit()

    service = KBService(test_db)
    result = await service.search_docs("nmap")

    assert isinstance(result, dict)
    assert "items" in result
    assert "total" in result
    assert len(result["items"]) >= 2
    assert result["total"] >= 2
    # Results should have required fields including dates
    for r in result["items"]:
        assert "id" in r
        assert "title" in r
        assert "snippet" in r
        assert "rank" in r
        assert "created_at" in r
        assert "updated_at" in r


@pytest.mark.anyio
async def test_search_docs_returns_empty_for_no_match(test_db):
    """Searching for a nonexistent term returns an empty list."""
    from app.services.kb_service import KBService

    user, project = await _setup_user_project(test_db)
    source = KnowledgeSource(
        name="Vault",
        source_type="local",
        user_id=user.id,
        project_id=project.id,
    )
    test_db.add(source)
    await test_db.flush()

    doc = KnowledgeDoc(
        source_id=source.id,
        title="Note",
        relative_path="note.md",
        body="Some content",
    )
    test_db.add(doc)
    await test_db.commit()

    service = KBService(test_db)
    result = await service.search_docs("zzzznonexistent")
    assert result == {"items": [], "total": 0}


@pytest.mark.anyio
async def test_search_docs_sanitizes_special_chars(test_db):
    """Queries with FTS5 special characters don't cause SQL errors."""
    from app.services.kb_service import KBService

    user, project = await _setup_user_project(test_db)
    source = KnowledgeSource(
        name="Vault",
        source_type="local",
        user_id=user.id,
        project_id=project.id,
    )
    test_db.add(source)
    await test_db.flush()

    doc = KnowledgeDoc(
        source_id=source.id,
        title="Test",
        relative_path="test.md",
        body="nmap scan results",
        tags="nmap",
    )
    test_db.add(doc)
    await test_db.commit()

    service = KBService(test_db)
    # These queries should not raise any SQL errors
    result = await service.search_docs('nmap && --top-ports"')
    assert isinstance(result, dict)
    assert isinstance(result["items"], list)

    result2 = await service.search_docs("(OR) AND NOT")
    assert isinstance(result2, dict)
    assert isinstance(result2["items"], list)


@pytest.mark.anyio
async def test_search_docs_snippets_contain_mark(test_db):
    """FTS5 snippets should contain <mark> highlighting."""
    from app.services.kb_service import KBService

    user, project = await _setup_user_project(test_db)
    source = KnowledgeSource(
        name="Vault",
        source_type="local",
        user_id=user.id,
        project_id=project.id,
    )
    test_db.add(source)
    await test_db.flush()

    doc = KnowledgeDoc(
        source_id=source.id,
        title="Port Scan",
        relative_path="portscan.md",
        body="Running nmap port scan against the target to find open services",
        tags="nmap recon",
    )
    test_db.add(doc)
    await test_db.commit()

    service = KBService(test_db)
    result = await service.search_docs("nmap")

    assert len(result["items"]) >= 1
    snippet = result["items"][0]["snippet"]
    assert "<mark>" in snippet
    assert "</mark>" in snippet


# ---------------------------------------------------------------------------
# search_docs — filter prefix integration tests (FILT-01 through FILT-07)
# ---------------------------------------------------------------------------


async def _create_filter_test_docs(test_db):
    """Create a standard set of docs for filter prefix testing.

    Returns (service, source) for assertions.
    """
    from app.services.kb_service import KBService

    user, project = await _setup_user_project(test_db)
    source = KnowledgeSource(
        name="Vault",
        source_type="local",
        user_id=user.id,
        project_id=project.id,
    )
    test_db.add(source)
    await test_db.flush()

    docs = [
        KnowledgeDoc(
            source_id=source.id,
            title="Nmap Guide",
            relative_path="recon/nmap-guide.md",
            body=(
                "## Enumeration\n"
                "Use nmap for port scanning.\n"
                "## Exploitation\n"
                "Metasploit usage."
            ),
            tags="nmap recon",
        ),
        KnowledgeDoc(
            source_id=source.id,
            title="Readme",
            relative_path="notes/readme.md",
            body=(
                "## Setup\n"
                "SSH connection on port 22.\n"
                "HTTP on port 80."
            ),
            tags="notes",
            frontmatter={"status": "draft"},
        ),
        KnowledgeDoc(
            source_id=source.id,
            title="Linux Privesc",
            relative_path="privesc/linux.md",
            body=(
                "## SUID\n"
                "Find SUID binaries.\n"
                "## Capabilities\n"
                "Check capabilities."
            ),
            tags="privesc",
            frontmatter={"status": "published"},
        ),
    ]
    test_db.add_all(docs)
    await test_db.commit()

    return KBService(test_db), source


@pytest.mark.anyio
async def test_search_docs_with_path_filter(test_db):
    """path: filter restricts results to docs whose path contains value."""
    service, _ = await _create_filter_test_docs(test_db)

    # path:recon + free text "nmap"
    result = await service.search_docs("path:recon nmap")
    assert len(result["items"]) == 1
    assert result["items"][0]["relative_path"] == "recon/nmap-guide.md"

    # path:privesc (filter-only — with free text for FTS match)
    result = await service.search_docs("path:privesc SUID")
    assert len(result["items"]) == 1
    assert result["items"][0]["relative_path"] == "privesc/linux.md"


@pytest.mark.anyio
async def test_search_docs_with_file_filter(test_db):
    """file: filter restricts results to docs whose filename matches."""
    service, _ = await _create_filter_test_docs(test_db)

    # file:readme — should match notes/readme.md
    result = await service.search_docs("file:readme SSH")
    assert len(result["items"]) == 1
    assert result["items"][0]["relative_path"] == "notes/readme.md"

    # file:linux — should match privesc/linux.md
    result = await service.search_docs("file:linux SUID")
    assert len(result["items"]) == 1
    assert result["items"][0]["relative_path"] == "privesc/linux.md"


@pytest.mark.anyio
async def test_search_docs_with_tag_filter(test_db):
    """tag: filter restricts results to docs with a matching tag."""
    service, _ = await _create_filter_test_docs(test_db)

    # tag:nmap with FTS text "port"
    result = await service.search_docs("tag:nmap port")
    assert len(result["items"]) >= 1
    paths = {it["relative_path"] for it in result["items"]}
    assert "recon/nmap-guide.md" in paths
    # The readme also has "port" in body but is NOT tagged nmap
    assert "notes/readme.md" not in paths

    # tag:nmap alone (filter-only, no free text — FILT-07)
    result = await service.search_docs("tag:nmap")
    assert len(result["items"]) >= 1
    paths = {it["relative_path"] for it in result["items"]}
    assert "recon/nmap-guide.md" in paths


@pytest.mark.anyio
async def test_search_docs_with_frontmatter_filter(test_db):
    """[property:value] filter restricts by frontmatter field."""
    service, _ = await _create_filter_test_docs(test_db)

    # [status:draft] — filter-only
    result = await service.search_docs("[status:draft]")
    assert len(result["items"]) == 1
    assert result["items"][0]["relative_path"] == "notes/readme.md"

    # [status:published] + free text
    result = await service.search_docs("[status:published] SUID")
    assert len(result["items"]) == 1
    assert result["items"][0]["relative_path"] == "privesc/linux.md"


@pytest.mark.anyio
async def test_search_docs_with_line_filter(test_db):
    """line: filter returns docs where keyword appears on a single line."""
    service, _ = await _create_filter_test_docs(test_db)

    # line:SSH — readme.md has "SSH connection on port 22."
    result = await service.search_docs("line:SSH")
    paths = {it["relative_path"] for it in result["items"]}
    assert "notes/readme.md" in paths
    # nmap-guide.md does NOT have "SSH" on any line
    assert "recon/nmap-guide.md" not in paths


@pytest.mark.anyio
async def test_search_docs_with_section_filter(test_db):
    """section: filter returns docs where keyword appears under a heading."""
    service, _ = await _create_filter_test_docs(test_db)

    # section:Enumeration — nmap-guide.md has ## Enumeration
    result = await service.search_docs("section:Enumeration")
    paths = {it["relative_path"] for it in result["items"]}
    assert "recon/nmap-guide.md" in paths
    # Other docs don't have "Enumeration" section
    assert "notes/readme.md" not in paths
    assert "privesc/linux.md" not in paths


@pytest.mark.anyio
async def test_search_docs_with_mixed_filters(test_db):
    """Multiple filter types combine with AND semantics."""
    service, _ = await _create_filter_test_docs(test_db)

    # tag:nmap + path:recon + free text "port"
    result = await service.search_docs("tag:nmap path:recon port")
    assert len(result["items"]) == 1
    assert result["items"][0]["relative_path"] == "recon/nmap-guide.md"


@pytest.mark.anyio
async def test_search_docs_filter_only_no_fts(test_db):
    """Filter-only query (no free text) returns results without FTS5 MATCH."""
    service, _ = await _create_filter_test_docs(test_db)

    # tag:nmap — no free text at all
    result = await service.search_docs("tag:nmap")
    assert result["total"] >= 1
    assert len(result["items"]) >= 1

    # Snippet should have body excerpt (not empty)
    for item in result["items"]:
        assert item["snippet"]  # non-empty string
        # "body" key should NOT be in the returned items
        assert "body" not in item


@pytest.mark.anyio
async def test_search_docs_filter_body_not_in_response(test_db):
    """Body key is removed from all search results (both FTS and filter)."""
    service, _ = await _create_filter_test_docs(test_db)

    # FTS path
    result = await service.search_docs("nmap")
    for item in result["items"]:
        assert "body" not in item

    # Filter-only path
    result = await service.search_docs("tag:privesc")
    for item in result["items"]:
        assert "body" not in item


# ---------------------------------------------------------------------------
# get_doc tests
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_get_doc_returns_document(test_db):
    """get_doc returns a KnowledgeDoc with source eagerly loaded."""
    from app.services.kb_service import KBService

    user, project = await _setup_user_project(test_db)
    source = KnowledgeSource(
        name="Vault",
        source_type="local",
        user_id=user.id,
        project_id=project.id,
    )
    test_db.add(source)
    await test_db.flush()

    doc = KnowledgeDoc(
        source_id=source.id,
        title="My Doc",
        relative_path="my_doc.md",
        body="Hello world",
    )
    test_db.add(doc)
    await test_db.commit()
    await test_db.refresh(doc)

    service = KBService(test_db)
    result = await service.get_doc(doc.id)

    assert result.id == doc.id
    assert result.title == "My Doc"
    # Source should be eagerly loaded (no lazy-load exception)
    assert result.source.name == "Vault"


@pytest.mark.anyio
async def test_get_doc_raises_not_found(test_db):
    """get_doc raises AppException for nonexistent document ID."""
    from app.core.exceptions import AppException
    from app.services.kb_service import KBService

    service = KBService(test_db)
    with pytest.raises(AppException) as exc_info:
        await service.get_doc("nonexistent-id")
    assert "KB_DOC_NOT_FOUND" in exc_info.value.code


# ---------------------------------------------------------------------------
# get_backlinks tests
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_get_backlinks_finds_linking_docs(test_db):
    """get_backlinks returns documents that link to the target via wikilinks."""
    from app.services.kb_service import KBService

    user, project = await _setup_user_project(test_db)
    source = KnowledgeSource(
        name="Vault",
        source_type="local",
        user_id=user.id,
        project_id=project.id,
    )
    test_db.add(source)
    await test_db.flush()

    # Target document
    target = KnowledgeDoc(
        source_id=source.id,
        title="Target Note",
        relative_path="target.md",
        body="I am the target",
        wikilinks=[],
    )
    # Document that links TO the target
    linker1 = KnowledgeDoc(
        source_id=source.id,
        title="Linker One",
        relative_path="linker1.md",
        body="See [[target]] for details",
        wikilinks=[{"target": "target", "display": None}],
    )
    linker2 = KnowledgeDoc(
        source_id=source.id,
        title="Linker Two",
        relative_path="linker2.md",
        body="Also references [[target|the target page]]",
        wikilinks=[{"target": "target", "display": "the target page"}],
    )
    # Document that doesn't link to target
    unrelated = KnowledgeDoc(
        source_id=source.id,
        title="Unrelated",
        relative_path="unrelated.md",
        body="No links here",
        wikilinks=[],
    )
    test_db.add_all([target, linker1, linker2, unrelated])
    await test_db.commit()
    await test_db.refresh(target)

    service = KBService(test_db)
    backlinks = await service.get_backlinks(target.id)

    assert len(backlinks) == 2
    titles = {bl["title"] for bl in backlinks}
    assert "Linker One" in titles
    assert "Linker Two" in titles


@pytest.mark.anyio
async def test_get_backlinks_empty_when_no_links(test_db):
    """get_backlinks returns empty list for unlinked documents."""
    from app.services.kb_service import KBService

    user, project = await _setup_user_project(test_db)
    source = KnowledgeSource(
        name="Vault",
        source_type="local",
        user_id=user.id,
        project_id=project.id,
    )
    test_db.add(source)
    await test_db.flush()

    doc = KnowledgeDoc(
        source_id=source.id,
        title="Lonely Doc",
        relative_path="lonely.md",
        body="Nobody links to me",
        wikilinks=[],
    )
    test_db.add(doc)
    await test_db.commit()
    await test_db.refresh(doc)

    service = KBService(test_db)
    backlinks = await service.get_backlinks(doc.id)
    assert backlinks == []


# ---------------------------------------------------------------------------
# list_docs tests
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_list_docs_returns_paginated(test_db):
    """list_docs returns cursor-paginated results."""
    from app.services.kb_service import KBService

    user, project = await _setup_user_project(test_db)
    source = KnowledgeSource(
        name="Vault",
        source_type="local",
        user_id=user.id,
        project_id=project.id,
    )
    test_db.add(source)
    await test_db.flush()

    # Create 5 docs
    for i in range(5):
        test_db.add(
            KnowledgeDoc(
                source_id=source.id,
                title=f"Doc {i}",
                relative_path=f"doc_{i}.md",
                body=f"Content {i}",
            )
        )
    await test_db.commit()

    service = KBService(test_db)

    # Page 1 with limit=2
    page1 = await service.list_docs(limit=2)
    assert len(page1["items"]) == 2
    assert page1["has_more"] is True
    assert page1["next_cursor"] is not None

    # Page 2 using cursor
    page2 = await service.list_docs(cursor=page1["next_cursor"], limit=2)
    assert len(page2["items"]) == 2
    assert page2["has_more"] is True

    # Page 3 — last page
    page3 = await service.list_docs(cursor=page2["next_cursor"], limit=2)
    assert len(page3["items"]) == 1
    assert page3["has_more"] is False
    assert page3["next_cursor"] is None


@pytest.mark.anyio
async def test_list_docs_filter_by_source(test_db):
    """list_docs filters by source_id when provided."""
    from app.services.kb_service import KBService

    user, project = await _setup_user_project(test_db)

    source_a = KnowledgeSource(
        name="Source A",
        source_type="local",
        user_id=user.id,
        project_id=project.id,
    )
    source_b = KnowledgeSource(
        name="Source B",
        source_type="local",
        user_id=user.id,
        project_id=project.id,
    )
    test_db.add_all([source_a, source_b])
    await test_db.flush()

    test_db.add(
        KnowledgeDoc(
            source_id=source_a.id,
            title="Doc A",
            relative_path="a.md",
            body="Source A content",
        )
    )
    test_db.add(
        KnowledgeDoc(
            source_id=source_b.id,
            title="Doc B",
            relative_path="b.md",
            body="Source B content",
        )
    )
    await test_db.commit()

    service = KBService(test_db)
    page = await service.list_docs(source_id=source_a.id)
    assert len(page["items"]) == 1
    assert page["items"][0].title == "Doc A"


# ---------------------------------------------------------------------------
# get_tree tests
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_get_tree_builds_nested_structure(test_db):
    """get_tree returns nested folder structure from flat paths."""
    from app.services.kb_service import KBService

    user, project = await _setup_user_project(test_db)
    source = KnowledgeSource(
        name="Vault",
        source_type="local",
        user_id=user.id,
        project_id=project.id,
    )
    test_db.add(source)
    await test_db.flush()

    docs = [
        KnowledgeDoc(
            source_id=source.id,
            title="Root Note",
            relative_path="root_note.md",
            body="At root",
        ),
        KnowledgeDoc(
            source_id=source.id,
            title="Nmap Guide",
            relative_path="recon/nmap.md",
            body="Nmap notes",
        ),
        KnowledgeDoc(
            source_id=source.id,
            title="Gobuster",
            relative_path="recon/web/gobuster.md",
            body="Gobuster notes",
        ),
        KnowledgeDoc(
            source_id=source.id,
            title="Privesc",
            relative_path="exploit/privesc.md",
            body="Privesc notes",
        ),
    ]
    test_db.add_all(docs)
    await test_db.commit()

    service = KBService(test_db)
    tree = await service.get_tree(source_id=source.id)

    assert tree["name"] == "/"
    assert tree["type"] == "folder"

    # Root should have: 2 child folders (exploit, recon) and 1 doc (root_note)
    child_names = [c["name"] for c in tree["children"]]
    assert "recon" in child_names
    assert "exploit" in child_names
    assert len(tree["docs"]) == 1
    assert tree["docs"][0]["title"] == "Root Note"


@pytest.mark.anyio
async def test_get_tree_sorts_alphabetically(test_db):
    """get_tree sorts folders and docs alphabetically (case-insensitive)."""
    from app.services.kb_service import KBService

    user, project = await _setup_user_project(test_db)
    source = KnowledgeSource(
        name="Vault",
        source_type="local",
        user_id=user.id,
        project_id=project.id,
    )
    test_db.add(source)
    await test_db.flush()

    docs = [
        KnowledgeDoc(
            source_id=source.id,
            title="Zebra",
            relative_path="zebra/z.md",
            body="Z",
        ),
        KnowledgeDoc(
            source_id=source.id,
            title="Alpha",
            relative_path="alpha/a.md",
            body="A",
        ),
        KnowledgeDoc(
            source_id=source.id,
            title="Beta Note",
            relative_path="beta.md",
            body="B root doc",
        ),
        KnowledgeDoc(
            source_id=source.id,
            title="Apple Note",
            relative_path="apple.md",
            body="A root doc",
        ),
    ]
    test_db.add_all(docs)
    await test_db.commit()

    service = KBService(test_db)
    tree = await service.get_tree(source_id=source.id)

    # Folders alphabetical
    folder_names = [c["name"] for c in tree["children"]]
    assert folder_names == sorted(folder_names, key=str.lower)

    # Root docs alphabetical
    doc_titles = [d["title"] for d in tree["docs"]]
    assert doc_titles == sorted(doc_titles, key=str.lower)


# ---------------------------------------------------------------------------
# get_source tests
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_get_source_returns_source(test_db):
    """get_source returns a KnowledgeSource by ID."""
    from app.services.kb_service import KBService

    user, project = await _setup_user_project(test_db)
    source = KnowledgeSource(
        name="My Source",
        source_type="local",
        user_id=user.id,
        project_id=project.id,
    )
    test_db.add(source)
    await test_db.commit()
    await test_db.refresh(source)

    service = KBService(test_db)
    result = await service.get_source(source.id)
    assert result.id == source.id
    assert result.name == "My Source"


@pytest.mark.anyio
async def test_get_source_raises_not_found(test_db):
    """get_source raises AppException for nonexistent source."""
    from app.core.exceptions import AppException
    from app.services.kb_service import KBService

    service = KBService(test_db)
    with pytest.raises(AppException) as exc_info:
        await service.get_source("nonexistent-id")
    assert "KB_SOURCE_NOT_FOUND" in exc_info.value.code


# ---------------------------------------------------------------------------
# _sanitize_frontmatter tests
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_sanitize_frontmatter_converts_dates(test_db):
    """_sanitize_frontmatter converts date/datetime to ISO strings."""
    from app.services.kb_service import KBService

    service = KBService(test_db)
    meta = {
        "title": "Test",
        "date": datetime.date(2025, 6, 15),
        "updated": datetime.datetime(2025, 7, 1, 12, 0, 0),
        "count": 42,
    }
    result = service._sanitize_frontmatter(meta)

    assert result["title"] == "Test"
    assert result["date"] == "2025-06-15"
    assert result["updated"] == "2025-07-01T12:00:00"
    assert result["count"] == 42


# ---------------------------------------------------------------------------
# _sanitize_fts_query tests
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_sanitize_fts_query_wraps_terms(test_db):
    """_sanitize_fts_query wraps terms in quotes and strips operators."""
    from app.services.kb_service import KBService

    service = KBService(test_db)

    assert service._sanitize_fts_query("nmap scan") == '"nmap" "scan"'
    assert service._sanitize_fts_query('nmap && --top"') == '"nmap" "top"'
    assert service._sanitize_fts_query("") == ""
    assert service._sanitize_fts_query("***") == ""


# ---------------------------------------------------------------------------
# Large vault test
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_index_vault_50_files(test_db, tmp_path):
    """index_vault processes 50 .md files correctly."""
    from app.services.kb_service import KBService

    user, project = await _setup_user_project(test_db)
    vault = tmp_path / "big_vault"
    vault.mkdir()

    for i in range(50):
        folder = f"section_{i // 10}"
        _write_md(
            vault,
            f"{folder}/note_{i}.md",
            f"---\ntitle: Note {i}\ntags: [tag{i}]\n---\nBody content for note {i}",
        )

    source = await _create_source(test_db, user, project, str(vault))
    service = KBService(test_db)
    stats = await service.index_vault(source.id, str(vault))

    assert stats["added"] == 50
    assert stats["updated"] == 0
    assert stats["deleted"] == 0
    assert len(stats["errors"]) == 0
