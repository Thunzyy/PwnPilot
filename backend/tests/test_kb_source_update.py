"""Integration tests for KB source update, delete, and path validation endpoints.

Tests PATCH /kb/sources/{source_id} (partial update, opsec_acknowledged),
DELETE /kb/sources/{source_id}?delete_files=true (community file removal),
and GET /settings/validate-path (directory, Obsidian vault, missing path).
"""

import uuid
from pathlib import Path

import pytest
from httpx import AsyncClient


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create_project(client: AsyncClient, headers: dict) -> dict:
    """Create a project and return its JSON response."""
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
    source_type: str = "local",
    remote_url: str | None = None,
) -> dict:
    """Create a KB source via the API."""
    body: dict = {
        "name": name,
        "source_type": source_type,
        "path": vault_path,
        "project_id": project_id,
    }
    if remote_url is not None:
        body["remote_url"] = remote_url
    resp = await client.post(
        "/api/v1/kb/sources",
        json=body,
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# PATCH /kb/sources/{source_id} tests
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_update_source_name(
    client: AsyncClient, auth_headers: dict, tmp_path: Path
):
    """PATCH /kb/sources/{id} with name returns 200 and updated name."""
    project = await _create_project(client, auth_headers)
    source = await _create_source(
        client, auth_headers, project["id"], str(tmp_path)
    )

    resp = await client.patch(
        f"/api/v1/kb/sources/{source['id']}",
        json={"name": "Updated Name"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Updated Name"
    assert data["id"] == source["id"]


@pytest.mark.anyio
async def test_update_source_remote_url(
    client: AsyncClient, auth_headers: dict, tmp_path: Path
):
    """PATCH with remote_url populates opsec_warning in response."""
    project = await _create_project(client, auth_headers)
    source = await _create_source(
        client, auth_headers, project["id"], str(tmp_path)
    )
    # Source starts without remote_url
    assert source["remote_url"] is None

    resp = await client.patch(
        f"/api/v1/kb/sources/{source['id']}",
        json={"remote_url": "https://github.com/example/repo"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["remote_url"] == "https://github.com/example/repo"
    # opsec_warning should now be populated by model_validator
    assert data["opsec_warning"] is not None
    assert "remote" in data["opsec_warning"].lower()


@pytest.mark.anyio
async def test_update_source_opsec_acknowledged(
    client: AsyncClient, auth_headers: dict, tmp_path: Path
):
    """PATCH with opsec_acknowledged=true persists acknowledgement."""
    project = await _create_project(client, auth_headers)
    source = await _create_source(
        client, auth_headers, project["id"], str(tmp_path)
    )
    assert source["opsec_acknowledged"] is False

    resp = await client.patch(
        f"/api/v1/kb/sources/{source['id']}",
        json={"opsec_acknowledged": True},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["opsec_acknowledged"] is True


@pytest.mark.anyio
async def test_update_source_partial(
    client: AsyncClient, auth_headers: dict, tmp_path: Path
):
    """PATCH with only name should NOT change path or remote_url."""
    project = await _create_project(client, auth_headers)
    original_path = str(tmp_path)
    source = await _create_source(
        client,
        auth_headers,
        project["id"],
        original_path,
        name="Original",
        remote_url="https://github.com/example/original",
    )

    resp = await client.patch(
        f"/api/v1/kb/sources/{source['id']}",
        json={"name": "New Name Only"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "New Name Only"
    # Other fields unchanged
    assert data["path"] == original_path
    assert data["remote_url"] == "https://github.com/example/original"


@pytest.mark.anyio
async def test_update_source_not_found(
    client: AsyncClient, auth_headers: dict
):
    """PATCH non-existent source returns 404."""
    resp = await client.patch(
        "/api/v1/kb/sources/nonexistent-id",
        json={"name": "Nope"},
        headers=auth_headers,
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /kb/sources/{source_id} with delete_files tests
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_delete_source_without_files(
    client: AsyncClient, auth_headers: dict, tmp_path: Path
):
    """DELETE without delete_files returns 204 and removes source from DB."""
    project = await _create_project(client, auth_headers)
    source = await _create_source(
        client, auth_headers, project["id"], str(tmp_path)
    )

    resp = await client.delete(
        f"/api/v1/kb/sources/{source['id']}",
        headers=auth_headers,
    )
    assert resp.status_code == 204

    # Source no longer in DB
    get_resp = await client.get(
        f"/api/v1/kb/sources/{source['id']}",
        headers=auth_headers,
    )
    assert get_resp.status_code == 404


@pytest.mark.anyio
async def test_delete_community_source_with_files(
    client: AsyncClient, auth_headers: dict, tmp_path: Path
):
    """DELETE community source with delete_files=true removes files from disk."""
    project = await _create_project(client, auth_headers)

    # Create a temp directory simulating community clone
    community_dir = tmp_path / "community_clone"
    community_dir.mkdir()
    (community_dir / "README.md").write_text("# Community Source")
    assert community_dir.exists()

    source = await _create_source(
        client,
        auth_headers,
        project["id"],
        str(community_dir),
        name="Community Vault",
        source_type="community",
    )

    resp = await client.delete(
        f"/api/v1/kb/sources/{source['id']}",
        params={"delete_files": "true"},
        headers=auth_headers,
    )
    assert resp.status_code == 204

    # Community directory should be removed from disk
    assert not community_dir.exists()


# ---------------------------------------------------------------------------
# GET /settings/validate-path tests
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_validate_path_existing_directory(
    client: AsyncClient, auth_headers: dict, tmp_path: Path
):
    """validate-path for real temp directory returns exists=true, is_directory=true."""
    resp = await client.get(
        "/api/v1/settings/validate-path",
        params={"path": str(tmp_path)},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["exists"] is True
    assert data["is_directory"] is True
    assert data["is_obsidian_vault"] is False


@pytest.mark.anyio
async def test_validate_path_obsidian_vault(
    client: AsyncClient, auth_headers: dict, tmp_path: Path
):
    """validate-path for directory with .obsidian returns is_obsidian_vault=true."""
    obsidian_marker = tmp_path / ".obsidian"
    obsidian_marker.mkdir()

    resp = await client.get(
        "/api/v1/settings/validate-path",
        params={"path": str(tmp_path)},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["exists"] is True
    assert data["is_directory"] is True
    assert data["is_obsidian_vault"] is True


@pytest.mark.anyio
async def test_validate_path_not_found(
    client: AsyncClient, auth_headers: dict
):
    """validate-path for missing path returns exists=false."""
    resp = await client.get(
        "/api/v1/settings/validate-path",
        params={"path": "/nonexistent/path/xyz_abc_123"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["exists"] is False
    assert data["is_directory"] is False
    assert data["is_obsidian_vault"] is False
