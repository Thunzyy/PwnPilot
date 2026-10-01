from __future__ import annotations

import asyncio
import uuid
from contextlib import suppress

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.terminal_session import TerminalSessionDB
from app.services import report_evaluation_task_manager as report_eval_module


def _auth(headers: dict[str, str]) -> dict[str, str]:
    return {"Authorization": headers["Authorization"]}


async def _create_project(client: AsyncClient, headers: dict[str, str]) -> dict:
    response = await client.post(
        "/api/v1/projects",
        json={"name": f"Report E2E {uuid.uuid4().hex[:8]}", "type": "custom"},
        headers=_auth(headers),
    )
    assert response.status_code == 201, response.text
    return response.json()


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
        name="Report Session",
        master_token="master-token",
        viewer_token="viewer-token",
        is_alive=True,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


async def _wait_for_task_completion(
    client: AsyncClient,
    headers: dict[str, str],
    *,
    project_id: str,
    task_id: str,
) -> dict:
    last_payload: dict | None = None
    for _ in range(60):
        response = await client.get(
            f"/api/v1/projects/{project_id}/report/evaluate/{task_id}",
            headers=_auth(headers),
        )
        assert response.status_code == 200, response.text
        last_payload = response.json()
        if last_payload["status"] in {"completed", "failed"}:
            return last_payload
        await asyncio.sleep(0.05)
    raise AssertionError(f"Timed out waiting for report evaluation task {task_id}: {last_payload}")


@pytest.fixture
async def configured_report_task_manager(test_db: AsyncSession):
    manager = report_eval_module.report_evaluation_task_manager
    original_session_maker = manager._session_maker
    test_session_maker = async_sessionmaker(test_db.bind, expire_on_commit=False)
    await manager.stop_background_reclaimer()
    manager._session_maker = test_session_maker
    manager._submit_locks.clear()
    manager._active_tasks.clear()
    try:
        yield manager
    finally:
        for tasks in list(manager._active_tasks.values()):
            for task in list(tasks):
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
        manager._active_tasks.clear()
        manager._submit_locks.clear()
        manager._session_maker = original_session_maker


@pytest.mark.anyio
async def test_report_evaluate_creates_pending_proposal_via_real_task_manager(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
    configured_report_task_manager,
    monkeypatch: pytest.MonkeyPatch,
):
    del configured_report_task_manager
    monkeypatch.setenv("PWNPILOT_FAKE_REPORTING_PROVIDER", "deterministic")

    project = await _create_project(client, auth_headers)
    session = await _create_terminal_session(test_db, project_id=project["id"])

    command_response = await client.post(
        f"/api/v1/terminal/sessions/{session.id}/commands",
        headers=_auth(auth_headers),
        json={
            "command": "nmap -sV 10.129.34.191",
            "output": "80/tcp open http\n21/tcp open ftp",
            "exit_code": 0,
            "cwd": "/tmp",
            "duration_ms": 42,
        },
    )
    assert command_response.status_code == 201, command_response.text

    evaluate_response = await client.post(
        f"/api/v1/projects/{project['id']}/report/evaluate",
        headers=_auth(auth_headers),
    )
    assert evaluate_response.status_code == 202, evaluate_response.text
    task_payload = evaluate_response.json()

    final_payload = await _wait_for_task_completion(
        client,
        auth_headers,
        project_id=project["id"],
        task_id=task_payload["task_id"],
    )

    assert final_payload["status"] == "completed"
    assert final_payload["proposal_id"] is not None

    proposals_response = await client.get(
        f"/api/v1/projects/{project['id']}/report/proposals",
        headers=_auth(auth_headers),
    )
    assert proposals_response.status_code == 200, proposals_response.text
    proposals_payload = proposals_response.json()

    assert proposals_payload["total"] == 1
    assert proposals_payload["items"][0]["id"] == final_payload["proposal_id"]
    assert proposals_payload["items"][0]["section_patches"][0]["section_key"] == "recon"
    assert proposals_payload["items"][0]["section_patches"][0]["evidence_links"] == [
        {
            "id": proposals_payload["items"][0]["section_patches"][0]["evidence_links"][0]["id"],
            "patch_id": proposals_payload["items"][0]["section_patches"][0]["id"],
            "source_type": "command_history",
            "source_id": proposals_payload["items"][0]["section_patches"][0]["evidence_links"][0]["source_id"],
            "label": "Command",
            "preview": "nmap -sV 10.129.34.191",
            "href": f"/projects/{project['id']}/timeline?commandId={proposals_payload['items'][0]['section_patches'][0]['evidence_links'][0]['source_id']}",
            "created_at": proposals_payload["items"][0]["section_patches"][0]["evidence_links"][0]["created_at"],
        }
    ]


@pytest.mark.anyio
async def test_section_scoped_report_evaluate_only_updates_requested_section(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
    configured_report_task_manager,
    monkeypatch: pytest.MonkeyPatch,
):
    del configured_report_task_manager
    monkeypatch.setenv("PWNPILOT_FAKE_REPORTING_PROVIDER", "deterministic")

    project = await _create_project(client, auth_headers)
    session = await _create_terminal_session(test_db, project_id=project["id"])

    command_response = await client.post(
        f"/api/v1/terminal/sessions/{session.id}/commands",
        headers=_auth(auth_headers),
        json={
            "command": "getcap -r / 2>/dev/null",
            "output": "/usr/bin/python3.8 cap_setuid=ep",
            "exit_code": 0,
            "cwd": "/tmp",
            "duration_ms": 31,
        },
    )
    assert command_response.status_code == 201, command_response.text

    evaluate_response = await client.post(
        f"/api/v1/projects/{project['id']}/report/sections/privilege_escalation/evaluate",
        headers=_auth(auth_headers),
    )
    assert evaluate_response.status_code == 202, evaluate_response.text
    task_payload = evaluate_response.json()

    final_payload = await _wait_for_task_completion(
        client,
        auth_headers,
        project_id=project["id"],
        task_id=task_payload["task_id"],
    )

    assert final_payload["status"] == "completed"
    assert final_payload["proposal_id"] is not None
    assert final_payload["target_section_keys"] == ["privilege_escalation"]

    proposals_response = await client.get(
        f"/api/v1/projects/{project['id']}/report/proposals",
        headers=_auth(auth_headers),
    )
    assert proposals_response.status_code == 200, proposals_response.text
    proposals_payload = proposals_response.json()

    assert proposals_payload["total"] == 1
    section_keys = [
        patch["section_key"]
        for patch in proposals_payload["items"][0]["section_patches"]
    ]
    assert section_keys == ["privilege_escalation"]
    assert proposals_payload["items"][0]["section_patches"][0]["evidence_links"][0]["source_type"] == "command_history"
