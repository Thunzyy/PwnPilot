"""Tests for KBService tag filtering on list_docs.

Verifies that the `tag` parameter on `list_docs()` correctly
filters documents by their space-separated tags column.
"""

import textwrap
from pathlib import Path

import pytest

from app.models.knowledge import KnowledgeSource
from app.models.project import Project
from app.models.user import User
from app.services.kb_service import KBService


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _setup_user_project(db):
    """Create prerequisite user and project for KB tests."""
    user = User(
        username="taguser",
        email="tag@example.com",
        password_hash="fakehash",
    )
    db.add(user)
    await db.flush()

    project = Project(
        name="Tag Test Project",
        slug="tag-test",
        workspace_path="/tmp/tag-test",
    )
    db.add(project)
    await db.flush()
    return user, project


async def _create_source(db, user, project, vault_path: str) -> KnowledgeSource:
    """Create a KnowledgeSource pointing at *vault_path*."""
    source = KnowledgeSource(
        name="Tag Test Vault",
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
# Tag filter tests
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_list_docs_filter_by_tag(test_db, tmp_path):
    """list_docs with tag param returns only docs whose tags contain that tag."""
    user, project = await _setup_user_project(test_db)
    vault = tmp_path / "vault"
    vault.mkdir()
    source = await _create_source(test_db, user, project, str(vault))

    # Doc with tags "nmap recon" -- should match tag="nmap"
    _write_md(
        vault,
        "scan.md",
        textwrap.dedent("""\
            ---
            title: Nmap Scan
            tags: [nmap, recon]
            ---
            # Nmap Scan
            Port scan results.
        """),
    )

    # Doc with tags "privesc linux" -- should NOT match tag="nmap"
    _write_md(
        vault,
        "privesc.md",
        textwrap.dedent("""\
            ---
            title: Privilege Escalation
            tags: [privesc, linux]
            ---
            # Privesc
            SUID binaries.
        """),
    )

    # Doc with tags "nmap privesc" -- should match tag="nmap"
    _write_md(
        vault,
        "combo.md",
        textwrap.dedent("""\
            ---
            title: Combo Note
            tags: [nmap, privesc]
            ---
            # Combo
            Nmap + privesc.
        """),
    )

    service = KBService(test_db)
    await service.index_vault(source.id, str(vault))

    # Filter by "nmap" -- should return scan.md and combo.md
    result = await service.list_docs(tag="nmap")
    titles = {doc.title for doc in result["items"]}
    assert "Nmap Scan" in titles
    assert "Combo Note" in titles
    assert "Privilege Escalation" not in titles
    assert len(result["items"]) == 2


@pytest.mark.anyio
async def test_list_docs_filter_by_tag_no_match(test_db, tmp_path):
    """list_docs with a nonexistent tag returns an empty list."""
    user, project = await _setup_user_project(test_db)
    vault = tmp_path / "vault"
    vault.mkdir()
    source = await _create_source(test_db, user, project, str(vault))

    _write_md(
        vault,
        "scan.md",
        textwrap.dedent("""\
            ---
            title: Nmap Scan
            tags: [nmap, recon]
            ---
            # Nmap Scan
            Port scan.
        """),
    )

    service = KBService(test_db)
    await service.index_vault(source.id, str(vault))

    result = await service.list_docs(tag="nonexistent")
    assert result["items"] == []
    assert result["has_more"] is False


@pytest.mark.anyio
async def test_list_docs_no_tag_returns_all(test_db, tmp_path):
    """list_docs without tag param returns all documents (existing behavior)."""
    user, project = await _setup_user_project(test_db)
    vault = tmp_path / "vault"
    vault.mkdir()
    source = await _create_source(test_db, user, project, str(vault))

    _write_md(
        vault,
        "a.md",
        textwrap.dedent("""\
            ---
            title: Doc A
            tags: [alpha]
            ---
            # A
        """),
    )

    _write_md(
        vault,
        "b.md",
        textwrap.dedent("""\
            ---
            title: Doc B
            tags: [beta]
            ---
            # B
        """),
    )

    service = KBService(test_db)
    await service.index_vault(source.id, str(vault))

    # No tag filter -- both docs returned
    result = await service.list_docs()
    assert len(result["items"]) == 2
    titles = {doc.title for doc in result["items"]}
    assert titles == {"Doc A", "Doc B"}
