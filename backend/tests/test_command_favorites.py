import pytest
from httpx import AsyncClient

from tests.conftest import unique_project_name


@pytest.mark.anyio
async def test_global_command_favorite_toggle(client: AsyncClient, auth_headers):
    payload = {
        "name": "Favorite Command",
        "category": "Recon",
        "command": "whoami",
        "description": "Identity",
        "tags": ["misc"],
        "is_custom": True,
    }
    create_resp = await client.post(
        "/api/v1/commands", json=payload, headers=auth_headers
    )
    assert create_resp.status_code == 201
    command_id = create_resp.json()["id"]

    favorite_resp = await client.post(
        f"/api/v1/commands/{command_id}/favorite", headers=auth_headers
    )
    assert favorite_resp.status_code == 201

    list_resp = await client.get("/api/v1/commands/favorites", headers=auth_headers)
    assert list_resp.status_code == 200
    assert command_id in list_resp.json()

    delete_resp = await client.delete(
        f"/api/v1/commands/{command_id}/favorite", headers=auth_headers
    )
    assert delete_resp.status_code == 204

    list_resp = await client.get("/api/v1/commands/favorites", headers=auth_headers)
    assert list_resp.status_code == 200
    assert command_id not in list_resp.json()


@pytest.mark.anyio
async def test_project_command_favorite_toggle(client: AsyncClient, auth_headers):
    project_payload = {
        "name": unique_project_name(),
        "type": "custom",
        "variables": {"target_ip": "10.10.10.3"},
    }
    project_resp = await client.post(
        "/api/v1/projects", json=project_payload, headers=auth_headers
    )
    assert project_resp.status_code == 201
    project_id = project_resp.json()["id"]

    payload = {
        "name": "Project Favorite",
        "category": "Web",
        "command": "curl http://example.org",
        "description": "Fetch page",
        "tags": ["web"],
        "is_custom": True,
    }
    create_resp = await client.post(
        f"/api/v1/projects/{project_id}/commands",
        json=payload,
        headers=auth_headers,
    )
    assert create_resp.status_code == 201
    command_id = create_resp.json()["id"]

    favorite_resp = await client.post(
        f"/api/v1/projects/{project_id}/commands/{command_id}/favorite",
        headers=auth_headers,
    )
    assert favorite_resp.status_code == 201

    list_resp = await client.get(
        f"/api/v1/projects/{project_id}/commands/favorites",
        headers=auth_headers,
    )
    assert list_resp.status_code == 200
    assert command_id in list_resp.json()

    delete_resp = await client.delete(
        f"/api/v1/projects/{project_id}/commands/{command_id}/favorite",
        headers=auth_headers,
    )
    assert delete_resp.status_code == 204

    list_resp = await client.get(
        f"/api/v1/projects/{project_id}/commands/favorites",
        headers=auth_headers,
    )
    assert list_resp.status_code == 200
    assert command_id not in list_resp.json()
