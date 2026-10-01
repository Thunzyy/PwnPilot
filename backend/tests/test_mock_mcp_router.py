from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient


@pytest.mark.anyio
async def test_mock_mcp_events_roundtrip(client: AsyncClient):
    project_id = f"mock-{uuid.uuid4().hex[:8]}"

    response = await client.get(f"/api/v1/mcp/mock/projects/{project_id}/engagement-events")
    assert response.status_code == 200
    assert response.json() == {"events": []}

    payload = {
        "events": [
            {
                "id": "evt-1",
                "command": "nmap -sV 10.10.10.10",
                "exit_code": 0,
                "created_at": "2026-02-10T16:00:00Z",
            },
            {
                "id": "evt-2",
                "command": "hydra -l admin -P list ssh://10.10.10.10",
                "exit_code": 1,
                "created_at": "2026-02-10T16:00:01Z",
            },
        ]
    }
    put_response = await client.put(
        f"/api/v1/mcp/mock/projects/{project_id}/engagement-events",
        json=payload,
    )
    assert put_response.status_code == 200
    assert len(put_response.json()["events"]) == 2

    refreshed = await client.get(f"/api/v1/mcp/mock/projects/{project_id}/engagement-events")
    assert refreshed.status_code == 200
    assert [event["id"] for event in refreshed.json()["events"]] == ["evt-1", "evt-2"]


@pytest.mark.anyio
async def test_mock_mcp_state_404_when_missing_then_roundtrip(client: AsyncClient):
    project_id = f"mock-{uuid.uuid4().hex[:8]}"

    missing = await client.get(f"/api/v1/mcp/mock/projects/{project_id}/engagement-state")
    assert missing.status_code == 404

    payload = {
        "version": "v1",
        "sections": [],
        "graph": {"nodes": [], "edges": []},
        "progress": 51,
    }
    put_response = await client.put(
        f"/api/v1/mcp/mock/projects/{project_id}/engagement-state",
        json=payload,
    )
    assert put_response.status_code == 200
    assert put_response.json()["progress"] == 51

    fetched = await client.get(f"/api/v1/mcp/mock/projects/{project_id}/engagement-state")
    assert fetched.status_code == 200
    assert fetched.json()["progress"] == 51


@pytest.mark.anyio
async def test_mock_mcp_seed_creates_scenario_events(client: AsyncClient):
    project_id = f"mock-{uuid.uuid4().hex[:8]}"

    seed = await client.post(f"/api/v1/mcp/mock/projects/{project_id}/seed/full_path")
    assert seed.status_code == 200
    assert seed.json()["scenario"] == "full_path"
    assert seed.json()["event_count"] > 3

    events = await client.get(f"/api/v1/mcp/mock/projects/{project_id}/engagement-events")
    assert events.status_code == 200
    assert len(events.json()["events"]) == seed.json()["event_count"]


@pytest.mark.anyio
async def test_mock_mcp_seed_pwnbox_real_contains_realistic_commands(client: AsyncClient):
    project_id = f"mock-{uuid.uuid4().hex[:8]}"

    seed = await client.post(f"/api/v1/mcp/mock/projects/{project_id}/seed/pwnbox_real")
    assert seed.status_code == 200
    assert seed.json()["scenario"] == "pwnbox_real"
    assert seed.json()["event_count"] >= 8

    events = await client.get(f"/api/v1/mcp/mock/projects/{project_id}/engagement-events")
    assert events.status_code == 200
    commands = [event["command"].lower() for event in events.json()["events"]]
    assert any("nmap" in command for command in commands)
    assert any("ffuf" in command for command in commands)
    assert any("sqlmap" in command for command in commands)
    assert any("bloodhound" in command for command in commands)
