from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.command_history import CommandHistory
from app.models.graph import GraphEdgeDB, GraphNodeDB
from app.models.graph_proposals import GraphEntityProposalDB
from app.models.terminal_session import TerminalSessionDB


def _auth(headers: dict[str, str]) -> dict[str, str]:
    return {"Authorization": headers["Authorization"]}


async def _create_project(client: AsyncClient, headers: dict[str, str]) -> dict:
    response = await client.post(
        "/api/v1/projects",
        json={"name": f"Graph Proposal {uuid.uuid4().hex[:8]}", "type": "htb"},
        headers=_auth(headers),
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _get_current_user_id(client: AsyncClient, headers: dict[str, str]) -> str:
    response = await client.get("/api/v1/auth/me", headers=_auth(headers))
    assert response.status_code == 200, response.text
    return response.json()["id"]


async def _create_terminal_session(
    db: AsyncSession,
    project_id: str,
    *,
    session_id: str | None = None,
) -> TerminalSessionDB:
    actual_session_id = session_id or f"sess-{uuid.uuid4().hex[:8]}"
    session = TerminalSessionDB(
        id=actual_session_id,
        project_id=project_id,
        name="Recon",
        master_token="master-token",
        viewer_token="viewer-token",
        is_alive=True,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


async def _seed_command_history(
    db: AsyncSession,
    *,
    project_id: str,
    user_id: str,
    command: str,
    output: str,
    exit_code: int = 0,
) -> CommandHistory:
    session = await _create_terminal_session(db, project_id)
    entry = CommandHistory(
        id=str(uuid.uuid4()),
        project_id=project_id,
        session_id=session.id,
        command=command,
        output=output,
        output_preview=output[:200],
        exit_code=exit_code,
        cwd="/tmp",
        duration_ms=850,
        executed_by=user_id,
        source="user",
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


async def _create_and_accept_history_proposal(
    client: AsyncClient,
    headers: dict[str, str],
    *,
    project_id: str,
    command_id: str,
) -> dict:
    create_response = await client.post(
        f"/api/v1/projects/{project_id}/graph/proposals/from-history/{command_id}",
        headers=_auth(headers),
    )
    assert create_response.status_code in {200, 201}, create_response.text
    proposal = create_response.json()["items"][0]
    accept_response = await client.post(
        f"/api/v1/projects/{project_id}/graph/proposals/{proposal['id']}/accept",
        headers=_auth(headers),
    )
    assert accept_response.status_code == 200, accept_response.text
    return proposal


@pytest.mark.anyio
async def test_history_command_can_create_graph_proposal(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)
    user_id = await _get_current_user_id(client, auth_headers)
    command = await _seed_command_history(
        test_db,
        project_id=project["id"],
        user_id=user_id,
        command="nmap -sV 10.10.10.10",
        output="80/tcp open http\n443/tcp open https",
    )

    response = await client.post(
        f"/api/v1/projects/{project['id']}/graph/proposals/from-history/{command.id}",
        headers=_auth(auth_headers),
    )

    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["total"] == 1
    assert len(payload["items"]) == 1
    assert payload["items"][0]["source_type"] == "command_history"
    assert payload["items"][0]["source_id"] == command.id
    assert payload["items"][0]["status"] == "pending"


@pytest.mark.anyio
async def test_nmap_history_proposal_extracts_host_and_service_batch(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)
    user_id = await _get_current_user_id(client, auth_headers)
    command = await _seed_command_history(
        test_db,
        project_id=project["id"],
        user_id=user_id,
        command="nmap -sV 10.10.10.10",
        output=(
            "Nmap scan report for 10.10.10.10\n"
            "80/tcp open http Apache httpd\n"
            "445/tcp open microsoft-ds Samba smbd"
        ),
    )

    response = await client.post(
        f"/api/v1/projects/{project['id']}/graph/proposals/from-history/{command.id}",
        headers=_auth(auth_headers),
    )

    assert response.status_code == 201, response.text
    proposal = response.json()["items"][0]

    assert proposal["payload"]["source_step_id"] == command.id
    assert any(node["type"] == "host" for node in proposal["payload"]["nodes"])
    assert any(node["type"] == "service" for node in proposal["payload"]["nodes"])
    assert any(edge["kind"] == "runs_on" for edge in proposal["payload"]["edges"])
    assert any(node["label"] == "10.10.10.10" for node in proposal["payload"]["nodes"])


@pytest.mark.anyio
async def test_creating_history_graph_proposals_is_idempotent_for_pending_source(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)
    user_id = await _get_current_user_id(client, auth_headers)
    command = await _seed_command_history(
        test_db,
        project_id=project["id"],
        user_id=user_id,
        command="nmap -sV 10.10.10.10",
        output="80/tcp open http",
    )

    first = await client.post(
        f"/api/v1/projects/{project['id']}/graph/proposals/from-history/{command.id}",
        headers=_auth(auth_headers),
    )
    second = await client.post(
        f"/api/v1/projects/{project['id']}/graph/proposals/from-history/{command.id}",
        headers=_auth(auth_headers),
    )

    assert first.status_code == 201, first.text
    assert second.status_code == 200, second.text

    first_proposal_id = first.json()["items"][0]["id"]
    second_proposal_id = second.json()["items"][0]["id"]
    assert second_proposal_id == first_proposal_id

    result = await test_db.execute(
        select(GraphEntityProposalDB).where(
            GraphEntityProposalDB.project_id == project["id"],
            GraphEntityProposalDB.source_id == command.id,
        )
    )
    proposals = result.scalars().all()
    assert len(proposals) == 1


@pytest.mark.anyio
async def test_accepting_history_graph_proposal_materializes_graph_batch(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)
    user_id = await _get_current_user_id(client, auth_headers)
    command = await _seed_command_history(
        test_db,
        project_id=project["id"],
        user_id=user_id,
        command="nmap -sV 10.10.10.10",
        output="80/tcp open http\n443/tcp open https",
    )

    create_response = await client.post(
        f"/api/v1/projects/{project['id']}/graph/proposals/from-history/{command.id}",
        headers=_auth(auth_headers),
    )
    assert create_response.status_code == 201, create_response.text
    proposal_id = create_response.json()["items"][0]["id"]

    accept_response = await client.post(
        f"/api/v1/projects/{project['id']}/graph/proposals/{proposal_id}/accept",
        headers=_auth(auth_headers),
    )

    assert accept_response.status_code == 200, accept_response.text
    payload = accept_response.json()
    assert payload["proposal"]["id"] == proposal_id
    assert payload["proposal"]["status"] == "accepted"
    assert payload["graph_batch"]["created_node_ids"]
    assert payload["graph_batch"]["created_edge_ids"]

    stored_proposal = await test_db.get(GraphEntityProposalDB, proposal_id)
    assert stored_proposal is not None
    assert stored_proposal.status == "accepted"
    assert stored_proposal.resolved_at is not None

    node_count = (
        await test_db.execute(
            select(GraphNodeDB).where(
                GraphNodeDB.project_id == project["id"],
                GraphNodeDB.is_deleted.is_(False),
            )
        )
    ).scalars().all()
    edge_count = (
        await test_db.execute(
            select(GraphEdgeDB).where(GraphEdgeDB.project_id == project["id"])
        )
    ).scalars().all()

    assert node_count
    assert edge_count


@pytest.mark.anyio
async def test_ssh_history_proposal_links_existing_credential_and_service(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)
    user_id = await _get_current_user_id(client, auth_headers)

    nmap_command = await _seed_command_history(
        test_db,
        project_id=project["id"],
        user_id=user_id,
        command="nmap -Pn -sC -sV 10.129.34.191",
        output=(
            "Nmap scan report for 10.129.34.191\n"
            "21/tcp open ftp vsftpd 3.0.3\n"
            "22/tcp open ssh OpenSSH 8.2p1\n"
            "80/tcp open http Gunicorn"
        ),
    )
    await _create_and_accept_history_proposal(
        client,
        auth_headers,
        project_id=project["id"],
        command_id=nmap_command.id,
    )

    ftp_command = await _seed_command_history(
        test_db,
        project_id=project["id"],
        user_id=user_id,
        command='tshark -r 0.pcap -Y "ftp.request.command == \\"USER\\" || ftp.request.command == \\"PASS\\""',
        output="USER\tnathan\nPASS\tBuck3tH4TF0RM3!",
    )
    await _create_and_accept_history_proposal(
        client,
        auth_headers,
        project_id=project["id"],
        command_id=ftp_command.id,
    )

    ssh_command = await _seed_command_history(
        test_db,
        project_id=project["id"],
        user_id=user_id,
        command="expect -c 'spawn ssh ... id'",
        output=(
            "spawn ssh -o StrictHostKeyChecking=no nathan@10.129.34.191 id\n"
            "nathan@10.129.34.191's password:\n"
            "uid=1001(nathan) gid=1001(nathan) groups=1001(nathan)"
        ),
    )

    response = await client.post(
        f"/api/v1/projects/{project['id']}/graph/proposals/from-history/{ssh_command.id}",
        headers=_auth(auth_headers),
    )

    assert response.status_code == 201, response.text
    proposal = response.json()["items"][0]
    assert any(node["type"] == "session" for node in proposal["payload"]["nodes"])
    assert any(
        edge["kind"] == "authenticates_to" and edge.get("source_id")
        for edge in proposal["payload"]["edges"]
    )
    assert any(edge["kind"] == "opens_session_on" for edge in proposal["payload"]["edges"])


@pytest.mark.anyio
async def test_cap_setuid_privesc_history_proposal_links_existing_session_and_finding(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)
    user_id = await _get_current_user_id(client, auth_headers)

    nmap_command = await _seed_command_history(
        test_db,
        project_id=project["id"],
        user_id=user_id,
        command="nmap -Pn -sC -sV 10.129.34.191",
        output="22/tcp open ssh OpenSSH 8.2p1",
    )
    await _create_and_accept_history_proposal(
        client,
        auth_headers,
        project_id=project["id"],
        command_id=nmap_command.id,
    )

    ssh_command = await _seed_command_history(
        test_db,
        project_id=project["id"],
        user_id=user_id,
        command="expect -c 'spawn ssh ... id'",
        output=(
            "spawn ssh -o StrictHostKeyChecking=no nathan@10.129.34.191 id\n"
            "nathan@10.129.34.191's password:\n"
            "uid=1001(nathan) gid=1001(nathan) groups=1001(nathan)"
        ),
    )
    await _create_and_accept_history_proposal(
        client,
        auth_headers,
        project_id=project["id"],
        command_id=ssh_command.id,
    )

    getcap_command = await _seed_command_history(
        test_db,
        project_id=project["id"],
        user_id=user_id,
        command='expect -c \'spawn ssh ... "getcap /usr/bin/python3.8"\'',
        output=(
            "spawn ssh -o StrictHostKeyChecking=no nathan@10.129.34.191 getcap /usr/bin/python3.8\n"
            "/usr/bin/python3.8 = cap_setuid,cap_net_bind_service+eip"
        ),
    )
    await _create_and_accept_history_proposal(
        client,
        auth_headers,
        project_id=project["id"],
        command_id=getcap_command.id,
    )

    privesc_command = await _seed_command_history(
        test_db,
        project_id=project["id"],
        user_id=user_id,
        command='expect -c \'spawn ssh ... "python3.8 -c ..."\'',
        output=(
            "spawn ssh -o StrictHostKeyChecking=no nathan@10.129.34.191 /usr/bin/python3.8 -c '...'\n"
            "uid=0(root) gid=1001(nathan) groups=1001(nathan)\n"
            "root"
        ),
    )

    response = await client.post(
        f"/api/v1/projects/{project['id']}/graph/proposals/from-history/{privesc_command.id}",
        headers=_auth(auth_headers),
    )

    assert response.status_code == 201, response.text
    proposal = response.json()["items"][0]
    assert any(node["label"] == "Root session: root@10.129.34.191" for node in proposal["payload"]["nodes"])
    assert any(edge["kind"] == "escalated_to" for edge in proposal["payload"]["edges"])
    assert any(
        edge["kind"] == "related_to" and edge.get("source_id")
        for edge in proposal["payload"]["edges"]
    )
