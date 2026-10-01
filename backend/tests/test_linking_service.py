"""Tests for LinkingService -- engagement linking and MITRE ATT&CK tagging.

Covers:
- Link creation (LINK-01): create_link, duplicate prevention, entity validation
- Link deletion (LINK-01): delete_link, not-found handling
- Bidirectional queries: get_linked_engagements (LINK-02), get_linked_docs (LINK-03)
- MITRE tag management (MITRE-01): add_mitre_tag, remove_mitre_tag, get_mitre_tags
- MITRE lookup (MITRE-02): list_mitre_techniques with optional search
"""

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ErrorCode
from app.core.exceptions import AppException
from app.models.knowledge import KnowledgeDoc, KnowledgeSource
from app.models.project import Project
from app.models.timeline import Timeline
from app.models.user import User
from app.services.linking_service import LinkingService


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
async def seed_data(test_db: AsyncSession):
    """Create a user, project, source, docs, and timeline entries for tests."""
    user = User(
        id=str(uuid.uuid4()),
        username="tester",
        email="tester@test.com",
        password_hash="hashed",
    )
    test_db.add(user)

    project = Project(
        id=str(uuid.uuid4()),
        name="HackTheBox - Machine",
        slug=f"htb-machine-{uuid.uuid4().hex[:8]}",
        workspace_path="/tmp/htb",
    )
    test_db.add(project)

    source = KnowledgeSource(
        id=str(uuid.uuid4()),
        name="pentest-notes",
        source_type="local",
        user_id=user.id,
        project_id=project.id,
    )
    test_db.add(source)

    doc1 = KnowledgeDoc(
        id=str(uuid.uuid4()),
        source_id=source.id,
        title="Nmap Cheatsheet",
        relative_path="recon/nmap.md",
        body="# Nmap",
        tags="nmap recon",
    )
    doc2 = KnowledgeDoc(
        id=str(uuid.uuid4()),
        source_id=source.id,
        title="Privilege Escalation",
        relative_path="privesc/linux.md",
        body="# Privesc",
        tags="privesc linux",
    )
    doc3 = KnowledgeDoc(
        id=str(uuid.uuid4()),
        source_id=source.id,
        title="SQLi Guide",
        relative_path="web/sqli.md",
        body="# SQLi",
        tags=None,
    )
    test_db.add_all([doc1, doc2, doc3])

    entry1 = Timeline(
        id=str(uuid.uuid4()),
        project_id=project.id,
        type="command",
        content="nmap -sV 10.10.10.1",
    )
    entry2 = Timeline(
        id=str(uuid.uuid4()),
        project_id=project.id,
        type="note",
        content="Found open port 80",
    )
    test_db.add_all([entry1, entry2])

    await test_db.commit()

    return {
        "user": user,
        "project": project,
        "source": source,
        "doc1": doc1,
        "doc2": doc2,
        "doc3": doc3,
        "entry1": entry1,
        "entry2": entry2,
    }


# ===========================================================================
# TestLinkCreation
# ===========================================================================


class TestLinkCreation:
    """Tests for LinkingService.create_link."""

    @pytest.mark.anyio
    async def test_create_link_success(self, test_db, seed_data):
        svc = LinkingService(test_db)
        data = seed_data
        link = await svc.create_link(data["entry1"].id, data["doc1"].id)

        assert link.timeline_entry_id == data["entry1"].id
        assert link.doc_id == data["doc1"].id
        assert link.id is not None

    @pytest.mark.anyio
    async def test_create_link_duplicate_raises(self, test_db, seed_data):
        svc = LinkingService(test_db)
        data = seed_data
        await svc.create_link(data["entry1"].id, data["doc1"].id)

        with pytest.raises(AppException) as exc_info:
            await svc.create_link(data["entry1"].id, data["doc1"].id)
        assert ErrorCode.KB_LINK_EXISTS in exc_info.value.code

    @pytest.mark.anyio
    async def test_create_link_nonexistent_entry_raises(self, test_db, seed_data):
        svc = LinkingService(test_db)
        data = seed_data
        fake_entry_id = str(uuid.uuid4())

        with pytest.raises(AppException) as exc_info:
            await svc.create_link(fake_entry_id, data["doc1"].id)
        assert ErrorCode.TIMELINE_ENTRY_NOT_FOUND in exc_info.value.code

    @pytest.mark.anyio
    async def test_create_link_nonexistent_doc_raises(self, test_db, seed_data):
        svc = LinkingService(test_db)
        data = seed_data
        fake_doc_id = str(uuid.uuid4())

        with pytest.raises(AppException) as exc_info:
            await svc.create_link(data["entry1"].id, fake_doc_id)
        assert ErrorCode.KB_DOC_NOT_FOUND in exc_info.value.code


