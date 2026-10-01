from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.schemas.engagement import EngagementStateBase
from app.services.engagement_provider import (
    CommandHistoryEventProvider,
    EngagementHistoryEvent,
    GraphEventProvider,
    McpEngagementEventProvider,
    McpEngagementStateStore,
    ProjectVariableEngagementStateStore,
)


class _FakeScalars:
    def __init__(self, values):
        self._values = values

    def all(self):
        return self._values


class _FakeResult:
    def __init__(self, values):
        self._values = values

    def scalars(self):
        return _FakeScalars(self._values)


class _FakeDB:
    def __init__(self, values):
        self.values = values
        self.executed = False

    async def execute(self, _statement):
        self.executed = True
        return _FakeResult(self.values)


@pytest.mark.anyio
async def test_command_history_event_provider_reads_events_from_db():
    commands = [SimpleNamespace(id="c1"), SimpleNamespace(id="c2")]
    db = _FakeDB(commands)
    provider = CommandHistoryEventProvider()

    result = await provider.list_events(db=db, project_id="project-1")

    assert db.executed is True
    assert [entry.id for entry in result] == ["c1", "c2"]


@pytest.mark.anyio
async def test_graph_event_provider_reads_attack_graph_nodes_as_events():
    graph_nodes = [
        SimpleNamespace(
            id="g1",
            type="credential",
            label="Credential: nathan",
            tags=["history", "credential", "ftp"],
            notes=None,
            created_at=datetime(2026, 2, 10, tzinfo=timezone.utc),
        ),
        SimpleNamespace(
            id="g2",
            type="finding",
            label="python3.8 cap_setuid",
            tags=["history", "privesc", "cap_setuid"],
            notes="Python has cap_setuid+ep.",
            created_at=datetime(2026, 2, 10, 0, 1, tzinfo=timezone.utc),
        ),
    ]
    db = _FakeDB(graph_nodes)
    provider = GraphEventProvider()

    result = await provider.list_events(db=db, project_id="project-1")

    assert db.executed is True
    assert [entry.id for entry in result] == ["graph-node:g1", "graph-node:g2"]
    assert result[0].kind == "graph_node"
    assert "credential" in result[0].command.lower()
    assert "cap_setuid" in result[1].command
    assert result[1].section_hint == "privesc"


@pytest.mark.anyio
async def test_project_variable_state_store_roundtrip():
    store = ProjectVariableEngagementStateStore(storage_key="__engagement_state_test")
    project = SimpleNamespace(variables={})
    state = EngagementStateBase(progress=33)

    await store.write(project, state)
    restored = await store.read(project)

    assert restored is not None
    assert restored.progress == 33
    assert restored.version == "v1"


@pytest.mark.anyio
async def test_project_variable_state_store_ignores_invalid_json():
    store = ProjectVariableEngagementStateStore(storage_key="__engagement_state_test")
    project = SimpleNamespace(variables={"__engagement_state_test": "{bad json"})

    assert await store.read(project) is None


class _FallbackProvider:
    def __init__(self, events: list[EngagementHistoryEvent]):
        self.events = events
        self.calls = 0

    async def list_events(self, *, db, project_id: str) -> list[EngagementHistoryEvent]:
        self.calls += 1
        return self.events


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _FallbackStateStore:
    def __init__(self, state: EngagementStateBase | None = None):
        self.state = state
        self.read_calls = 0
        self.write_calls = 0

    async def read(self, project):
        self.read_calls += 1
        return self.state

    async def write(self, project, state: EngagementStateBase):
        self.write_calls += 1
        self.state = state


@pytest.mark.anyio
async def test_mcp_event_provider_decodes_events_payload():
    created_at = "2026-02-10T15:00:00Z"
    payload = {
        "events": [
            {
                "id": "evt-1",
                "command": "nmap -sV 10.10.10.10",
                "exit_code": 0,
                "created_at": created_at,
            },
            {
                "id": "evt-2",
                "command": "hydra -l admin -P list ssh://10.10.10.10",
                "exit_code": 1,
                "created_at": "2026-02-10T15:00:01Z",
            },
        ]
    }
    fallback = _FallbackProvider(events=[])
    provider = McpEngagementEventProvider(
        base_url="http://localhost:9000",
        fallback_provider=fallback,
    )

    with patch(
        "app.services.engagement_provider.httpx.AsyncClient.get",
        new=AsyncMock(return_value=_FakeResponse(payload)),
    ):
        events = await provider.list_events(db=SimpleNamespace(), project_id="project-1")

    assert [event.id for event in events] == ["evt-1", "evt-2"]
    assert events[0].created_at == datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    assert fallback.calls == 0


