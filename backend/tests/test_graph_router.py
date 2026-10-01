from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai import AIChatMessage, AIConversation, AIMemory
from app.models.command_history import CommandHistory
from app.models.graph import GraphEdgeDB, GraphNodeDB
from app.models.knowledge import KnowledgeDoc, KnowledgeSource
from app.models.timeline import Timeline


def _auth(headers: dict[str, str]) -> dict[str, str]:
    return {"Authorization": headers["Authorization"]}


async def _create_project(client: AsyncClient, headers: dict[str, str]) -> dict:
    response = await client.post(
        "/api/v1/projects",
        json={"name": f"Graph {uuid.uuid4().hex[:8]}", "type": "htb"},
        headers=_auth(headers),
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.anyio
async def test_graph_demo_seed_populates_workspace_and_returns_typed_graph(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)

    response = await client.post(
        f"/api/v1/projects/{project['id']}/graph/demo-ctf",
        headers=_auth(auth_headers),
    )

    assert response.status_code == 200, response.text
    payload = response.json()

    assert payload["source"] == "stored"
    assert payload["project_id"] == project["id"]
    assert payload["active_scenario_id"]
    assert payload["scenarios"]
    assert payload["nodes"]
    assert payload["edges"]

    node_types = {node["type"] for node in payload["nodes"]}
    assert {
        "host",
        "service",
        "credential",
        "session",
        "finding",
        "loot",
        "user",
        "action",
        "artifact",
    }.issubset(node_types)

    assert any(node["label"] == "WEB01" for node in payload["nodes"])
    assert any(node["label"] == "FILE01" for node in payload["nodes"])
    assert any(edge["kind"] == "authenticates_to" for edge in payload["edges"])
    assert any(edge["kind"] == "opens_session_on" for edge in payload["edges"])
    assert all(isinstance(node["sequence_index"], int) for node in payload["nodes"])
    assert all(isinstance(edge["sequence_index"], int) for edge in payload["edges"])

    command_count = await test_db.scalar(
        select(func.count(CommandHistory.id)).where(
            CommandHistory.project_id == project["id"]
        )
    )
    timeline_count = await test_db.scalar(
        select(func.count(Timeline.id)).where(Timeline.project_id == project["id"])
    )
    conversation_count = await test_db.scalar(
        select(func.count(AIConversation.id)).where(
            AIConversation.project_id == project["id"]
        )
    )
    message_count = await test_db.scalar(
        select(func.count(AIChatMessage.id))
        .join(AIConversation, AIChatMessage.conversation_id == AIConversation.id)
        .where(AIConversation.project_id == project["id"])
    )
    memory_count = await test_db.scalar(
        select(func.count(AIMemory.id)).where(AIMemory.project_id == project["id"])
    )
    doc_count = await test_db.scalar(
        select(func.count(KnowledgeDoc.id))
        .join(KnowledgeSource, KnowledgeDoc.source_id == KnowledgeSource.id)
        .where(KnowledgeSource.project_id == project["id"])
    )

    assert (command_count or 0) >= 8
    assert (timeline_count or 0) >= 4
    assert (conversation_count or 0) >= 1
    assert (message_count or 0) >= 2
    assert (memory_count or 0) >= 1
    assert (doc_count or 0) >= 2


@pytest.mark.anyio
async def test_graph_demo_seed_assigns_stable_contiguous_sequence_indexes(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)

    response = await client.post(
        f"/api/v1/projects/{project['id']}/graph/demo-ctf",
        headers=_auth(auth_headers),
    )

    assert response.status_code == 200, response.text
    payload = response.json()

    node_indexes = [node["sequence_index"] for node in payload["nodes"]]
    edge_indexes = [edge["sequence_index"] for edge in payload["edges"]]

    assert node_indexes == sorted(node_indexes)
    assert edge_indexes == sorted(edge_indexes)
    assert node_indexes == list(range(1, len(node_indexes) + 1))
    assert edge_indexes == list(range(1, len(edge_indexes) + 1))

    db_node_indexes = (
        await test_db.execute(
            select(GraphNodeDB.sequence_index)
            .where(
                GraphNodeDB.project_id == project["id"],
                GraphNodeDB.is_deleted.is_(False),
            )
            .order_by(GraphNodeDB.sequence_index.asc())
        )
    ).scalars().all()
    db_edge_indexes = (
        await test_db.execute(
            select(GraphEdgeDB.sequence_index)
            .where(GraphEdgeDB.project_id == project["id"])
            .order_by(GraphEdgeDB.sequence_index.asc())
        )
    ).scalars().all()

    assert db_node_indexes == node_indexes
    assert db_edge_indexes == edge_indexes
    assert payload["nodes"][0]["label"] == "nmap -sV -Pn 10.10.110.10 10.10.110.20"
    assert payload["edges"][0]["kind"] == "runs_on"


@pytest.mark.anyio
async def test_graph_paths_returns_shortest_chain_from_initial_access_to_root_loot(
    client: AsyncClient,
    auth_headers: dict[str, str],
):
    project = await _create_project(client, auth_headers)

    seed_response = await client.post(
        f"/api/v1/projects/{project['id']}/graph/demo-ctf",
        headers=_auth(auth_headers),
    )
    assert seed_response.status_code == 200, seed_response.text

    graph_response = await client.get(
        f"/api/v1/projects/{project['id']}/graph",
        headers=_auth(auth_headers),
    )
    assert graph_response.status_code == 200, graph_response.text
    graph = graph_response.json()

    foothold = next(
        node
        for node in graph["nodes"]
        if node["type"] == "session" and node["label"] == "www-data@WEB01"
    )
    root_loot = next(
        node
        for node in graph["nodes"]
        if node["type"] == "loot" and node["label"] == "root.txt"
    )

    path_response = await client.get(
        f"/api/v1/projects/{project['id']}/graph/paths",
        params={"from": foothold["id"], "to": root_loot["id"]},
        headers=_auth(auth_headers),
    )

    assert path_response.status_code == 200, path_response.text
    payload = path_response.json()

    assert payload["paths"]
    first_path = payload["paths"][0]
    assert first_path["node_ids"][0] == foothold["id"]
    assert first_path["node_ids"][-1] == root_loot["id"]
    assert "root@WEB01" in [node["label"] for node in first_path["nodes"]]
    assert any(edge["kind"] == "escalated_to" for edge in first_path["edges"])


@pytest.mark.anyio
async def test_graph_demo_seed_isolated_per_project(
    client: AsyncClient,
    auth_headers: dict[str, str],
):
    project_one = await _create_project(client, auth_headers)
    project_two = await _create_project(client, auth_headers)

    first_seed = await client.post(
        f"/api/v1/projects/{project_one['id']}/graph/demo-ctf",
        headers=_auth(auth_headers),
    )
    second_seed = await client.post(
        f"/api/v1/projects/{project_two['id']}/graph/demo-ctf",
        headers=_auth(auth_headers),
    )

    assert first_seed.status_code == 200, first_seed.text
    assert second_seed.status_code == 200, second_seed.text


@pytest.mark.anyio
async def test_graph_node_position_can_be_updated(
    client: AsyncClient,
    auth_headers: dict[str, str],
):
    project = await _create_project(client, auth_headers)

    seed = await client.post(
        f"/api/v1/projects/{project['id']}/graph/demo-ctf",
        headers=_auth(auth_headers),
    )
    assert seed.status_code == 200, seed.text
    graph = seed.json()
    node_id = graph["nodes"][0]["id"]

    update = await client.patch(
        f"/api/v1/projects/{project['id']}/graph/nodes/{node_id}",
        headers=_auth(auth_headers),
        json={"position": {"x": 420, "y": 360}},
    )
    assert update.status_code == 200, update.text
    payload = update.json()
    assert payload["position"] == {"x": 420, "y": 360}
    assert payload["meta"]["position_pinned"] is True

    graph_response = await client.get(
        f"/api/v1/projects/{project['id']}/graph",
        headers=_auth(auth_headers),
    )
    assert graph_response.status_code == 200, graph_response.text
    refreshed_node = next(
        node for node in graph_response.json()["nodes"] if node["id"] == node_id
    )
    assert refreshed_node["position"] == {"x": 420, "y": 360}
    assert refreshed_node["meta"]["position_pinned"] is True


@pytest.mark.anyio
async def test_graph_node_position_rejects_cross_project_update(
    client: AsyncClient,
    auth_headers: dict[str, str],
):
    project = await _create_project(client, auth_headers)
    second_project = await _create_project(client, auth_headers)

    seed = await client.post(
        f"/api/v1/projects/{project['id']}/graph/demo-ctf",
        headers=_auth(auth_headers),
    )
    node_id = seed.json()["nodes"][0]["id"]

    update = await client.patch(
        f"/api/v1/projects/{second_project['id']}/graph/nodes/{node_id}",
        headers=_auth(auth_headers),
        json={"position": {"x": 10, "y": 10}},
    )
    assert update.status_code == 404


@pytest.mark.anyio
async def test_graph_batch_creates_nodes_and_edges_atomically_with_placeholders(
    client: AsyncClient,
    auth_headers: dict[str, str],
):
    project = await _create_project(client, auth_headers)

    response = await client.post(
        f"/api/v1/projects/{project['id']}/graph/batch",
        headers=_auth(auth_headers),
        json={
            "source_step_id": "timeline-step-1",
            "nodes": [
                {
                    "type": "host",
                    "label": "APP01",
                    "meta": {"ip": "10.10.10.10"},
                },
                {
                    "type": "service",
                    "label": "HTTP :80",
                    "meta": {"service_name": "http", "port": 80},
                },
            ],
            "edges": [
                {
                    "source_ref": "$0",
                    "target_ref": "$1",
                    "kind": "runs_on",
                    "tool": "nmap",
                }
            ],
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert len(payload["created_node_ids"]) == 2
    assert len(payload["created_edge_ids"]) == 1

    graph_response = await client.get(
        f"/api/v1/projects/{project['id']}/graph",
        headers=_auth(auth_headers),
    )
    assert graph_response.status_code == 200, graph_response.text
    graph = graph_response.json()

    created_nodes = [
        node for node in graph["nodes"] if node["id"] in payload["created_node_ids"]
    ]
    created_edges = [
        edge for edge in graph["edges"] if edge["id"] in payload["created_edge_ids"]
    ]

    assert [node["sequence_index"] for node in created_nodes] == [1, 2]
    assert created_nodes[0]["source_step_ids"] == ["timeline-step-1"]
    assert created_nodes[1]["source_step_ids"] == ["timeline-step-1"]
    assert created_edges[0]["source_id"] == payload["created_node_ids"][0]
    assert created_edges[0]["target_id"] == payload["created_node_ids"][1]
    assert created_edges[0]["source_step_id"] == "timeline-step-1"
    assert created_edges[0]["sequence_index"] == 1


@pytest.mark.anyio
async def test_graph_batch_rolls_back_when_placeholder_resolution_fails(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)

    response = await client.post(
        f"/api/v1/projects/{project['id']}/graph/batch",
        headers=_auth(auth_headers),
        json={
            "nodes": [
                {
                    "type": "host",
                    "label": "APP01",
                    "meta": {"ip": "10.10.10.10"},
                }
            ],
            "edges": [
                {
                    "source_ref": "$0",
                    "target_ref": "$2",
                    "kind": "runs_on",
                }
            ],
        },
    )

    assert response.status_code == 400

    node_count = await test_db.scalar(
        select(func.count(GraphNodeDB.id)).where(
            GraphNodeDB.project_id == project["id"],
            GraphNodeDB.is_deleted.is_(False),
        )
    )
    edge_count = await test_db.scalar(
        select(func.count(GraphEdgeDB.id)).where(
            GraphEdgeDB.project_id == project["id"]
        )
    )

    assert node_count == 0
    assert edge_count == 0