# ===========================================================================
# TestLinkDeletion
# ===========================================================================


class TestLinkDeletion:
    """Tests for LinkingService.delete_link."""

    @pytest.mark.anyio
    async def test_delete_link_success(self, test_db, seed_data):
        svc = LinkingService(test_db)
        data = seed_data
        await svc.create_link(data["entry1"].id, data["doc1"].id)
        await svc.delete_link(data["entry1"].id, data["doc1"].id)

        # Verify link is gone by attempting to delete again
        with pytest.raises(AppException) as exc_info:
            await svc.delete_link(data["entry1"].id, data["doc1"].id)
        assert ErrorCode.KB_LINK_NOT_FOUND in exc_info.value.code

    @pytest.mark.anyio
    async def test_delete_link_not_found_raises(self, test_db, seed_data):
        svc = LinkingService(test_db)
        data = seed_data

        with pytest.raises(AppException) as exc_info:
            await svc.delete_link(data["entry1"].id, data["doc1"].id)
        assert ErrorCode.KB_LINK_NOT_FOUND in exc_info.value.code


# ===========================================================================
# TestLinkedEngagements
# ===========================================================================


class TestLinkedEngagements:
    """Tests for LinkingService.get_linked_engagements (LINK-02)."""

    @pytest.mark.anyio
    async def test_linked_engagements_with_links(self, test_db, seed_data):
        svc = LinkingService(test_db)
        data = seed_data

        # Link doc1 to both timeline entries
        await svc.create_link(data["entry1"].id, data["doc1"].id)
        await svc.create_link(data["entry2"].id, data["doc1"].id)

        results = await svc.get_linked_engagements(data["doc1"].id)
        assert len(results) == 2

        # Verify fields present
        first = results[0]
        assert first.project_name == data["project"].name
        assert first.timeline_entry_id is not None
        assert first.entry_type in ("command", "note")
        assert first.entry_content is not None

    @pytest.mark.anyio
    async def test_linked_engagements_empty(self, test_db, seed_data):
        svc = LinkingService(test_db)
        data = seed_data

        results = await svc.get_linked_engagements(data["doc1"].id)
        assert results == []


# ===========================================================================
# TestLinkedDocs
# ===========================================================================


class TestLinkedDocs:
    """Tests for LinkingService.get_linked_docs (LINK-03)."""

    @pytest.mark.anyio
    async def test_linked_docs_with_links(self, test_db, seed_data):
        svc = LinkingService(test_db)
        data = seed_data

        # Link entry1 to all 3 docs
        await svc.create_link(data["entry1"].id, data["doc1"].id)
        await svc.create_link(data["entry1"].id, data["doc2"].id)
        await svc.create_link(data["entry1"].id, data["doc3"].id)

        results = await svc.get_linked_docs(data["entry1"].id)
        assert len(results) == 3

        # Verify fields
        doc_ids = {r.doc_id for r in results}
        assert data["doc1"].id in doc_ids
        assert data["doc2"].id in doc_ids
        assert data["doc3"].id in doc_ids


# ===========================================================================
# TestMitreTags
# ===========================================================================


