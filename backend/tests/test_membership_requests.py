import pytest
from httpx import AsyncClient

from tests.conftest import unique_project_name


async def _signup_login(client: AsyncClient, username: str, email: str) -> str:
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
async def test_access_request_flow(client: AsyncClient):
    admin_token = await _signup_login(client, "admin", "admin@example.com")
    user_token = await _signup_login(client, "user", "user@example.com")

    project = await client.post(
        "/api/v1/projects",
        json={"name": unique_project_name(), "type": "htb"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    project_id = project.json()["id"]

    request = await client.post(
        f"/api/v1/projects/{project_id}/access-requests",
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert request.status_code == 201
    assert request.json()["username"] == "user"
    assert request.json()["email"] == "user@example.com"
    assert request.json()["status"] == "pending"

    approvals = await client.get(
        f"/api/v1/projects/{project_id}/memberships",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert approvals.status_code == 200
    assert any(
        m["status"] == "pending"
        and m["username"] == "user"
        and m["email"] == "user@example.com"
        for m in approvals.json()
    )


@pytest.mark.anyio
async def test_invite_returns_collaborator_identity(client: AsyncClient):
    admin_token = await _signup_login(client, "admin2", "admin2@example.com")
    user_token = await _signup_login(client, "invitee", "invitee@example.com")

    project = await client.post(
        "/api/v1/projects",
        json={"name": unique_project_name(), "type": "htb"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    project_id = project.json()["id"]

    invite = await client.post(
        f"/api/v1/projects/{project_id}/invites",
        json={"username_or_email": "invitee", "role": "member"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert invite.status_code == 201
    invite_body = invite.json()
    assert invite_body["username"] == "invitee"
    assert invite_body["email"] == "invitee@example.com"
    assert invite_body["status"] == "active"

    invited_projects = await client.get(
        "/api/v1/projects",
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert invited_projects.status_code == 200
    assert any(item["id"] == project_id for item in invited_projects.json())
