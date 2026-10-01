import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.models.knowledge import KnowledgeDoc, KnowledgeSource
from app.models.project import Project
from app.models.user import User


async def _create_user_and_project(session):
    """Helper to create prerequisite user and project."""
    user = User(
        username="testuser",
        email="test@example.com",
        password_hash="fakehash",
    )
    session.add(user)
    await session.flush()

    project = Project(
        name="Test Project",
        slug="test-project",
        workspace_path="/tmp/test",
    )
    session.add(project)
    await session.flush()

    return user, project


@pytest.mark.anyio
async def test_create_knowledge_source(test_db):
    user, project = await _create_user_and_project(test_db)

    source = KnowledgeSource(
        name="My Vault",
        source_type="local",
        origin="filesystem",
        path="/home/user/vault",
        user_id=user.id,
        project_id=project.id,
    )
    test_db.add(source)
    await test_db.commit()
    await test_db.refresh(source)

    assert source.id is not None
    assert source.name == "My Vault"
    assert source.source_type == "local"
    assert source.origin == "filesystem"
    assert source.path == "/home/user/vault"
    assert source.user_id == user.id
    assert source.project_id == project.id
    assert source.read_only is False
    assert source.last_synced_at is None
    assert source.created_at is not None
    assert source.updated_at is not None


@pytest.mark.anyio
async def test_create_knowledge_doc(test_db):
    user, project = await _create_user_and_project(test_db)

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
        title="Recon Notes",
        relative_path="recon/notes.md",
        body="# Recon\nTarget: 10.10.10.1",
        tags="recon nmap",
        content_hash="abc123",
        wikilinks=[{"target": "Target", "display": None}],
        frontmatter={"author": "tester"},
    )
    test_db.add(doc)
    await test_db.commit()
    await test_db.refresh(doc)

    assert doc.id is not None
    assert doc.source_id == source.id
    assert doc.title == "Recon Notes"
    assert doc.relative_path == "recon/notes.md"
    assert doc.body == "# Recon\nTarget: 10.10.10.1"
    assert doc.tags == "recon nmap"
    assert doc.content_hash == "abc123"
    assert doc.wikilinks == [{"target": "Target", "display": None}]
    assert doc.frontmatter == {"author": "tester"}
    assert doc.created_at is not None
    assert doc.updated_at is not None


@pytest.mark.anyio
async def test_knowledge_source_doc_relationship(test_db):
    user, project = await _create_user_and_project(test_db)

    source = KnowledgeSource(
        name="Vault",
        source_type="local",
        user_id=user.id,
        project_id=project.id,
    )
    test_db.add(source)
    await test_db.flush()

    doc1 = KnowledgeDoc(
        source_id=source.id,
        title="Doc 1",
        relative_path="doc1.md",
        body="Content 1",
    )
    doc2 = KnowledgeDoc(
        source_id=source.id,
        title="Doc 2",
        relative_path="doc2.md",
        body="Content 2",
    )
    test_db.add_all([doc1, doc2])
    await test_db.commit()

    # Use selectinload to eagerly load docs in async context
    from sqlalchemy import select

    result = await test_db.execute(
        select(KnowledgeSource)
        .where(KnowledgeSource.id == source.id)
        .options(selectinload(KnowledgeSource.docs))
    )
    refreshed = result.scalar_one()
    assert len(refreshed.docs) == 2


@pytest.mark.anyio
async def test_fts5_table_exists(test_db):
    result = await test_db.execute(
        text(
            "SELECT name FROM sqlite_master "
            "WHERE type='table' AND name='knowledge_docs_fts'"
        )
    )
    row = result.scalar_one_or_none()
    assert row == "knowledge_docs_fts"


@pytest.mark.anyio
async def test_fts5_search_after_insert(test_db):
    user, project = await _create_user_and_project(test_db)

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
        title="Nmap Scanning",
        relative_path="nmap.md",
        body="Running nmap against the target for port enumeration",
        tags="nmap recon",
    )
    test_db.add(doc)
    await test_db.commit()

    result = await test_db.execute(
        text(
            "SELECT title FROM knowledge_docs_fts "
            "WHERE knowledge_docs_fts MATCH 'enumeration'"
        )
    )
    rows = result.fetchall()
    assert len(rows) == 1
    assert rows[0][0] == "Nmap Scanning"


@pytest.mark.anyio
async def test_fts5_search_bm25_ranking(test_db):
    user, project = await _create_user_and_project(test_db)

    source = KnowledgeSource(
        name="Vault",
        source_type="local",
        user_id=user.id,
        project_id=project.id,
    )
    test_db.add(source)
    await test_db.flush()

    # Doc with low term frequency
    doc_low = KnowledgeDoc(
        source_id=source.id,
        title="Low Freq",
        relative_path="low.md",
        body="The exploit was found in the system",
        tags="misc",
    )
    # Doc with medium term frequency
    doc_mid = KnowledgeDoc(
        source_id=source.id,
        title="Mid Freq",
        relative_path="mid.md",
        body="The exploit used an exploit chain for exploitation",
        tags="exploit",
    )
    # Doc with high term frequency
    doc_high = KnowledgeDoc(
        source_id=source.id,
        title="High Freq",
        relative_path="high.md",
        body="exploit exploit exploit exploit exploit in every sentence about exploits",
        tags="exploit exploit",
    )
    test_db.add_all([doc_low, doc_mid, doc_high])
    await test_db.commit()

    result = await test_db.execute(
        text(
            "SELECT title FROM knowledge_docs_fts "
            "WHERE knowledge_docs_fts MATCH 'exploit' "
            "ORDER BY rank"
        )
    )
    rows = result.fetchall()
    assert len(rows) == 3
    titles = [r[0] for r in rows]
    # BM25 rank: lower (more negative) = better match
    # High freq doc should rank first
    assert titles[0] == "High Freq"


@pytest.mark.anyio
async def test_unique_constraint_source_path(test_db):
    user, project = await _create_user_and_project(test_db)

    source = KnowledgeSource(
        name="Vault",
        source_type="local",
        user_id=user.id,
        project_id=project.id,
    )
    test_db.add(source)
    await test_db.flush()

    doc1 = KnowledgeDoc(
        source_id=source.id,
        title="Doc A",
        relative_path="same/path.md",
        body="First",
    )
    test_db.add(doc1)
    await test_db.commit()

    doc2 = KnowledgeDoc(
        source_id=source.id,
        title="Doc B",
        relative_path="same/path.md",
        body="Duplicate",
    )
    test_db.add(doc2)

    with pytest.raises(IntegrityError):
        await test_db.commit()
