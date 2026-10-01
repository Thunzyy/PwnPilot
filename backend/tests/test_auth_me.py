import pytest
from httpx import AsyncClient


@pytest.mark.anyio
async def test_auth_me_requires_token(client: AsyncClient):
    response = await client.get("/api/v1/auth/me")
    assert response.status_code == 401


@pytest.mark.anyio
async def test_auth_me_returns_profile(client: AsyncClient):
    await client.post(
        "/api/v1/auth/signup",
        json={"username": "me1", "email": "me@example.com", "password": "secret123"},
    )
    login = await client.post(
        "/api/v1/auth/login",
        json={"username_or_email": "me1", "password": "secret123"},
    )
    token = login.json()["access_token"]
    response = await client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    assert response.json()["username"] == "me1"
