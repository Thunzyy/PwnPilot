import pytest
from httpx import AsyncClient


@pytest.mark.anyio
async def test_login_refresh_logout_flow(client: AsyncClient):
    payload = {
        "username": "user1",
        "email": "user1@example.com",
        "password": "secret123",
    }
    await client.post("/api/v1/auth/signup", json=payload)

    login = await client.post(
        "/api/v1/auth/login",
        json={"username_or_email": "user1", "password": "secret123"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    assert token
    login_cookie = login.headers.get("set-cookie", "")
    assert "refresh_token=" in login_cookie
    assert "Max-Age=" in login_cookie
    assert "expires=" in login_cookie.lower()

    refresh = await client.post("/api/v1/auth/refresh")
    assert refresh.status_code == 200
    assert refresh.json()["access_token"]
    refresh_cookie = refresh.headers.get("set-cookie", "")
    assert "refresh_token=" in refresh_cookie
    assert "Max-Age=" in refresh_cookie
    assert "expires=" in refresh_cookie.lower()

    logout = await client.post("/api/v1/auth/logout")
    assert logout.status_code == 204
