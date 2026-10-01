"""Tests for MITRE tag migration and tree API tags field.

Covers:
- No-op migration (no mitre: tags)
- Successful migration with frontmatter file write and DB sync
- Read-only source migration (DB-only prefix strip)
- Tree API returns tags field
- Tree API returns null tags
"""

import textwrap
from pathlib import Path

import frontmatter
import pytest
from httpx import AsyncClient

from app.models.knowledge import KnowledgeDoc, KnowledgeSource
from app.models.project import Project
from app.models.user import User
from app.services.kb_service import KBService


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _setup_user_project(db):
    """Create prerequisite user and project for KB tests."""
    user = User(
        username="migreuser",
        email="migre@example.com",
        password_hash="fakehash",
    )
    db.add(user)
    await db.flush()

    project = Project(
        name="Migration Test Project",
        slug="migre-test",
        workspace_path="/tmp/migre-test",
    )
    db.add(project)
    await db.flush()
    return user, project


async def _create_source(
    db,
    user,
    project,
    vault_path: str,
    read_only: bool = False,
) -> KnowledgeSource:
    """Create a KnowledgeSource pointing at *vault_path*."""
    source = KnowledgeSource(
        name="Migration Test Vault",
        source_type="local",
        origin="filesystem",
        path=vault_path,
        user_id=user.id,
        project_id=project.id,
        read_only=read_only,
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
# Migration tests (service-level with test_db)
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_migrate_no_mitre_tags(test_db, tmp_path):
    """Migration with no mitre: tags returns zeroed stats."""
    user, project = await _setup_user_project(test_db)
    vault = tmp_path / "vault"
    vault.mkdir()
    source = await _create_source(
        test_db, user, project, str(vault)
    )

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

    service = KBService(test_db)
    await service.index_vault(source.id, str(vault))

    stats = await service.migrate_mitre_tags()

    assert stats["migrated"] == 0
    assert stats["skipped"] == 0
    assert stats["errors"] == []


@pytest.mark.anyio
async def test_migrate_mitre_tags_to_frontmatter(test_db, tmp_path):
    """Migration writes MITRE tags into frontmatter and updates DB."""
    user, project = await _setup_user_project(test_db)
    vault = tmp_path / "vault"
    vault.mkdir()
    source = await _create_source(
        test_db, user, project, str(vault)
    )

    _write_md(
        vault,
        "exploit.md",
        textwrap.dedent("""\
            ---
            title: Exploit Notes
            tags: [recon]
            ---
            # Exploit Notes
            Some exploit content.
        """),
    )

    service = KBService(test_db)
    await service.index_vault(source.id, str(vault))

    # Manually set DB tags to include mitre: prefixed values
    from sqlalchemy import select

    result = await test_db.execute(
        select(KnowledgeDoc).where(
            KnowledgeDoc.source_id == source.id
        )
    )
    doc = result.scalar_one()
    doc.tags = "recon mitre:T1190 mitre:T1059"
    await test_db.commit()

    stats = await service.migrate_mitre_tags()

    assert stats["migrated"] == 1
    assert stats["skipped"] == 0
    assert stats["errors"] == []

    # Verify file frontmatter was updated
    file_path = vault / "exploit.md"
    post = frontmatter.loads(file_path.read_text(encoding="utf-8"))
    fm_tags = post.metadata.get("tags", [])
    assert "recon" in fm_tags
    assert "T1190" in fm_tags
    assert "T1059" in fm_tags

    # Verify DB doc.tags no longer has mitre: prefix
    await test_db.refresh(doc)
    db_tags = (doc.tags or "").split()
    mitre_prefixed = [t for t in db_tags if t.startswith("mitre:")]
    assert mitre_prefixed == [], (
        f"DB still has mitre: prefixed tags: {mitre_prefixed}"
    )


@pytest.mark.anyio
async def test_migrate_read_only_source(test_db, tmp_path):
    """Read-only source migration strips prefix in DB without file write."""
    user, project = await _setup_user_project(test_db)
    vault = tmp_path / "vault"
    vault.mkdir()
    source = await _create_source(
        test_db, user, project, str(vault), read_only=True
    )

    _write_md(
        vault,
        "readonly.md",
        textwrap.dedent("""\
            ---
            title: Read Only Doc
            tags: [nmap]
            ---
            # Read Only
            Content.
        """),
    )

    service = KBService(test_db)
    await service.index_vault(source.id, str(vault))

    # Manually set DB tags with mitre: prefix
    from sqlalchemy import select

    result = await test_db.execute(
        select(KnowledgeDoc).where(
            KnowledgeDoc.source_id == source.id
        )
    )
    doc = result.scalar_one()
    doc.tags = "mitre:T1190 nmap"
    await test_db.commit()

    stats = await service.migrate_mitre_tags()

    assert stats["migrated"] == 1
    assert stats["errors"] == []

    # Verify DB tags: mitre: prefix stripped, original tags kept
    await test_db.refresh(doc)
    db_tags = set((doc.tags or "").split())
    assert "T1190" in db_tags
    assert "nmap" in db_tags
    assert "mitre:T1190" not in db_tags

    # Verify file was NOT modified (still has original frontmatter)
    post = frontmatter.loads(
        (vault / "readonly.md").read_text(encoding="utf-8")
    )
    fm_tags = post.metadata.get("tags", [])
    assert "T1190" not in fm_tags, (
        "Read-only source should not write to file"
    )


# ---------------------------------------------------------------------------
# Tree API tags tests (service-level with test_db)
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_tree_returns_tags(test_db, tmp_path):
    """Tree API includes tags field for documents with tags."""
    user, project = await _setup_user_project(test_db)
    vault = tmp_path / "vault"
    vault.mkdir()
    source = await _create_source(
        test_db, user, project, str(vault)
    )

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

    service = KBService(test_db)
    await service.index_vault(source.id, str(vault))

    tree = await service.get_tree(source_id=source.id)

    # Find the doc in the tree root docs
    assert len(tree["docs"]) == 1
    doc_item = tree["docs"][0]
    assert doc_item["tags"] == "nmap recon"


@pytest.mark.anyio
async def test_tree_returns_null_tags(test_db, tmp_path):
    """Tree API returns null tags for documents without tags."""
    user, project = await _setup_user_project(test_db)
    vault = tmp_path / "vault"
    vault.mkdir()
    source = await _create_source(
        test_db, user, project, str(vault)
    )

    _write_md(
        vault,
        "plain.md",
        textwrap.dedent("""\
            ---
            title: Plain Doc
            ---
            # Plain Doc
            No tags here.
        """),
    )

    service = KBService(test_db)
    await service.index_vault(source.id, str(vault))

    tree = await service.get_tree(source_id=source.id)

    assert len(tree["docs"]) == 1
    doc_item = tree["docs"][0]
    assert doc_item["tags"] is None
