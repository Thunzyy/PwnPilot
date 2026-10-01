import pytest
from httpx import AsyncClient

from tests.conftest import unique_project_name


@pytest.mark.anyio
async def test_timeline_requires_membership(client: AsyncClient):
    await client.post(
        "/api/v1/auth/signup",
        json={"username": "admin", "email": "admin@example.com", "password": "secret123"},
    )
    login = await client.post(
        "/api/v1/auth/login",
        json={"username_or_email": "admin", "password": "secret123"},
    )
    token = login.json()["access_token"]
    project = await client.post(
        "/api/v1/projects",
        json={"name": unique_project_name(), "type": "htb"},
        headers={"Authorization": f"Bearer {token}"},
    )
    project_id = project.json()["id"]

    response = await client.get(f"/api/v1/projects/{project_id}/timeline")
    assert response.status_code == 401


@pytest.mark.anyio
async def test_timeline_entry_creation_returns_serialized_timestamp(client: AsyncClient):
    await client.post(
        "/api/v1/auth/signup",
        json={
            "username": "operator",
            "email": "operator@example.com",
            "password": "secret123",
        },
    )
    login = await client.post(
        "/api/v1/auth/login",
        json={"username_or_email": "operator", "password": "secret123"},
    )
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    project = await client.post(
        "/api/v1/projects",
        json={"name": unique_project_name(), "type": "htb"},
        headers=headers,
    )
    project_id = project.json()["id"]

    response = await client.post(
        f"/api/v1/projects/{project_id}/timeline",
        json={
            "type": "note",
            "content": "Captured exposed Grafana login page",
            "output": "HTTP 200 on /login",
        },
        headers=headers,
    )

    assert response.status_code == 201
    data = response.json()
    assert data["content"] == "Captured exposed Grafana login page"
    assert data["output"] == "HTTP 200 on /login"
    assert isinstance(data["created_at"], str)
