"""Integration tests for Engagement Linking and MITRE ATT&CK endpoints.

Uses httpx AsyncClient with the full FastAPI app to test all linking
API endpoints: link CRUD, bidirectional queries, MITRE tag management,
and technique catalog search.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.knowledge import KnowledgeDoc, KnowledgeSource
from app.models.timeline import Timeline


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
            "name": f"Link Test {uuid.uuid4().hex[:8]}",
            "type": "htb",
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_timeline_entry(
    db: AsyncSession,
    project_id: str,
    content: str = "nmap -sV 10.10.10.1",
) -> Timeline:
    """Insert a timeline entry directly in the database."""
    entry = Timeline(
        project_id=project_id,
        type="command",
        content=content,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


async def _create_kb_doc(
    db: AsyncSession,
    project_id: str,
    user_id: str,
    title: str = "Nmap Guide",
    tags: str | None = "recon nmap",
) -> KnowledgeDoc:
    """Insert a KB source + doc directly in the database."""
    source = KnowledgeSource(
        name="Test Source",
        source_type="local",
        path="/tmp/test-vault",
        user_id=user_id,
        project_id=project_id,
    )
    db.add(source)
    await db.flush()

    doc = KnowledgeDoc(
        source_id=source.id,
        title=title,
        relative_path=f"{title.lower().replace(' ', '_')}.md",
        body=f"# {title}\n\nTest content for linking.",
        tags=tags,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return doc


async def _get_current_user_id(
    client: AsyncClient, headers: dict
) -> str:
    """Extract the current user's ID from the auth headers."""
    resp = await client.get(
        "/api/v1/auth/me", headers=headers
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


# ---------------------------------------------------------------------------
# Link CRUD tests
# ---------------------------------------------------------------------------


class TestLinkCRUD:
    """Tests for POST/DELETE link endpoints."""

    @pytest.mark.anyio
    async def test_create_link(
        self,
        client: AsyncClient,
        auth_headers: dict,
        test_db: AsyncSession,
    ):
        """POST /linking/timeline/{id}/kb/{id} returns 201."""
        project = await _create_project(client, auth_headers)
        entry = await _create_timeline_entry(
            test_db, project["id"]
        )
        user_id = await _get_current_user_id(
            client, auth_headers
        )
        doc = await _create_kb_doc(
            test_db, project["id"], user_id
        )

        resp = await client.post(
            f"/api/v1/linking/timeline/{entry.id}"
            f"/kb/{doc.id}",
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["timeline_entry_id"] == entry.id
        assert data["doc_id"] == doc.id
        assert "id" in data
        assert "created_at" in data

    @pytest.mark.anyio
    async def test_create_link_duplicate(
        self,
        client: AsyncClient,
        auth_headers: dict,
        test_db: AsyncSession,
    ):
        """Duplicate link returns 409 KB_LINK_EXISTS."""
        project = await _create_project(client, auth_headers)
        entry = await _create_timeline_entry(
            test_db, project["id"]
        )
        user_id = await _get_current_user_id(
            client, auth_headers
        )
        doc = await _create_kb_doc(
            test_db, project["id"], user_id
        )

        url = (
            f"/api/v1/linking/timeline/{entry.id}"
            f"/kb/{doc.id}"
        )
        resp1 = await client.post(
            url, headers=auth_headers
        )
        assert resp1.status_code == 201

        resp2 = await client.post(
            url, headers=auth_headers
        )
        assert resp2.status_code == 409
        assert "KB_LINK_EXISTS" in resp2.json()["error"]["code"]

    @pytest.mark.anyio
    async def test_create_link_invalid_entry(
        self,
        client: AsyncClient,
        auth_headers: dict,
        test_db: AsyncSession,
    ):
        """Nonexistent entry_id returns 404."""
        project = await _create_project(client, auth_headers)
        user_id = await _get_current_user_id(
            client, auth_headers
        )
        doc = await _create_kb_doc(
            test_db, project["id"], user_id
        )

        resp = await client.post(
            f"/api/v1/linking/timeline/nonexistent-id"
            f"/kb/{doc.id}",
            headers=auth_headers,
        )
        assert resp.status_code == 404

    @pytest.mark.anyio
    async def test_delete_link(
        self,
        client: AsyncClient,
        auth_headers: dict,
        test_db: AsyncSession,
    ):
        """DELETE /linking/timeline/{id}/kb/{id} returns 204."""
        project = await _create_project(client, auth_headers)
        entry = await _create_timeline_entry(
            test_db, project["id"]
        )
        user_id = await _get_current_user_id(
            client, auth_headers
        )
        doc = await _create_kb_doc(
            test_db, project["id"], user_id
        )

        url = (
            f"/api/v1/linking/timeline/{entry.id}"
            f"/kb/{doc.id}"
        )
        await client.post(url, headers=auth_headers)

        resp = await client.delete(
            url, headers=auth_headers
        )
        assert resp.status_code == 204

    @pytest.mark.anyio
    async def test_delete_link_not_found(
        self,
        client: AsyncClient,
        auth_headers: dict,
    ):
        """DELETE nonexistent link returns 404."""
        resp = await client.delete(
            "/api/v1/linking/timeline/fake-entry/kb/fake-doc",
            headers=auth_headers,
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Bidirectional query tests
# ---------------------------------------------------------------------------


class TestLinkedQueries:
    """Tests for GET linked engagements/docs endpoints."""

    @pytest.mark.anyio
    async def test_get_doc_engagements(
        self,
        client: AsyncClient,
        auth_headers: dict,
        test_db: AsyncSession,
    ):
        """GET /linking/kb/{id}/engagements returns linked entries."""
        project = await _create_project(client, auth_headers)
        entry = await _create_timeline_entry(
            test_db, project["id"]
        )
        user_id = await _get_current_user_id(
            client, auth_headers
        )
        doc = await _create_kb_doc(
            test_db, project["id"], user_id
        )

        # Create link
        await client.post(
            f"/api/v1/linking/timeline/{entry.id}"
            f"/kb/{doc.id}",
            headers=auth_headers,
        )

        resp = await client.get(
            f"/api/v1/linking/kb/{doc.id}/engagements",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["timeline_entry_id"] == entry.id
        assert data[0]["project_name"] == project["name"]
        assert data[0]["entry_type"] == "command"

    @pytest.mark.anyio
    async def test_get_doc_engagements_empty(
        self,
        client: AsyncClient,
        auth_headers: dict,
        test_db: AsyncSession,
    ):
        """No links returns empty list."""
        project = await _create_project(client, auth_headers)
        user_id = await _get_current_user_id(
            client, auth_headers
        )
        doc = await _create_kb_doc(
            test_db, project["id"], user_id
        )

        resp = await client.get(
            f"/api/v1/linking/kb/{doc.id}/engagements",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json() == []

    @pytest.mark.anyio
    async def test_get_entry_docs(
        self,
        client: AsyncClient,
        auth_headers: dict,
        test_db: AsyncSession,
    ):
        """GET /linking/timeline/{id}/docs returns linked KB docs."""
        project = await _create_project(client, auth_headers)
        entry = await _create_timeline_entry(
            test_db, project["id"]
        )
        user_id = await _get_current_user_id(
            client, auth_headers
        )
        doc = await _create_kb_doc(
            test_db, project["id"], user_id
        )

        # Create link
        await client.post(
            f"/api/v1/linking/timeline/{entry.id}"
            f"/kb/{doc.id}",
            headers=auth_headers,
        )

        resp = await client.get(
            f"/api/v1/linking/timeline/{entry.id}/docs",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["doc_id"] == doc.id
        assert data[0]["title"] == "Nmap Guide"
        assert data[0]["source_id"] == doc.source_id


# ---------------------------------------------------------------------------
# MITRE tag tests
# ---------------------------------------------------------------------------


class TestMitreTags:
    """Tests for MITRE ATT&CK tag management endpoints."""

    @pytest.mark.anyio
    async def test_add_mitre_tag(
        self,
        client: AsyncClient,
        auth_headers: dict,
        test_db: AsyncSession,
    ):
        """POST mitre-tags with valid ID returns updated tags."""
        project = await _create_project(client, auth_headers)
        user_id = await _get_current_user_id(
            client, auth_headers
        )
        doc = await _create_kb_doc(
            test_db, project["id"], user_id
        )

        resp = await client.post(
            f"/api/v1/linking/kb/documents/{doc.id}"
            f"/mitre-tags",
            json={"technique_id": "T1190"},
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert "mitre:T1190" in data["tags"]
        assert "T1190" in data["mitre_techniques"]
        assert data["doc_id"] == doc.id

    @pytest.mark.anyio
    async def test_add_mitre_tag_invalid(
        self,
        client: AsyncClient,
        auth_headers: dict,
    ):
        """POST with invalid technique_id returns 422."""
        resp = await client.post(
            "/api/v1/linking/kb/documents/any-doc-id"
            "/mitre-tags",
            json={"technique_id": "INVALID"},
            headers=auth_headers,
        )
        assert resp.status_code == 422

    @pytest.mark.anyio
    async def test_remove_mitre_tag(
        self,
        client: AsyncClient,
        auth_headers: dict,
        test_db: AsyncSession,
    ):
        """DELETE mitre-tags returns updated tags without technique."""
        project = await _create_project(client, auth_headers)
        user_id = await _get_current_user_id(
            client, auth_headers
        )
        doc = await _create_kb_doc(
            test_db, project["id"], user_id
        )

        # Add first
        await client.post(
            f"/api/v1/linking/kb/documents/{doc.id}"
            f"/mitre-tags",
            json={"technique_id": "T1190"},
            headers=auth_headers,
        )

        # Remove
        resp = await client.delete(
            f"/api/v1/linking/kb/documents/{doc.id}"
            f"/mitre-tags/T1190",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert "mitre:T1190" not in data["tags"]
        assert "T1190" not in data["mitre_techniques"]

    @pytest.mark.anyio
    async def test_list_mitre_techniques(
        self,
        client: AsyncClient,
        auth_headers: dict,
    ):
        """GET /linking/mitre/techniques returns full catalog."""
        resp = await client.get(
            "/api/v1/linking/mitre/techniques",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) > 0
        # Each technique has id, name, tactic
        for tech in data[:3]:
            assert "id" in tech
            assert "name" in tech
            assert "tactic" in tech

    @pytest.mark.anyio
    async def test_list_mitre_techniques_search(
        self,
        client: AsyncClient,
        auth_headers: dict,
    ):
        """GET /linking/mitre/techniques?q=power returns filtered."""
        resp = await client.get(
            "/api/v1/linking/mitre/techniques",
            params={"q": "power"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        # All results should match "power" in id or name
        for tech in data:
            matches = (
                "power" in tech["id"].lower()
                or "power" in tech["name"].lower()
            )
            assert matches, (
                f"'{tech['name']}' does not contain 'power'"
            )
