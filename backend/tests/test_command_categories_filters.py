import pytest
from httpx import AsyncClient

from tests.conftest import unique_project_name


@pytest.mark.anyio
async def test_global_command_categories_crud(client: AsyncClient, auth_headers):
    payload = {"name": "Recon", "sort_order": 1}
    create_resp = await client.post(
        "/api/v1/command-categories", json=payload, headers=auth_headers
    )
    assert create_resp.status_code == 201
    created = create_resp.json()
    assert created["name"] == "Recon"
    assert created["scope"] == "global"
    assert created["project_id"] is None
    assert created["sort_order"] == 1

    update_payload = {"name": "Recon Updated"}
    update_resp = await client.put(
        f"/api/v1/command-categories/{created['id']}",
        json=update_payload,
        headers=auth_headers,
    )
    assert update_resp.status_code == 200
    updated = update_resp.json()
    assert updated["name"] == "Recon Updated"

    list_resp = await client.get(
        "/api/v1/command-categories", headers=auth_headers
    )
    assert list_resp.status_code == 200
    assert any(cat["id"] == created["id"] for cat in list_resp.json())

    delete_resp = await client.delete(
        f"/api/v1/command-categories/{created['id']}", headers=auth_headers
    )
    assert delete_resp.status_code == 204


@pytest.mark.anyio
async def test_project_command_categories_crud(client: AsyncClient, auth_headers):
    project_payload = {
        "name": unique_project_name(),
        "type": "custom",
        "variables": {"target_ip": "10.10.10.4"},
    }
    project_resp = await client.post(
        "/api/v1/projects", json=project_payload, headers=auth_headers
    )
    assert project_resp.status_code == 201
    project_id = project_resp.json()["id"]

    payload = {"name": "Web", "sort_order": 2}
    create_resp = await client.post(
        f"/api/v1/projects/{project_id}/command-categories",
        json=payload,
        headers=auth_headers,
    )
    assert create_resp.status_code == 201
    created = create_resp.json()
    assert created["name"] == "Web"
    assert created["scope"] == "project"
    assert created["project_id"] == project_id
    assert created["sort_order"] == 2

    update_payload = {"name": "Web Updated"}
    update_resp = await client.put(
        f"/api/v1/projects/{project_id}/command-categories/{created['id']}",
        json=update_payload,
        headers=auth_headers,
    )
    assert update_resp.status_code == 200
    updated = update_resp.json()
    assert updated["name"] == "Web Updated"

    list_resp = await client.get(
        f"/api/v1/projects/{project_id}/command-categories",
        headers=auth_headers,
    )
    assert list_resp.status_code == 200
    assert any(cat["id"] == created["id"] for cat in list_resp.json())

    delete_resp = await client.delete(
        f"/api/v1/projects/{project_id}/command-categories/{created['id']}",
        headers=auth_headers,
    )
    assert delete_resp.status_code == 204


@pytest.mark.anyio
async def test_global_command_filters_crud(client: AsyncClient, auth_headers):
    payload = {"name": "Nmap", "sort_order": 10}
    create_resp = await client.post(
        "/api/v1/command-filters", json=payload, headers=auth_headers
    )
    assert create_resp.status_code == 201
    created = create_resp.json()
    assert created["name"] == "Nmap"
    assert created["scope"] == "global"
    assert created["project_id"] is None
    assert created["sort_order"] == 10

    update_payload = {"name": "Nmap Updated"}
    update_resp = await client.put(
        f"/api/v1/command-filters/{created['id']}",
        json=update_payload,
        headers=auth_headers,
    )
    assert update_resp.status_code == 200
    updated = update_resp.json()
    assert updated["name"] == "Nmap Updated"

    list_resp = await client.get("/api/v1/command-filters", headers=auth_headers)
    assert list_resp.status_code == 200
    assert any(item["id"] == created["id"] for item in list_resp.json())

    delete_resp = await client.delete(
        f"/api/v1/command-filters/{created['id']}", headers=auth_headers
    )
    assert delete_resp.status_code == 204


@pytest.mark.anyio
async def test_project_command_filters_crud(client: AsyncClient, auth_headers):
    project_payload = {
        "name": unique_project_name(),
        "type": "custom",
        "variables": {"target_ip": "10.10.10.5"},
    }
    project_resp = await client.post(
        "/api/v1/projects", json=project_payload, headers=auth_headers
    )
    assert project_resp.status_code == 201
    project_id = project_resp.json()["id"]

    payload = {"name": "Hydra", "sort_order": 3}
    create_resp = await client.post(
        f"/api/v1/projects/{project_id}/command-filters",
        json=payload,
        headers=auth_headers,
    )
    assert create_resp.status_code == 201
    created = create_resp.json()
    assert created["name"] == "Hydra"
    assert created["scope"] == "project"
    assert created["project_id"] == project_id
    assert created["sort_order"] == 3

    update_payload = {"name": "Hydra Updated"}
    update_resp = await client.put(
        f"/api/v1/projects/{project_id}/command-filters/{created['id']}",
        json=update_payload,
        headers=auth_headers,
    )
    assert update_resp.status_code == 200
    updated = update_resp.json()
    assert updated["name"] == "Hydra Updated"

    list_resp = await client.get(
        f"/api/v1/projects/{project_id}/command-filters", headers=auth_headers
    )
    assert list_resp.status_code == 200
    assert any(item["id"] == created["id"] for item in list_resp.json())

    delete_resp = await client.delete(
        f"/api/v1/projects/{project_id}/command-filters/{created['id']}",
        headers=auth_headers,
    )
    assert delete_resp.status_code == 204
