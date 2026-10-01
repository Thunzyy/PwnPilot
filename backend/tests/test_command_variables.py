import pytest
from httpx import AsyncClient


@pytest.mark.anyio
async def test_command_variables_get_and_put(client: AsyncClient, auth_headers):
    get_resp = await client.get("/api/v1/commands/variables", headers=auth_headers)
    assert get_resp.status_code == 200
    assert get_resp.json() == {}

    payload = {"target_ip": "10.10.10.6", "port": "443"}
    put_resp = await client.put(
        "/api/v1/commands/variables", json=payload, headers=auth_headers
    )
    assert put_resp.status_code == 200
    assert put_resp.json() == payload

    get_resp = await client.get("/api/v1/commands/variables", headers=auth_headers)
    assert get_resp.status_code == 200
    assert get_resp.json() == payload
