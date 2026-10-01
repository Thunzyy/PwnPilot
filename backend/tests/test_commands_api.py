import asyncio
from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.deps import get_current_user
from app.database import get_db
from app.main import app
from app.database import Base, init_fts_tables

from tests.conftest import unique_project_name


@pytest.mark.anyio
async def test_global_command_crud(client: AsyncClient, auth_headers):
    payload = {
        "name": "Global Command",
        "category": "Recon",
        "command": "nmap -sV 127.0.0.1",
        "description": "Scan local host",
        "tags": ["nmap", "recon"],
        "is_custom": True,
    }

    create_resp = await client.post(
        "/api/v1/commands", json=payload, headers=auth_headers
    )
    assert create_resp.status_code == 201
    created = create_resp.json()
    assert created["name"] == payload["name"]
    assert created["scope"] == "global"
    assert created["project_id"] is None

    update_payload = {"name": "Updated Command", "tags": ["updated"]}
    update_resp = await client.put(
        f"/api/v1/commands/{created['id']}",
        json=update_payload,
        headers=auth_headers,
    )
    assert update_resp.status_code == 200
    updated = update_resp.json()
    assert updated["name"] == "Updated Command"
    assert updated["tags"] == ["updated"]

    list_resp = await client.get("/api/v1/commands", headers=auth_headers)
    assert list_resp.status_code == 200
    assert any(cmd["id"] == created["id"] for cmd in list_resp.json())

    delete_resp = await client.delete(
        f"/api/v1/commands/{created['id']}",
        headers=auth_headers,
    )
    assert delete_resp.status_code == 204


@pytest.mark.anyio
async def test_project_command_crud(client: AsyncClient, auth_headers):
    project_payload = {
        "name": unique_project_name(),
        "type": "custom",
        "variables": {"target_ip": "10.10.10.2"},
    }
    project_resp = await client.post(
        "/api/v1/projects", json=project_payload, headers=auth_headers
    )
    assert project_resp.status_code == 201
    project_id = project_resp.json()["id"]

    payload = {
        "name": "Project Command",
        "category": "Web",
        "command": "curl http://example.com",
        "description": "Fetch page",
        "tags": ["web", "curl"],
        "is_custom": True,
    }
    create_resp = await client.post(
        f"/api/v1/projects/{project_id}/commands",
        json=payload,
        headers=auth_headers,
    )
    assert create_resp.status_code == 201
    created = create_resp.json()
    assert created["name"] == payload["name"]
    assert created["scope"] == "project"
    assert created["project_id"] == project_id

    update_payload = {"category": "Web Exploitation"}
    update_resp = await client.put(
        f"/api/v1/projects/{project_id}/commands/{created['id']}",
        json=update_payload,
        headers=auth_headers,
    )
    assert update_resp.status_code == 200
    updated = update_resp.json()
    assert updated["category"] == "Web Exploitation"

    list_resp = await client.get(
        f"/api/v1/projects/{project_id}/commands", headers=auth_headers
    )
    assert list_resp.status_code == 200
    assert any(cmd["id"] == created["id"] for cmd in list_resp.json())

    delete_resp = await client.delete(
        f"/api/v1/projects/{project_id}/commands/{created['id']}",
        headers=auth_headers,
    )
    assert delete_resp.status_code == 204


@pytest.mark.anyio
async def test_seed_commands_is_idempotent_under_concurrent_requests(tmp_path):
    database_url = f"sqlite+aiosqlite:///{(tmp_path / 'seed-concurrency.db').as_posix()}"
    engine = create_async_engine(database_url, echo=False)
    session_maker = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await init_fts_tables(conn)

    async def get_concurrent_test_db():
        async with session_maker() as session:
            yield session

    async def get_stub_user():
        return SimpleNamespace(id="smoke-user")

    app.dependency_overrides[get_db] = get_concurrent_test_db
    app.dependency_overrides[get_current_user] = get_stub_user
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as first_client, AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as second_client:
            first, second = await asyncio.gather(
                first_client.post("/api/v1/commands/seed"),
                second_client.post("/api/v1/commands/seed"),
            )

            list_resp = await first_client.get("/api/v1/commands")
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()

    assert first.status_code == 201
    assert second.status_code == 201

    assert list_resp.status_code == 200

    commands = list_resp.json()
    command_ids = [command["id"] for command in commands]
    assert commands
    assert len(command_ids) == len(set(command_ids))
