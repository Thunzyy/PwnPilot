from __future__ import annotations

from datetime import UTC, datetime, timedelta
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.mcp.hooks import record_agent_command
from app.models.command_history import CommandHistory
from app.models.project import Project
from app.models.report import ReportDB
from app.models.terminal_session import TerminalSessionDB
from app.models.user import User
from app.services.graph_proposal_service import GraphProposalService
from app.services.project_service import ProjectService
from app.services.report_service import ReportService
from app.services.report_signal_service import ReportSignalService
from app.services.settings_service import SettingsService
from app.schemas.project import ProjectCreate
from app.schemas.settings import SettingsUpdate


async def _create_project_with_user(
    test_db: AsyncSession,
    *,
    name: str = "Cap",
    user_id: str = "user-1",
) -> tuple[Project, User]:
    user = User(
        id=user_id,
        username=f"user-{user_id}",
        email=f"{user_id}@example.com",
        password_hash="hash",
    )
    test_db.add(user)
    await test_db.commit()
    await test_db.refresh(user)

    project = await ProjectService(test_db).create_for_user(
        ProjectCreate(name=f"{name}-{uuid.uuid4().hex[:6]}", type="htb"),
        user,
    )
    return project, user


async def _create_session(
    test_db: AsyncSession,
    project_id: str,
    *,
    session_id: str = "session-1",
) -> TerminalSessionDB:
    session = TerminalSessionDB(
        id=session_id,
        project_id=project_id,
        name="Recon",
        master_token="master-token",
        viewer_token="viewer-token",
        is_alive=True,
    )
    test_db.add(session)
    await test_db.commit()
    await test_db.refresh(session)
    return session


@pytest.mark.anyio
async def test_record_signal_marks_project_pending_and_debounces_duplicates():
    base_time = datetime(2026, 4, 21, 22, 30, tzinfo=UTC)
    service = ReportSignalService(debounce_seconds=30)

    first_due_at = service.record_signal(
        project_id="project-1",
        signal_type="command_history",
        source_id="cmd-1",
        now=base_time,
    )
    second_due_at = service.record_signal(
        project_id="project-1",
        signal_type="command_history",
        source_id="cmd-2",
        now=base_time + timedelta(seconds=5),
    )

    assert first_due_at == base_time + timedelta(seconds=30)
    assert second_due_at == base_time + timedelta(seconds=35)
    assert service.list_pending_project_ids() == ["project-1"]
    assert service.drain_due_projects(now=base_time + timedelta(seconds=20)) == []
    assert service.drain_due_projects(now=base_time + timedelta(seconds=40)) == ["project-1"]
    assert service.list_pending_project_ids() == []


@pytest.mark.anyio
async def test_run_periodic_review_once_only_marks_projects_with_new_evidence(
    test_db: AsyncSession,
):
    project_a, user_a = await _create_project_with_user(test_db, name="PeriodicA", user_id="user-a")
    project_b, user_b = await _create_project_with_user(test_db, name="PeriodicB", user_id="user-b")
    session_a = await _create_session(test_db, project_a.id, session_id="session-a")
    session_b = await _create_session(test_db, project_b.id, session_id="session-b")
    report_service = ReportService(test_db)
    report_a = await report_service.ensure_report(project_a.id, project_a.name)
    report_b = await report_service.ensure_report(project_b.id, project_b.name)
    await report_service.seed_default_sections(report_a.id)
    await report_service.seed_default_sections(report_b.id)

    evaluated_at = datetime.now(UTC) - timedelta(minutes=10)
    report_a.last_evaluated_at = evaluated_at
    report_b.last_evaluated_at = evaluated_at

    new_command = CommandHistory(
        id="cmd-periodic",
        project_id=project_a.id,
        session_id=session_a.id,
        command="nmap -sV 10.10.10.10",
        output="80/tcp open http",
        output_preview="80/tcp open http",
        exit_code=0,
        cwd="/tmp",
        duration_ms=20,
        executed_by=user_a.id,
        created_at=evaluated_at + timedelta(minutes=1),
    )
    old_command = CommandHistory(
        id="cmd-old",
        project_id=project_b.id,
        session_id=session_b.id,
        command="whoami",
        output="user",
        output_preview="user",
        exit_code=0,
        cwd="/tmp",
        duration_ms=10,
        executed_by=user_b.id,
        created_at=evaluated_at - timedelta(minutes=1),
    )
    test_db.add_all([new_command, old_command])
    await test_db.commit()

    service = ReportSignalService(debounce_seconds=30)
    scheduled = await service.run_periodic_review_once(test_db, now=datetime.now(UTC))

    assert scheduled == [project_a.id]
    assert service.list_pending_project_ids() == [project_a.id]