@pytest.mark.anyio
async def test_mcp_event_provider_falls_back_when_request_fails():
    fallback_events = [
        EngagementHistoryEvent(
            id="local-1",
            command="nmap -sV 10.10.10.10",
            exit_code=0,
            created_at=datetime.now(timezone.utc),
        )
    ]
    fallback = _FallbackProvider(events=fallback_events)
    provider = McpEngagementEventProvider(
        base_url="http://localhost:9000",
        fallback_provider=fallback,
    )

    with patch(
        "app.services.engagement_provider.httpx.AsyncClient.get",
        new=AsyncMock(side_effect=RuntimeError("connection failed")),
    ):
        events = await provider.list_events(db=SimpleNamespace(), project_id="project-1")

    assert [event.id for event in events] == ["local-1"]
    assert fallback.calls == 1


@pytest.mark.anyio
async def test_mcp_state_store_reads_remote_state():
    fallback = _FallbackStateStore(state=None)
    store = McpEngagementStateStore(
        base_url="http://localhost:9000",
        fallback_store=fallback,
    )
    project = SimpleNamespace(id="project-1", variables={})
    payload = {"version": "v1", "sections": [], "graph": {"nodes": [], "edges": []}, "progress": 37}

    with patch(
        "app.services.engagement_provider.httpx.AsyncClient.get",
        new=AsyncMock(return_value=_FakeResponse(payload)),
    ):
        state = await store.read(project)

    assert state is not None
    assert state.progress == 37
    assert fallback.read_calls == 0


@pytest.mark.anyio
async def test_mcp_state_store_falls_back_on_read_error():
    fallback = _FallbackStateStore(state=EngagementStateBase(progress=22))
    store = McpEngagementStateStore(
        base_url="http://localhost:9000",
        fallback_store=fallback,
    )
    project = SimpleNamespace(id="project-1", variables={})

    with patch(
        "app.services.engagement_provider.httpx.AsyncClient.get",
        new=AsyncMock(side_effect=RuntimeError("read failed")),
    ):
        state = await store.read(project)

    assert state is not None
    assert state.progress == 22
    assert fallback.read_calls == 1


@pytest.mark.anyio
async def test_mcp_state_store_returns_none_on_404_without_local_fallback():
    fallback = _FallbackStateStore(state=EngagementStateBase(progress=22))
    store = McpEngagementStateStore(
        base_url="http://localhost:9000",
        fallback_store=fallback,
    )
    project = SimpleNamespace(id="project-1", variables={})
    response = httpx.Response(
        status_code=404,
        request=httpx.Request("GET", "http://localhost:9000/projects/project-1/engagement-state"),
    )

    with patch(
        "app.services.engagement_provider.httpx.AsyncClient.get",
        new=AsyncMock(return_value=response),
    ):
        state = await store.read(project)

    assert state is None
    assert fallback.read_calls == 0


@pytest.mark.anyio
async def test_mcp_state_store_falls_back_on_non_404_http_error():
    fallback = _FallbackStateStore(state=EngagementStateBase(progress=22))
    store = McpEngagementStateStore(
        base_url="http://localhost:9000",
        fallback_store=fallback,
    )
    project = SimpleNamespace(id="project-1", variables={})
    response = httpx.Response(
        status_code=503,
        request=httpx.Request("GET", "http://localhost:9000/projects/project-1/engagement-state"),
    )

    with patch(
        "app.services.engagement_provider.httpx.AsyncClient.get",
        new=AsyncMock(return_value=response),
    ):
        state = await store.read(project)

    assert state is not None
    assert state.progress == 22
    assert fallback.read_calls == 1


@pytest.mark.anyio
async def test_mcp_state_store_falls_back_on_write_error():
    fallback = _FallbackStateStore(state=None)
    store = McpEngagementStateStore(
        base_url="http://localhost:9000",
        fallback_store=fallback,
    )
    project = SimpleNamespace(id="project-1", variables={})
    state = EngagementStateBase(progress=44)

    with patch(
        "app.services.engagement_provider.httpx.AsyncClient.put",
        new=AsyncMock(side_effect=RuntimeError("write failed")),
    ):
        await store.write(project, state)

    assert fallback.write_calls == 1
    assert fallback.state is not None
    assert fallback.state.progress == 44
