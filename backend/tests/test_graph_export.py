from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.graph import GraphNodeDB


def _auth(headers: dict[str, str]) -> dict[str, str]:
    return {"Authorization": headers["Authorization"]}


async def _create_project(client: AsyncClient, headers: dict[str, str]) -> dict:
    response = await client.post(
        "/api/v1/projects",
        json={"name": f"Graph Export {uuid.uuid4().hex[:8]}", "type": "htb"},
        headers=_auth(headers),
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _seed_demo_graph(client: AsyncClient, headers: dict[str, str], project_id: str) -> dict:
    response = await client.post(
        f"/api/v1/projects/{project_id}/graph/demo-ctf",
        headers=_auth(headers),
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.anyio
async def test_export_path_returns_markdown_with_terminal_output_and_notes(
    client: AsyncClient,
    auth_headers: dict[str, str],
):
    project = await _create_project(client, auth_headers)
    graph = await _seed_demo_graph(client, auth_headers, project["id"])

    action_node = next(
        node
        for node in graph["nodes"]
        if node["type"] == "action" and node["label"] == "Recover svc_backup credential"
    )
    credential_node = next(
        node
        for node in graph["nodes"]
        if node["type"] == "credential" and node["label"] == "svc_backup"
    )
    edge = next(
        graph_edge
        for graph_edge in graph["edges"]
        if graph_edge["source_id"] == action_node["id"]
        and graph_edge["target_id"] == credential_node["id"]
    )

    export_response = await client.post(
        f"/api/v1/projects/{project['id']}/graph/export-path",
        headers=_auth(auth_headers),
        json={
            "node_ids": [action_node["id"], credential_node["id"]],
            "edge_ids": [edge["id"]],
            "format": "markdown",
            "include_terminal_output": True,
            "include_notes": True,
            "include_ai_summary": False,
        },
    )

    assert export_response.status_code == 200, export_response.text
    payload = export_response.json()

    assert payload["format"] == "markdown"
    assert "# Attack Path:" in payload["content"]
    assert "Recover svc_backup credential" in payload["content"]
    assert "svc_backup" in payload["content"]
    assert "### Terminal Output" in payload["content"]
    assert "### Notes" in payload["content"]
    assert "### AI Context" in payload["content"]
    assert "svc_backup" in payload["content"]


@pytest.mark.anyio
async def test_export_path_handles_missing_source_steps_gracefully(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)
    graph = await _seed_demo_graph(client, auth_headers, project["id"])

    node_id = graph["nodes"][0]["id"]
    node = await test_db.scalar(
        select(GraphNodeDB).where(
            GraphNodeDB.id == node_id,
            GraphNodeDB.project_id == project["id"],
        )
    )
    assert node is not None
    node.source_step_ids = ["missing-step-id"]
    await test_db.commit()

    export_response = await client.post(
        f"/api/v1/projects/{project['id']}/graph/export-path",
        headers=_auth(auth_headers),
        json={
            "node_ids": [node_id],
            "format": "markdown",
            "include_terminal_output": True,
            "include_notes": True,
            "include_ai_summary": False,
        },
    )

    assert export_response.status_code == 200, export_response.text
    payload = export_response.json()
    assert graph["nodes"][0]["label"] in payload["content"]
    assert "### Terminal Output" not in payload["content"]


@pytest.mark.anyio
async def test_export_path_masks_credential_values_in_markdown(
    client: AsyncClient,
    auth_headers: dict[str, str],
):
    project = await _create_project(client, auth_headers)
    graph = await _seed_demo_graph(client, auth_headers, project["id"])

    credential_node = next(
        node for node in graph["nodes"] if node["type"] == "credential" and node["label"] == "svc_backup"
    )

    export_response = await client.post(
        f"/api/v1/projects/{project['id']}/graph/export-path",
        headers=_auth(auth_headers),
        json={
            "node_ids": [credential_node["id"]],
            "format": "markdown",
            "include_terminal_output": True,
            "include_notes": True,
            "include_ai_summary": False,
        },
    )

    assert export_response.status_code == 200, export_response.text
    payload = export_response.json()
    assert "Winter2026!backup" not in payload["content"]
    assert "Wint********up" in payload["content"]


@pytest.mark.anyio
async def test_export_path_rejects_oversized_paths(
    client: AsyncClient,
    auth_headers: dict[str, str],
):
    project = await _create_project(client, auth_headers)
    graph = await _seed_demo_graph(client, auth_headers, project["id"])
    node_id = graph["nodes"][0]["id"]

    export_response = await client.post(
        f"/api/v1/projects/{project['id']}/graph/export-path",
        headers=_auth(auth_headers),
        json={
            "node_ids": [node_id] * 51,
            "format": "markdown",
            "include_terminal_output": True,
            "include_notes": True,
            "include_ai_summary": False,
        },
    )

    assert export_response.status_code == 413
