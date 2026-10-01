"""Tests for Knowledge Base Pydantic schemas.

Covers sync schemas, community catalog schemas, opsec warning computation,
and catalog JSON file validation.
"""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.schemas.knowledge import (
    AddCommunitySourceRequest,
    CatalogEntry,
    KnowledgeSourceCreate,
    KnowledgeSourceResponse,
    SyncTaskResponse,
)


# =============================================================================
# CatalogEntry tests
# =============================================================================


def test_catalog_entry_validates_correctly():
    """CatalogEntry accepts all fields and returns them correctly."""
    entry = CatalogEntry(
        slug="hacktricks",
        name="HackTricks",
        url="https://github.com/HackTricks-wiki/hacktricks.git",
        description="Pentesting tricks and techniques",
        recommended_filters=["linux-hardening", "pentesting-web"],
        read_only=True,
        clone_depth=1,
    )
    assert entry.slug == "hacktricks"
    assert entry.name == "HackTricks"
    assert entry.url == "https://github.com/HackTricks-wiki/hacktricks.git"
    assert entry.description == "Pentesting tricks and techniques"
    assert entry.recommended_filters == ["linux-hardening", "pentesting-web"]
    assert entry.read_only is True
    assert entry.clone_depth == 1


def test_catalog_entry_defaults():
    """CatalogEntry uses correct defaults for optional fields."""
    entry = CatalogEntry(
        slug="test-repo",
        name="Test Repo",
        url="https://github.com/test/repo.git",
        description="A test repository",
    )
    assert entry.read_only is True
    assert entry.clone_depth == 1
    assert entry.recommended_filters == []


# =============================================================================
# SyncTaskResponse tests
# =============================================================================


def test_sync_task_response_validates():
    """SyncTaskResponse accepts all fields correctly."""
    resp = SyncTaskResponse(
        task_id="sync-abc123",
        status="completed",
        source_id="src-001",
        started_at=1700000000.0,
        stats=None,
        error=None,
    )
    assert resp.task_id == "sync-abc123"
    assert resp.status == "completed"
    assert resp.source_id == "src-001"
    assert resp.started_at == 1700000000.0
    assert resp.stats is None
    assert resp.error is None


def test_sync_task_response_status_literal():
    """SyncTaskResponse rejects invalid status values."""
    with pytest.raises(ValidationError):
        SyncTaskResponse(
            task_id="sync-bad",
            status="invalid",
            source_id="src-001",
        )


# =============================================================================
# KnowledgeSourceResponse opsec_warning tests
# =============================================================================


def test_knowledge_source_response_opsec_warning_set():
    """Opsec warning is set when remote_url is configured."""
    resp = KnowledgeSourceResponse(
        id="src-001",
        name="Test Source",
        source_type="local",
        user_id="user-001",
        project_id="proj-001",
        remote_url="https://github.com/user/repo.git",
        created_at="2024-01-01T00:00:00",
        updated_at="2024-01-01T00:00:00",
    )
    assert resp.opsec_warning is not None
    assert "WARNING" in resp.opsec_warning
    assert "remote" in resp.opsec_warning.lower()


def test_knowledge_source_response_opsec_warning_null():
    """Opsec warning is None when no remote_url is set."""
    resp = KnowledgeSourceResponse(
        id="src-002",
        name="Local Source",
        source_type="local",
        user_id="user-001",
        project_id="proj-001",
        created_at="2024-01-01T00:00:00",
        updated_at="2024-01-01T00:00:00",
    )
    assert resp.opsec_warning is None


# =============================================================================
# AddCommunitySourceRequest tests
# =============================================================================


def test_add_community_source_request_validates():
    """AddCommunitySourceRequest validates project_id and slug."""
    req = AddCommunitySourceRequest(
        project_id="proj-001",
        slug="hacktricks",
    )
    assert req.project_id == "proj-001"
    assert req.slug == "hacktricks"
    assert req.include_paths is None


# =============================================================================
# Community catalog JSON validation
# =============================================================================


def test_community_catalog_json_is_valid():
    """Catalog JSON loads, parses as CatalogEntry list, has unique slugs."""
    catalog_path = Path(__file__).resolve().parent.parent / "data" / "community_catalog.json"
    raw = json.loads(catalog_path.read_text())

    assert isinstance(raw, list)
    assert len(raw) >= 5, f"Expected at least 5 catalog entries, got {len(raw)}"

    entries = [CatalogEntry(**item) for item in raw]
    slugs = [e.slug for e in entries]
    assert len(slugs) == len(set(slugs)), f"Duplicate slugs found: {slugs}"


# =============================================================================
# KnowledgeSourceCreate with include_paths
# =============================================================================


def test_knowledge_source_create_with_include_paths():
    """KnowledgeSourceCreate accepts include_paths field."""
    src = KnowledgeSourceCreate(
        name="Filtered Source",
        source_type="community",
        project_id="proj-001",
        include_paths=["linux-hardening"],
    )
    assert src.include_paths == ["linux-hardening"]
    assert src.project_id == "proj-001"
