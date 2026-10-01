import pytest
from httpx import AsyncClient


@pytest.mark.anyio
async def test_signup_first_user_is_super_admin(client: AsyncClient):
    payload = {
        "username": "admin",
        "email": "admin@example.com",
        "password": "secret123",
    }
    response = await client.post("/api/v1/auth/signup", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["username"] == "admin"
    assert data["is_super_admin"] is True
    assert "password_hash" not in data


@pytest.mark.anyio
async def test_signup_rejects_duplicate_username(client: AsyncClient):
    payload = {
        "username": "dup",
        "email": "dup@example.com",
        "password": "secret123",
    }
    await client.post("/api/v1/auth/signup", json=payload)
    response = await client.post("/api/v1/auth/signup", json=payload)
    assert response.status_code == 409
