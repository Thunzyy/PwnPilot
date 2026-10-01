import pytest
from httpx import AsyncClient


@pytest.mark.anyio
async def test_cors_allows_local_dev_vite_ports(client: AsyncClient):
    response = await client.options(
        "/api/v1/auth/login",
        headers={
            "Origin": "http://127.0.0.1:5177",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5177"


@pytest.mark.anyio
async def test_cors_rejects_unknown_origins(client: AsyncClient):
    response = await client.options(
        "/api/v1/auth/login",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers
