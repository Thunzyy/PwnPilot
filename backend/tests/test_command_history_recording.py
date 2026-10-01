from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.command_history import CommandHistory
from app.models.terminal_session import TerminalSessionDB


def _auth(headers: dict[str, str]) -> dict[str, str]:
    return {"Authorization": headers["Authorization"]}


async def _create_project(client: AsyncClient, headers: dict[str, str]) -> dict:
    response = await client.post(
        "/api/v1/projects",
        json={"name": f"History Recording {uuid.uuid4().hex[:8]}", "type": "htb"},
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
    *,
    project_id: str,
    session_id: str | None = None,
) -> TerminalSessionDB:
    actual_session_id = session_id or f"sess-{uuid.uuid4().hex[:8]}"
    session = TerminalSessionDB(
        id=actual_session_id,
        project_id=project_id,
        name="Terminal 1",
        master_token="master-token",
        viewer_token="viewer-token",
        is_alive=True,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


async def _record_command(
    client: AsyncClient,
    headers: dict[str, str],
    *,
    session_id: str,
    command: str,
    output: str | None,
    cwd: str = "/tmp",
) -> dict:
    response = await client.post(
        f"/api/v1/terminal/sessions/{session_id}/commands",
        headers=_auth(headers),
        json={
            "command": command,
            "output": output,
            "exit_code": 0,
            "cwd": cwd,
            "duration_ms": 42,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.anyio
async def test_recording_new_command_trims_trailing_echo_from_previous_output(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)
    await _get_current_user_id(client, auth_headers)
    session = await _create_terminal_session(test_db, project_id=project["id"])

    first = await _record_command(
        client,
        auth_headers,
        session_id=session.id,
        command="echo first",
        output="first\nnext command\nqueued after it",
    )

    await _record_command(
        client,
        auth_headers,
        session_id=session.id,
        command="next command",
        output="second",
    )

    refreshed = await test_db.get(CommandHistory, first["id"])
    assert refreshed is not None
    assert refreshed.output == "first"
    assert refreshed.output_preview == "first"


@pytest.mark.anyio
async def test_recording_new_command_trims_prompt_prefixed_echo_from_previous_output(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)
    await _get_current_user_id(client, auth_headers)
    session = await _create_terminal_session(test_db, project_id=project["id"])

    first = await _record_command(
        client,
        auth_headers,
        session_id=session.id,
        command="echo first",
        output="first\n└─$ next command",
    )

    await _record_command(
        client,
        auth_headers,
        session_id=session.id,
        command="next command",
        output="second",
    )

    refreshed = await test_db.get(CommandHistory, first["id"])
    assert refreshed is not None
    assert refreshed.output == "first"
    assert refreshed.output_preview == "first"
