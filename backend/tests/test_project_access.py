import pytest
from httpx import AsyncClient

from tests.conftest import unique_project_name


async def _signup_and_login(client: AsyncClient, username: str, email: str) -> str:
    await client.post(
        "/api/v1/auth/signup",
        json={"username": username, "email": email, "password": "secret123"},
    )
    login = await client.post(
        "/api/v1/auth/login",
        json={"username_or_email": username, "password": "secret123"},
    )
    return login.json()["access_token"]


@pytest.mark.anyio
async def test_project_list_is_scoped_by_membership(client: AsyncClient):
    admin_token = await _signup_and_login(client, "admin", "admin@example.com")
    user_token = await _signup_and_login(client, "user", "user@example.com")

    project = await client.post(
        "/api/v1/projects",
        json={"name": unique_project_name(), "type": "htb"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    project_id = project.json()["id"]

    response = await client.get(
        "/api/v1/projects", headers={"Authorization": f"Bearer {user_token}"}
    )
    assert response.status_code == 200
    assert response.json() == []

    forbidden = await client.get(
        f"/api/v1/projects/{project_id}",
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["details"]["membership_status"] == "none"


@pytest.mark.anyio
async def test_project_get_reports_pending_membership_status(client: AsyncClient):
    admin_token = await _signup_and_login(
        client, "pending-admin", "pending-admin@example.com"
    )
    user_token = await _signup_and_login(
        client, "pending-user", "pending-user@example.com"
    )

    project = await client.post(
        "/api/v1/projects",
        json={"name": unique_project_name(), "type": "htb"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    project_id = project.json()["id"]

    request_access = await client.post(
        f"/api/v1/projects/{project_id}/access-requests",
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert request_access.status_code == 201

    forbidden = await client.get(
        f"/api/v1/projects/{project_id}",
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["details"]["membership_status"] == "pending"


@pytest.mark.anyio
async def test_project_get_reports_denied_membership_status(client: AsyncClient):
    admin_token = await _signup_and_login(
        client, "denied-admin", "denied-admin@example.com"
    )
    user_token = await _signup_and_login(
        client, "denied-user", "denied-user@example.com"
    )

    project = await client.post(
        "/api/v1/projects",
        json={"name": unique_project_name(), "type": "htb"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    project_id = project.json()["id"]

    request_access = await client.post(
        f"/api/v1/projects/{project_id}/access-requests",
        headers={"Authorization": f"Bearer {user_token}"},
    )
    membership_id = request_access.json()["id"]

    deny = await client.patch(
        f"/api/v1/projects/{project_id}/memberships/{membership_id}",
        json={"status": "denied"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert deny.status_code == 200

    forbidden = await client.get(
        f"/api/v1/projects/{project_id}",
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["details"]["membership_status"] == "denied"