class TestMitreTags:
    """Tests for MITRE ATT&CK tag management (MITRE-01)."""

    @pytest.mark.anyio
    async def test_add_mitre_tag_success(self, test_db, seed_data):
        svc = LinkingService(test_db)
        data = seed_data

        doc = await svc.add_mitre_tag(data["doc1"].id, "T1190")
        assert "mitre:T1190" in doc.tags

    @pytest.mark.anyio
    async def test_add_mitre_tag_subtechnique(self, test_db, seed_data):
        svc = LinkingService(test_db)
        data = seed_data

        doc = await svc.add_mitre_tag(data["doc1"].id, "T1059.001")
        assert "mitre:T1059.001" in doc.tags

    @pytest.mark.anyio
    async def test_add_mitre_tag_invalid_format_raises(self, test_db, seed_data):
        svc = LinkingService(test_db)
        data = seed_data

        with pytest.raises(AppException) as exc_info:
            await svc.add_mitre_tag(data["doc1"].id, "INVALID")
        assert ErrorCode.KB_INVALID_MITRE_ID in exc_info.value.code

    @pytest.mark.anyio
    async def test_add_mitre_tag_duplicate_raises(self, test_db, seed_data):
        svc = LinkingService(test_db)
        data = seed_data

        await svc.add_mitre_tag(data["doc1"].id, "T1190")
        with pytest.raises(AppException) as exc_info:
            await svc.add_mitre_tag(data["doc1"].id, "T1190")
        assert ErrorCode.KB_MITRE_TAG_EXISTS in exc_info.value.code

    @pytest.mark.anyio
    async def test_add_mitre_tag_to_doc_with_no_tags(self, test_db, seed_data):
        svc = LinkingService(test_db)
        data = seed_data

        # doc3 has tags=None
        doc = await svc.add_mitre_tag(data["doc3"].id, "T1190")
        assert doc.tags == "mitre:T1190"

    @pytest.mark.anyio
    async def test_remove_mitre_tag_success(self, test_db, seed_data):
        svc = LinkingService(test_db)
        data = seed_data

        await svc.add_mitre_tag(data["doc1"].id, "T1190")
        doc = await svc.remove_mitre_tag(data["doc1"].id, "T1190")
        assert "mitre:T1190" not in (doc.tags or "")

    @pytest.mark.anyio
    async def test_remove_mitre_tag_doc_not_found(self, test_db, seed_data):
        svc = LinkingService(test_db)
        fake_doc_id = str(uuid.uuid4())

        with pytest.raises(AppException) as exc_info:
            await svc.remove_mitre_tag(fake_doc_id, "T1190")
        assert ErrorCode.KB_DOC_NOT_FOUND in exc_info.value.code

    @pytest.mark.anyio
    async def test_get_mitre_tags_extracts_from_mixed_tags(self, test_db, seed_data):
        svc = LinkingService(test_db)
        data = seed_data

        # doc1 has tags="nmap recon", add two MITRE tags
        await svc.add_mitre_tag(data["doc1"].id, "T1190")
        await svc.add_mitre_tag(data["doc1"].id, "T1059")

        tags = await svc.get_mitre_tags(data["doc1"].id)
        assert sorted(tags) == ["T1059", "T1190"]

    @pytest.mark.anyio
    async def test_get_mitre_tags_empty_when_no_mitre(self, test_db, seed_data):
        svc = LinkingService(test_db)
        data = seed_data

        tags = await svc.get_mitre_tags(data["doc1"].id)
        assert tags == []


# ===========================================================================
# TestMitreLookup
# ===========================================================================


class TestMitreLookup:
    """Tests for MITRE ATT&CK technique lookup (MITRE-02)."""

    @pytest.mark.anyio
    async def test_list_all_techniques(self, test_db):
        svc = LinkingService(test_db)
        results = svc.list_mitre_techniques()
        assert len(results) > 100  # 166 curated techniques

    @pytest.mark.anyio
    async def test_list_techniques_filter_by_name(self, test_db):
        svc = LinkingService(test_db)
        results = svc.list_mitre_techniques(q="PowerShell")
        assert len(results) >= 1
        assert any(t.id == "T1059.001" for t in results)

    @pytest.mark.anyio
    async def test_list_techniques_filter_by_id(self, test_db):
        svc = LinkingService(test_db)
        results = svc.list_mitre_techniques(q="T1190")
        assert len(results) >= 1
        assert any(t.id == "T1190" for t in results)

    @pytest.mark.anyio
    async def test_list_techniques_case_insensitive(self, test_db):
        svc = LinkingService(test_db)
        results = svc.list_mitre_techniques(q="powershell")
        assert len(results) >= 1

    @pytest.mark.anyio
    async def test_list_techniques_no_match(self, test_db):
        svc = LinkingService(test_db)
        results = svc.list_mitre_techniques(q="zzz_nonexistent_zzz")
        assert results == []