@pytest.mark.anyio
async def test_record_agent_command_emits_report_signal(
    test_db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    project, user = await _create_project_with_user(test_db, name="AgentSignal", user_id="agent-user")
    session = await _create_session(test_db, project.id, session_id="session-agent")
    captured: list[tuple[str, str, str]] = []

    def fake_record_signal(project_id: str, signal_type: str, source_id: str, metadata=None, now=None):
        captured.append((project_id, signal_type, source_id))
        return datetime.now(UTC)

    monkeypatch.setattr("app.mcp.hooks.report_signal_service.record_signal", fake_record_signal)

    await record_agent_command(
        test_db,
        project_id=project.id,
        user_id=user.id,
        command="id",
        output="uid=1000(user)",
        session_id=session.id,
        duration_ms=10,
    )

    assert captured
    assert captured[0][0] == project.id
    assert captured[0][1] == "agent_command"


@pytest.mark.anyio
async def test_shell_hook_command_endpoint_emits_report_signal(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    me = await client.get("/api/v1/auth/me", headers={"Authorization": auth_headers["Authorization"]})
    user_id = me.json()["id"]
    project = await client.post(
        "/api/v1/projects",
        json={"name": f"Signal Endpoint {uuid.uuid4().hex[:8]}", "type": "htb"},
        headers={"Authorization": auth_headers["Authorization"]},
    )
    project_id = project.json()["id"]
    session = await _create_session(test_db, project_id, session_id="session-shell")
    captured: list[tuple[str, str, str]] = []

    def fake_record_signal(project_id: str, signal_type: str, source_id: str, metadata=None, now=None):
        captured.append((project_id, signal_type, source_id))
        return datetime.now(UTC)

    monkeypatch.setattr("app.routers.command_history.report_signal_service.record_signal", fake_record_signal)

    response = await client.post(
        f"/api/v1/terminal/sessions/{session.id}/commands",
        json={
            "command": "linpeas.sh",
            "output": "interesting output",
            "exit_code": 0,
            "cwd": "/home/user",
            "duration_ms": 1200,
        },
        headers={"Authorization": auth_headers["Authorization"]},
    )

    assert response.status_code == 201, response.text
    assert captured
    assert captured[0][0] == project_id
    assert captured[0][1] == "command_history"


@pytest.mark.anyio
async def test_accepting_graph_proposal_emits_report_signal(
    test_db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    project, user = await _create_project_with_user(test_db, name="GraphSignal", user_id="graph-user")
    session = await _create_session(test_db, project.id, session_id="session-graph")
    command = CommandHistory(
        id="cmd-graph-signal",
        project_id=project.id,
        session_id=session.id,
        command="nmap -sV 10.10.10.10",
        output="80/tcp open http",
        output_preview="80/tcp open http",
        exit_code=0,
        cwd="/tmp",
        duration_ms=20,
        executed_by=user.id,
    )
    test_db.add(command)
    await test_db.commit()

    captured: list[tuple[str, str, str]] = []

    def fake_record_signal(project_id: str, signal_type: str, source_id: str, metadata=None, now=None):
        captured.append((project_id, signal_type, source_id))
        return datetime.now(UTC)

    monkeypatch.setattr(
        "app.services.graph_proposal_service.report_signal_service.record_signal",
        fake_record_signal,
    )

    service = GraphProposalService(test_db)
    proposals, _created = await service.propose_from_command_history(
        project_id=project.id,
        command_id=command.id,
    )
    await service.accept_proposal(project_id=project.id, proposal_id=proposals[0].id)

    assert captured
    assert captured[0][0] == project.id
    assert captured[0][1] == "graph_accept"
