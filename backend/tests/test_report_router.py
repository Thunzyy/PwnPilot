from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
import zipfile
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.command_history import CommandHistory
from app.models.graph import GraphEdgeDB, GraphNodeDB
from app.models.knowledge import KnowledgeDoc, KnowledgeSource
from app.models.report import ReportSectionDB
from app.models.terminal_session import TerminalSessionDB
from app.models.timeline import Timeline
from app.services.report_evaluation_task_manager import ReportEvaluationTask
from app.services.report_service import ReportService
from app.services.report_signal_service import ReportSignalService


def _auth(headers: dict[str, str]) -> dict[str, str]:
    return {"Authorization": headers["Authorization"]}


class _StubReportEvaluationTaskManager:
    def __init__(
        self,
        *,
        queued_task: object,
        completed_task: object | None = None,
        completion_event: asyncio.Event | None = None,
        expected_target_section_keys: list[str] | None = None,
    ):
        self._queued_task = queued_task
        self._completed_task = completed_task or queued_task
        self._completion_event = completion_event
        self._expected_target_section_keys = expected_target_section_keys

    async def submit(
        self,
        *,
        project_id: str,
        user_id: str,
        trigger_type: str,
        target_section_keys: list[str] | None = None,
    ) -> object:
        assert project_id == self._queued_task.project_id
        assert user_id == self._queued_task.user_id
        assert trigger_type == self._queued_task.trigger_type
        assert target_section_keys == self._expected_target_section_keys
        return self._queued_task

    async def get_task(self, task_id: str) -> object | None:
        if task_id != self._queued_task.task_id:
            return None
        if self._completion_event is not None and not self._completion_event.is_set():
            return self._queued_task
        return self._completed_task


async def _create_project(client: AsyncClient, headers: dict[str, str]) -> dict:
    response = await client.post(
        "/api/v1/projects",
        json={"name": f"Report Project {uuid.uuid4().hex[:8]}", "type": "custom"},
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


@pytest.mark.anyio
async def test_get_project_report_returns_current_report_and_sections(
    client: AsyncClient,
    auth_headers: dict[str, str],
):
    response = await client.post(
        "/api/v1/projects",
        json={"name": f"HTB Report {uuid.uuid4().hex[:8]}", "type": "htb"},
        headers=_auth(auth_headers),
    )
    assert response.status_code == 201, response.text
    project = response.json()

    response = await client.get(
        f"/api/v1/projects/{project['id']}/report",
        headers=_auth(auth_headers),
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["project_id"] == project["id"]
    assert payload["profile"] == "htb_writeup"
    assert payload["current_revision"] == 0
    assert [section["key"] for section in payload["sections"]] == [
        "overview",
        "attack_path",
        "enumeration",
        "foothold",
        "privilege_escalation",
        "flags_evidence",
        "command_timeline",
    ]


@pytest.mark.anyio
async def test_list_project_report_proposals_returns_pending_items(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)
    report_service = ReportService(test_db)
    report = await report_service.ensure_report(project["id"], project["name"])
    await report_service.seed_default_sections(report.id)
    proposal = await report_service.create_manual_proposal(
        report.id,
        [
            {
                "section_key": "recon",
                "content_md": "Enumerated the HTTP service.",
                "summary": "Add recon details",
            }
        ],
    )

    response = await client.get(
        f"/api/v1/projects/{project['id']}/report/proposals",
        headers=_auth(auth_headers),
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] == 1
    assert payload["items"][0]["id"] == proposal.id
    assert payload["items"][0]["status"] == "pending"
    assert payload["items"][0]["section_patches"][0]["section_key"] == "recon"


@pytest.mark.anyio
async def test_list_project_report_proposals_resolves_evidence_previews(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)
    me = await client.get("/api/v1/auth/me", headers=_auth(auth_headers))
    assert me.status_code == 200, me.text
    user_id = me.json()["id"]
    session = await _create_terminal_session(test_db, project_id=project["id"])

    command = CommandHistory(
        id=f"cmd-{uuid.uuid4().hex[:8]}",
        project_id=project["id"],
        session_id=session.id,
        command="nmap -sV 10.129.34.191",
        output="80/tcp open http\n21/tcp open ftp",
        output_preview="80/tcp open http",
        exit_code=0,
        cwd="/tmp",
        duration_ms=125,
        executed_by=user_id,
    )
    finding = Timeline(
        id=f"timeline-{uuid.uuid4().hex[:8]}",
        project_id=project["id"],
        type="finding",
        content="Captured cleartext credentials in the export endpoint.",
        output="nathan:pakistan",
    )
    test_db.add_all([command, finding])
    await test_db.commit()

    report_service = ReportService(test_db)
    report = await report_service.ensure_report(project["id"], project["name"])
    await report_service.seed_default_sections(report.id)
    proposal = await report_service.create_manual_proposal(
        report.id,
        [
            {
                "section_key": "recon",
                "content_md": "Enumerated the exposed services and suspicious export endpoint.",
                "summary": "Add recon evidence",
                "evidence": [
                    {"source_type": "command_history", "source_id": command.id},
                    {"source_type": "timeline", "source_id": finding.id},
                ],
            }
        ],
    )

    response = await client.get(
        f"/api/v1/projects/{project['id']}/report/proposals",
        headers=_auth(auth_headers),
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] == 1
    assert payload["items"][0]["id"] == proposal.id

    proposal_payload = payload["items"][0]
    evidence_by_type = {
        evidence["source_type"]: evidence for evidence in proposal_payload["evidence_links"]
    }
    command_evidence = evidence_by_type["command_history"]
    timeline_evidence = evidence_by_type["timeline"]

    assert command_evidence["source_id"] == command.id
    assert command_evidence["label"] == "Command"
    assert command_evidence["preview"] == "nmap -sV 10.129.34.191"
    assert (
        command_evidence["href"]
        == f"/projects/{project['id']}/timeline?commandId={command.id}"
    )

    assert timeline_evidence["source_id"] == finding.id
    assert timeline_evidence["label"] == "Finding"
    assert timeline_evidence["preview"] == "Captured cleartext credentials in the export endpoint."
    assert (
        timeline_evidence["href"]
        == f"/projects/{project['id']}/timeline?entryId={finding.id}"
    )

    patch_evidence = proposal_payload["section_patches"][0]["evidence_links"]
    assert [evidence["source_type"] for evidence in patch_evidence] == [
        "command_history",
        "timeline",
    ]
    assert patch_evidence[0]["preview"] == "nmap -sV 10.129.34.191"
    assert patch_evidence[1]["preview"] == "Captured cleartext credentials in the export endpoint."


@pytest.mark.anyio
async def test_list_project_report_evidence_usage_includes_pending_and_accepted_only(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)
    me = await client.get("/api/v1/auth/me", headers=_auth(auth_headers))
    assert me.status_code == 200, me.text
    user_id = me.json()["id"]
    session = await _create_terminal_session(test_db, project_id=project["id"])
    pending_command = CommandHistory(
        id=f"cmd-pending-{uuid.uuid4().hex[:8]}",
        project_id=project["id"],
        session_id=session.id,
        command="nmap -sV 10.129.34.191",
        output="80/tcp open http",
        output_preview="80/tcp open http",
        exit_code=0,
        cwd="/tmp",
        duration_ms=125,
        executed_by=user_id,
    )
    accepted_finding = Timeline(
        id=f"timeline-accepted-{uuid.uuid4().hex[:8]}",
        project_id=project["id"],
        type="finding",
        content="Accepted report evidence.",
    )
    rejected_command = CommandHistory(
        id=f"cmd-rejected-{uuid.uuid4().hex[:8]}",
        project_id=project["id"],
        session_id=session.id,
        command="whoami",
        output="nathan",
        output_preview="nathan",
        exit_code=0,
        cwd="/tmp",
        duration_ms=25,
        executed_by=user_id,
    )
    test_db.add_all([pending_command, accepted_finding, rejected_command])
    await test_db.commit()

    report_service = ReportService(test_db)
    report = await report_service.ensure_report(project["id"], project["name"])
    await report_service.seed_default_sections(report.id)
    pending_proposal = await report_service.create_manual_proposal(
        report.id,
        [
            {
                "section_key": "recon",
                "content_md": "Pending recon evidence.",
                "summary": "Pending evidence",
                "evidence": [
                    {"source_type": "command_history", "source_id": pending_command.id},
                ],
            }
        ],
        trigger_type="graph_evidence",
    )
    accepted_proposal = await report_service.create_manual_proposal(
        report.id,
        [
            {
                "section_key": "recon",
                "content_md": "Accepted finding evidence.",
                "summary": "Accepted evidence",
                "evidence": [
                    {"source_type": "timeline", "source_id": accepted_finding.id},
                ],
            }
        ],
        trigger_type="manual",
    )
    rejected_proposal = await report_service.create_manual_proposal(
        report.id,
        [
            {
                "section_key": "recon",
                "content_md": "Rejected command evidence.",
                "summary": "Rejected evidence",
                "evidence": [
                    {"source_type": "command_history", "source_id": rejected_command.id},
                ],
            }
        ],
        trigger_type="manual",
    )
    await report_service.accept_proposal(
        report_id=report.id,
        proposal_id=accepted_proposal.id,
        workspace_path=project["workspace_path"],
    )
    await report_service.reject_proposal(
        report_id=report.id,
        proposal_id=rejected_proposal.id,
    )

    response = await client.get(
        f"/api/v1/projects/{project['id']}/report/evidence",
        headers=_auth(auth_headers),
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    evidence_by_source = {
        (item["source_type"], item["source_id"]): item
        for item in payload["items"]
    }
    assert payload["total"] == 2
    assert evidence_by_source[("command_history", pending_command.id)]["proposal_id"] == pending_proposal.id
    assert evidence_by_source[("command_history", pending_command.id)]["proposal_status"] == "pending"
    assert evidence_by_source[("timeline", accepted_finding.id)]["proposal_id"] == accepted_proposal.id
    assert evidence_by_source[("timeline", accepted_finding.id)]["proposal_status"] == "accepted"
    assert ("command_history", rejected_command.id) not in evidence_by_source


@pytest.mark.anyio
async def test_download_project_report_bundle_includes_report_graph_and_accepted_command_appendix_only(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)
    me = await client.get("/api/v1/auth/me", headers=_auth(auth_headers))
    assert me.status_code == 200, me.text
    user_id = me.json()["id"]
    session = await _create_terminal_session(test_db, project_id=project["id"])

    accepted_command = CommandHistory(
        id=f"cmd-accepted-{uuid.uuid4().hex[:8]}",
        project_id=project["id"],
        session_id=session.id,
        command="python3 -c 'import os; os.setuid(0); os.system(\"id\")'",
        output="uid=0(root) gid=0(root)",
        output_preview="uid=0(root)",
        exit_code=0,
        cwd="/tmp",
        duration_ms=250,
        executed_by=user_id,
    )
    pending_command = CommandHistory(
        id=f"cmd-pending-{uuid.uuid4().hex[:8]}",
        project_id=project["id"],
        session_id=session.id,
        command="nmap -sV 10.129.34.191",
        output="80/tcp open http",
        output_preview="80/tcp open http",
        exit_code=0,
        cwd="/tmp",
        duration_ms=125,
        executed_by=user_id,
    )
    rejected_command = CommandHistory(
        id=f"cmd-rejected-{uuid.uuid4().hex[:8]}",
        project_id=project["id"],
        session_id=session.id,
        command="whoami",
        output="nathan",
        output_preview="nathan",
        exit_code=0,
        cwd="/tmp",
        duration_ms=20,
        executed_by=user_id,
    )
    graph_node = GraphNodeDB(
        id=f"node-{uuid.uuid4().hex[:8]}",
        project_id=project["id"],
        type="host",
        label="10.129.34.191",
        created_by="import",
        sequence_index=1,
        source_step_ids=[accepted_command.id],
        tags=["accepted"],
        meta_json={"ip": "10.129.34.191"},
    )
    graph_edge = GraphEdgeDB(
        id=f"edge-{uuid.uuid4().hex[:8]}",
        project_id=project["id"],
        source_id=graph_node.id,
        target_id=graph_node.id,
        kind="related_to",
        source_step_id=accepted_command.id,
        command=accepted_command.command,
        tool="python",
        sequence_index=1,
    )
    test_db.add_all([
        accepted_command,
        pending_command,
        rejected_command,
        graph_node,
        graph_edge,
    ])
    await test_db.commit()

    report_service = ReportService(test_db)
    report = await report_service.ensure_report(project["id"], project["name"])
    await report_service.seed_default_sections(report.id)
    accepted_proposal = await report_service.create_manual_proposal(
        report.id,
        [
            {
                "section_key": "recon",
                "content_md": "Accepted root proof for the bundle.",
                "summary": "Accepted command evidence",
                "evidence": [
                    {"source_type": "command_history", "source_id": accepted_command.id},
                ],
            }
        ],
    )
    pending_proposal = await report_service.create_manual_proposal(
        report.id,
        [
            {
                "section_key": "recon",
                "content_md": "Pending command must not export.",
                "summary": "Pending command evidence",
                "evidence": [
                    {"source_type": "command_history", "source_id": pending_command.id},
                ],
            }
        ],
    )
    rejected_proposal = await report_service.create_manual_proposal(
        report.id,
        [
            {
                "section_key": "recon",
                "content_md": "Rejected command must not export.",
                "summary": "Rejected command evidence",
                "evidence": [
                    {"source_type": "command_history", "source_id": rejected_command.id},
                ],
            }
        ],
    )
    await report_service.accept_proposal(
        report_id=report.id,
        proposal_id=accepted_proposal.id,
        workspace_path=project["workspace_path"],
    )
    await report_service.reject_proposal(
        report_id=report.id,
        proposal_id=rejected_proposal.id,
    )

    response = await client.get(
        f"/api/v1/projects/{project['id']}/report/bundle",
        headers=_auth(auth_headers),
    )

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/zip"
    assert "attachment" in response.headers["content-disposition"]
    bundle_content = response.content

    with zipfile.ZipFile(BytesIO(bundle_content)) as archive:
        names = set(archive.namelist())
        assert names == {
            "report.md",
            "attack-graph.json",
            "attack-graph.png",
            "attack-graph.svg",
            "accepted-evidence-commands.md",
            "accepted-evidence-commands.json",
            "manifest.json",
        }
        report_markdown = archive.read("report.md").decode()
        graph_png = archive.read("attack-graph.png")
        graph_svg = archive.read("attack-graph.svg").decode()
        command_markdown = archive.read("accepted-evidence-commands.md").decode()
        command_json = json.loads(archive.read("accepted-evidence-commands.json"))
        graph_json = json.loads(archive.read("attack-graph.json"))
        manifest = json.loads(archive.read("manifest.json"))

    assert "Accepted root proof for the bundle." in report_markdown
    assert "## Attack Graph" in report_markdown
    assert "![Attack Graph](attack-graph.png)" in report_markdown
    assert graph_png.startswith(b"\x89PNG\r\n\x1a\n")
    assert len(graph_png) > 1024
    assert graph_svg.startswith("<svg")
    assert "10.129.34.191" in graph_svg
    assert "related to" in graph_svg
    assert accepted_command.command in command_markdown
    assert accepted_command.output in command_markdown
    assert pending_command.command not in command_markdown
    assert rejected_command.command not in command_markdown
    assert [item["id"] for item in command_json["commands"]] == [accepted_command.id]
    assert command_json["commands"][0]["proposal_id"] == accepted_proposal.id
    assert pending_proposal.id not in {item["proposal_id"] for item in command_json["commands"]}
    assert graph_json["nodes"][0]["id"] == graph_node.id
    assert graph_json["edges"][0]["id"] == graph_edge.id
    assert manifest["files"]["attack_graph_png"] == "attack-graph.png"
    assert manifest["files"]["attack_graph_svg"] == "attack-graph.svg"
    assert manifest["files"]["accepted_evidence_commands_md"] == "accepted-evidence-commands.md"
    assert manifest["accepted_command_count"] == 1

    artifacts_response = await client.get(
        f"/api/v1/projects/{project['id']}/report/bundle/artifacts",
        headers=_auth(auth_headers),
    )

    assert artifacts_response.status_code == 200, artifacts_response.text
    artifacts_body = artifacts_response.json()
    assert artifacts_body["total"] == 1
    artifact = artifacts_body["items"][0]
    assert artifact["filename"].endswith("-report-bundle.zip")
    assert artifact["content_type"] == "application/zip"
    assert artifact["size_bytes"] == len(bundle_content)
    assert artifact["sha256"] == hashlib.sha256(bundle_content).hexdigest()
    assert artifact["report_revision"] == 1
    assert artifact["graph_node_count"] == 1
    assert artifact["graph_edge_count"] == 1
    assert artifact["accepted_command_count"] == 1
    assert artifact["accepted_command_ids"] == [accepted_command.id]

    graph_preview_response = await client.get(
        f"/api/v1/projects/{project['id']}/report/bundle/artifacts/{artifact['id']}/graph.svg",
        headers=_auth(auth_headers),
    )
    assert graph_preview_response.status_code == 200, graph_preview_response.text
    assert graph_preview_response.headers["content-type"].startswith("image/svg+xml")
    assert graph_preview_response.text.startswith("<svg")
    assert "10.129.34.191" in graph_preview_response.text

    graph_png_response = await client.get(
        f"/api/v1/projects/{project['id']}/report/bundle/artifacts/{artifact['id']}/graph.png",
        headers=_auth(auth_headers),
    )
    assert graph_png_response.status_code == 200, graph_png_response.text
    assert graph_png_response.headers["content-type"].startswith("image/png")
    assert graph_png_response.content.startswith(b"\x89PNG\r\n\x1a\n")
    assert len(graph_png_response.content) > 1024

    artifact_download = await client.get(
        f"/api/v1/projects/{project['id']}/report/bundle/artifacts/{artifact['id']}/download",
        headers=_auth(auth_headers),
    )

    assert artifact_download.status_code == 200, artifact_download.text
    assert artifact_download.headers["content-type"] == "application/zip"
    assert artifact_download.headers["content-disposition"].endswith(
        f'filename="{artifact["filename"]}"'
    )
    assert artifact_download.content == bundle_content


@pytest.mark.anyio
async def test_export_project_report_folder_writes_current_writeup_assets_without_bundle_artifact(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)
    me = await client.get("/api/v1/auth/me", headers=_auth(auth_headers))
    assert me.status_code == 200, me.text
    user_id = me.json()["id"]
    session = await _create_terminal_session(test_db, project_id=project["id"])

    accepted_command = CommandHistory(
        id=f"cmd-export-{uuid.uuid4().hex[:8]}",
        project_id=project["id"],
        session_id=session.id,
        command="getcap -r / 2>/dev/null",
        output="/usr/bin/python3.8 = cap_setuid+ep",
        output_preview="/usr/bin/python3.8 = cap_setuid+ep",
        exit_code=0,
        cwd="/tmp",
        duration_ms=210,
        executed_by=user_id,
    )
    graph_node = GraphNodeDB(
        id=f"node-export-{uuid.uuid4().hex[:8]}",
        project_id=project["id"],
        type="finding",
        label="python3.8 cap_setuid",
        created_by="import",
        sequence_index=1,
        source_step_ids=[accepted_command.id],
        tags=["privesc"],
        meta_json={"capability": "cap_setuid+ep"},
    )
    test_db.add_all([accepted_command, graph_node])
    await test_db.commit()

    report_service = ReportService(test_db)
    report = await report_service.ensure_report(project["id"], project["name"])
    await report_service.seed_default_sections(report.id)
    proposal = await report_service.create_manual_proposal(
        report.id,
        [
            {
                "section_key": "privilege_escalation",
                "content_md": "Privilege escalated through python capability abuse.",
                "summary": "Accepted privilege escalation evidence",
                "evidence": [
                    {"source_type": "command_history", "source_id": accepted_command.id},
                ],
            }
        ],
    )
    await report_service.accept_proposal(
        report_id=report.id,
        proposal_id=proposal.id,
        workspace_path=project["workspace_path"],
    )

    artifacts_before = await client.get(
        f"/api/v1/projects/{project['id']}/report/bundle/artifacts",
        headers=_auth(auth_headers),
    )
    assert artifacts_before.status_code == 200, artifacts_before.text
    assert artifacts_before.json()["total"] == 0

    response = await client.post(
        f"/api/v1/projects/{project['id']}/report/folder-export",
        headers=_auth(auth_headers),
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    export_dir = Path(payload["path"])
    assert export_dir == Path(project["workspace_path"]) / "writeup-export"
    assert payload["file_count"] == 7
    assert payload["files"]["report_md"] == str(export_dir / "report.md")
    assert payload["files"]["attack_graph_png"] == str(export_dir / "attack-graph.png")
    assert payload["files"]["attack_graph_svg"] == str(export_dir / "attack-graph.svg")
    assert payload["manifest"]["accepted_command_ids"] == [accepted_command.id]

    assert export_dir.exists()
    report_markdown = (export_dir / "report.md").read_text()
    command_appendix = (export_dir / "accepted-evidence-commands.md").read_text()
    graph_json = json.loads((export_dir / "attack-graph.json").read_text())
    graph_png = (export_dir / "attack-graph.png").read_bytes()
    graph_svg = (export_dir / "attack-graph.svg").read_text()
    manifest = json.loads((export_dir / "manifest.json").read_text())

    assert "Privilege escalated through python capability abuse." in report_markdown
    assert "![Attack Graph](attack-graph.png)" in report_markdown
    assert accepted_command.command in command_appendix
    assert accepted_command.output in command_appendix
    assert graph_json["nodes"][0]["id"] == graph_node.id
    assert graph_png.startswith(b"\x89PNG\r\n\x1a\n")
    assert graph_svg.startswith("<svg")
    assert manifest["files"]["report_md"] == "report.md"

    artifacts_after = await client.get(
        f"/api/v1/projects/{project['id']}/report/bundle/artifacts",
        headers=_auth(auth_headers),
    )
    assert artifacts_after.status_code == 200, artifacts_after.text
    assert artifacts_after.json()["total"] == 0


@pytest.mark.anyio
async def test_sync_project_report_to_notes_writes_writeup_source_and_indexes_doc(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)
    me = await client.get("/api/v1/auth/me", headers=_auth(auth_headers))
    assert me.status_code == 200, me.text
    user_id = me.json()["id"]
    session = await _create_terminal_session(test_db, project_id=project["id"])

    accepted_command = CommandHistory(
        id=f"cmd-notes-{uuid.uuid4().hex[:8]}",
        project_id=project["id"],
        session_id=session.id,
        command="ssh nathan@10.129.34.191",
        output="Last login: shell opened",
        output_preview="Last login: shell opened",
        exit_code=0,
        cwd="/tmp",
        duration_ms=330,
        executed_by=user_id,
    )
    graph_node = GraphNodeDB(
        id=f"node-notes-{uuid.uuid4().hex[:8]}",
        project_id=project["id"],
        type="session",
        label="SSH session: nathan@10.129.34.191",
        created_by="import",
        sequence_index=1,
        source_step_ids=[accepted_command.id],
        tags=["foothold"],
        meta_json={"user": "nathan"},
    )
    test_db.add_all([accepted_command, graph_node])
    await test_db.commit()

    report_service = ReportService(test_db)
    report = await report_service.ensure_report(project["id"], project["name"])
    await report_service.seed_default_sections(report.id)
    proposal = await report_service.create_manual_proposal(
        report.id,
        [
            {
                "section_key": "privilege_escalation",
                "content_md": "Validated SSH login and escalated with capability abuse.",
                "summary": "Accepted escalation evidence",
                "evidence": [
                    {"source_type": "command_history", "source_id": accepted_command.id},
                ],
            }
        ],
    )
    await report_service.accept_proposal(
        report_id=report.id,
        proposal_id=proposal.id,
        workspace_path=project["workspace_path"],
    )

    first_response = await client.post(
        f"/api/v1/projects/{project['id']}/report/notes-sync",
        headers=_auth(auth_headers),
    )

    assert first_response.status_code == 200, first_response.text
    payload = first_response.json()
    notes_dir = Path(project["workspace_path"]) / "writeup-notes"
    assert payload["source_name"] == "Report Write-up"
    assert payload["source_path"] == str(notes_dir)
    assert payload["doc_path"] == "Write-up.md"
    assert payload["report_revision"] == 1
    assert payload["generated_at"]
    assert payload["file_count"] == 7
    assert payload["files"]["report_md"] == str(notes_dir / "Write-up.md")
    assert payload["files"]["attack_graph_png"] == str(notes_dir / "attack-graph.png")
    assert payload["stats"]["added"] == 2
    assert payload["stats"]["errors"] == []

    writeup_markdown = (notes_dir / "Write-up.md").read_text()
    command_appendix = (notes_dir / "accepted-evidence-commands.md").read_text()
    graph_json = json.loads((notes_dir / "attack-graph.json").read_text())
    graph_png = (notes_dir / "attack-graph.png").read_bytes()
    graph_svg = (notes_dir / "attack-graph.svg").read_text()

    assert writeup_markdown.startswith("---\ntitle: Write-up")
    assert "Validated SSH login and escalated with capability abuse." in writeup_markdown
    assert "![Attack Graph](attack-graph.png)" in writeup_markdown
    assert accepted_command.command in command_appendix
    assert accepted_command.output in command_appendix
    assert graph_json["nodes"][0]["id"] == graph_node.id
    assert graph_png.startswith(b"\x89PNG\r\n\x1a\n")
    assert graph_svg.startswith("<svg")

    source_result = await test_db.execute(
        select(KnowledgeSource).where(
            KnowledgeSource.project_id == project["id"],
            KnowledgeSource.user_id == user_id,
            KnowledgeSource.name == "Report Write-up",
        )
    )
    sources = list(source_result.scalars().all())
    assert len(sources) == 1
    source = sources[0]
    assert source.path == str(notes_dir)
    assert source.read_only is False

    doc_result = await test_db.execute(
        select(KnowledgeDoc).where(
            KnowledgeDoc.source_id == source.id,
            KnowledgeDoc.relative_path == "Write-up.md",
        )
    )
    writeup_doc = doc_result.scalar_one()
    assert payload["source_id"] == source.id
    assert payload["doc_id"] == writeup_doc.id
    assert writeup_doc.title == "Write-up"
    assert writeup_doc.tags == "report writeup"

    status_response = await client.get(
        f"/api/v1/projects/{project['id']}/report/notes-sync",
        headers=_auth(auth_headers),
    )
    assert status_response.status_code == 200, status_response.text
    status_payload = status_response.json()
    assert status_payload["sync"]["source_id"] == source.id
    assert status_payload["sync"]["source_name"] == "Report Write-up"
    assert status_payload["sync"]["source_path"] == str(notes_dir)
    assert status_payload["sync"]["doc_id"] == writeup_doc.id
    assert status_payload["sync"]["doc_path"] == "Write-up.md"
    assert status_payload["sync"]["report_revision"] == 1
    assert status_payload["sync"]["generated_at"] == payload["generated_at"]
    assert status_payload["sync"]["files"]["report_md"] == str(notes_dir / "Write-up.md")
    assert status_payload["sync"]["stats"]["cached"] is True

    stale_proposal = await report_service.create_manual_proposal(
        report.id,
        [
            {
                "section_key": "privilege_escalation",
                "content_md": "Added post-sync root proof and cleanup notes.",
                "summary": "Post-sync report update",
                "evidence": [
                    {"source_type": "command_history", "source_id": accepted_command.id},
                ],
            }
        ],
    )
    await report_service.accept_proposal(
        report_id=report.id,
        proposal_id=stale_proposal.id,
        workspace_path=project["workspace_path"],
    )

    diff_response = await client.get(
        f"/api/v1/projects/{project['id']}/report/notes-sync/diff",
        headers=_auth(auth_headers),
    )
    assert diff_response.status_code == 200, diff_response.text
    diff_payload = diff_response.json()
    assert diff_payload["changed"] is True
    assert diff_payload["synced_report_revision"] == 1
    assert diff_payload["current_report_revision"] == 2
    assert "+Added post-sync root proof and cleanup notes." in diff_payload["diff_text"]

    second_response = await client.post(
        f"/api/v1/projects/{project['id']}/report/notes-sync",
        headers=_auth(auth_headers),
    )
    assert second_response.status_code == 200, second_response.text
    second_payload = second_response.json()
    assert second_payload["source_id"] == source.id
    assert second_payload["doc_id"] == writeup_doc.id

    source_count_result = await test_db.execute(
        select(KnowledgeSource).where(
            KnowledgeSource.project_id == project["id"],
            KnowledgeSource.name == "Report Write-up",
        )
    )
    assert len(list(source_count_result.scalars().all())) == 1


@pytest.mark.anyio
async def test_get_project_report_notes_sync_returns_empty_status_before_sync(
    client: AsyncClient,
    auth_headers: dict[str, str],
):
    project = await _create_project(client, auth_headers)

    response = await client.get(
        f"/api/v1/projects/{project['id']}/report/notes-sync",
        headers=_auth(auth_headers),
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"sync": None}


@pytest.mark.anyio
async def test_compare_project_report_bundle_artifacts_summarizes_markdown_graph_and_command_delta(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)
    me = await client.get("/api/v1/auth/me", headers=_auth(auth_headers))
    assert me.status_code == 200, me.text
    user_id = me.json()["id"]
    session = await _create_terminal_session(test_db, project_id=project["id"])

    first_command = CommandHistory(
        id=f"cmd-first-{uuid.uuid4().hex[:8]}",
        project_id=project["id"],
        session_id=session.id,
        command="nmap -sV 10.129.34.191",
        output="21/tcp open ftp\n80/tcp open http",
        output_preview="21/tcp open ftp",
        exit_code=0,
        cwd="/tmp",
        duration_ms=125,
        executed_by=user_id,
    )
    first_node = GraphNodeDB(
        id=f"node-first-{uuid.uuid4().hex[:8]}",
        project_id=project["id"],
        type="host",
        label="10.129.34.191",
        created_by="import",
        sequence_index=1,
        source_step_ids=[first_command.id],
        tags=["recon"],
        meta_json={"ip": "10.129.34.191"},
    )
    first_edge = GraphEdgeDB(
        id=f"edge-first-{uuid.uuid4().hex[:8]}",
        project_id=project["id"],
        source_id=first_node.id,
        target_id=first_node.id,
        kind="related_to",
        source_step_id=first_command.id,
        command=first_command.command,
        tool="nmap",
        sequence_index=1,
    )
    test_db.add_all([first_command, first_node, first_edge])
    await test_db.commit()

    report_service = ReportService(test_db)
    report = await report_service.ensure_report(project["id"], project["name"])
    await report_service.seed_default_sections(report.id)
    first_proposal = await report_service.create_manual_proposal(
        report.id,
        [
            {
                "section_key": "recon",
                "content_md": "Initial recon proof from nmap.",
                "summary": "Initial accepted recon evidence",
                "evidence": [
                    {"source_type": "command_history", "source_id": first_command.id},
                ],
            }
        ],
    )
    await report_service.accept_proposal(
        report_id=report.id,
        proposal_id=first_proposal.id,
        workspace_path=project["workspace_path"],
    )

    first_bundle_response = await client.get(
        f"/api/v1/projects/{project['id']}/report/bundle",
        headers=_auth(auth_headers),
    )
    assert first_bundle_response.status_code == 200, first_bundle_response.text
    artifacts_response = await client.get(
        f"/api/v1/projects/{project['id']}/report/bundle/artifacts",
        headers=_auth(auth_headers),
    )
    assert artifacts_response.status_code == 200, artifacts_response.text
    base_artifact = artifacts_response.json()["items"][0]

    first_node.is_deleted = True
    await test_db.delete(first_edge)
    await test_db.commit()

    second_command = CommandHistory(
        id=f"cmd-second-{uuid.uuid4().hex[:8]}",
        project_id=project["id"],
        session_id=session.id,
        command="getcap -r / 2>/dev/null",
        output="/usr/bin/python3.8 = cap_setuid+ep",
        output_preview="/usr/bin/python3.8 = cap_setuid+ep",
        exit_code=0,
        cwd="/tmp",
        duration_ms=210,
        executed_by=user_id,
    )
    second_node = GraphNodeDB(
        id=f"node-second-{uuid.uuid4().hex[:8]}",
        project_id=project["id"],
        type="finding",
        label="python3.8 cap_setuid",
        created_by="import",
        sequence_index=2,
        source_step_ids=[second_command.id],
        tags=["privesc"],
        meta_json={"capability": "cap_setuid+ep"},
    )
    second_edge = GraphEdgeDB(
        id=f"edge-second-{uuid.uuid4().hex[:8]}",
        project_id=project["id"],
        source_id=second_node.id,
        target_id=second_node.id,
        kind="related_to",
        source_step_id=second_command.id,
        command=second_command.command,
        tool="getcap",
        sequence_index=2,
    )
    test_db.add_all([second_command, second_node, second_edge])
    await test_db.commit()

    second_proposal = await report_service.create_manual_proposal(
        report.id,
        [
            {
                "section_key": "privilege_escalation",
                "content_md": "Privilege escalated through python capability abuse.",
                "summary": "Accepted privilege escalation evidence",
                "evidence": [
                    {"source_type": "command_history", "source_id": second_command.id},
                ],
            }
        ],
    )
    await report_service.accept_proposal(
        report_id=report.id,
        proposal_id=second_proposal.id,
        workspace_path=project["workspace_path"],
    )
    second_bundle_response = await client.get(
        f"/api/v1/projects/{project['id']}/report/bundle",
        headers=_auth(auth_headers),
    )
    assert second_bundle_response.status_code == 200, second_bundle_response.text

    artifacts_response = await client.get(
        f"/api/v1/projects/{project['id']}/report/bundle/artifacts",
        headers=_auth(auth_headers),
    )
    assert artifacts_response.status_code == 200, artifacts_response.text
    artifacts = artifacts_response.json()["items"]
    target_artifact = next(item for item in artifacts if item["report_revision"] == 2)

    compare_response = await client.get(
        f"/api/v1/projects/{project['id']}/report/bundle/artifacts/compare",
        params={
            "base_artifact_id": base_artifact["id"],
            "target_artifact_id": target_artifact["id"],
        },
        headers=_auth(auth_headers),
    )

    assert compare_response.status_code == 200, compare_response.text
    payload = compare_response.json()
    assert payload["base"]["id"] == base_artifact["id"]
    assert payload["target"]["id"] == target_artifact["id"]
    assert payload["report_diff"]["changed"] is True
    assert "Privilege escalated through python capability abuse." in payload["report_diff"]["diff_text"]
    assert payload["commands"]["added_ids"] == [second_command.id]
    assert payload["commands"]["removed_ids"] == []
    assert payload["commands"]["unchanged_ids"] == [first_command.id]
    assert payload["graph"]["added_node_ids"] == [second_node.id]
    assert payload["graph"]["removed_node_ids"] == [first_node.id]
    assert payload["graph"]["added_edge_ids"] == [second_edge.id]
    assert payload["graph"]["removed_edge_ids"] == [first_edge.id]
    assert payload["graph"]["added_nodes"][0]["id"] == second_node.id
    assert payload["graph"]["added_nodes"][0]["label"] == "python3.8 cap_setuid"
    assert payload["graph"]["removed_nodes"][0]["id"] == first_node.id
    assert payload["graph"]["removed_nodes"][0]["label"] == "10.129.34.191"
    assert payload["graph"]["added_edges"][0]["id"] == second_edge.id
    assert payload["graph"]["removed_edges"][0]["id"] == first_edge.id
    assert payload["summary"]["added_commands"] == 1
    assert payload["summary"]["added_nodes"] == 1
    assert payload["summary"]["removed_nodes"] == 1
    assert payload["summary"]["added_edges"] == 1
    assert payload["summary"]["removed_edges"] == 1


@pytest.mark.anyio
async def test_create_project_report_proposal_appends_command_evidence_to_matching_section(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)
    me = await client.get("/api/v1/auth/me", headers=_auth(auth_headers))
    assert me.status_code == 200, me.text
    user_id = me.json()["id"]
    session = await _create_terminal_session(test_db, project_id=project["id"])
    command = CommandHistory(
        id=f"cmd-{uuid.uuid4().hex[:8]}",
        project_id=project["id"],
        session_id=session.id,
        command="nmap -sV 10.129.34.191",
        output="80/tcp open http",
        output_preview="80/tcp open http",
        exit_code=0,
        cwd="/tmp",
        duration_ms=125,
        executed_by=user_id,
    )
    test_db.add(command)
    await test_db.commit()

    report_service = ReportService(test_db)
    report = await report_service.ensure_report(project["id"], project["name"])
    await report_service.seed_default_sections(report.id)
    section = (
        await test_db.execute(
            select(ReportSectionDB).where(
                ReportSectionDB.report_id == report.id,
                ReportSectionDB.key == "recon",
            )
        )
    ).scalar_one()
    section.content_md = "Existing recon context."
    await test_db.commit()

    response = await client.post(
        f"/api/v1/projects/{project['id']}/report/proposals",
        headers=_auth(auth_headers),
        json={
            "section_hint": "enumeration",
            "content_md": "### WEB01 evidence\n\n- Command: `nmap -sV 10.129.34.191`",
            "summary": "Add WEB01 service enumeration evidence",
            "trigger_type": "graph_evidence",
            "evidence": [
                {"source_type": "command_history", "source_id": command.id},
            ],
        },
    )

    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["duplicate"] is False
    proposal = payload["proposal"]
    assert proposal["trigger_type"] == "graph_evidence"
    assert proposal["summary"] == "Add WEB01 service enumeration evidence"
    patch = proposal["section_patches"][0]
    assert patch["section_key"] == "recon"
    assert patch["current_content_md"] == "Existing recon context."
    assert "Existing recon context." in patch["content_md"]
    assert "WEB01 evidence" in patch["content_md"]
    assert patch["evidence_links"][0]["source_type"] == "command_history"
    assert patch["evidence_links"][0]["preview"] == "nmap -sV 10.129.34.191"


@pytest.mark.anyio
async def test_create_project_report_proposal_reuses_existing_evidence_proposal(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)
    me = await client.get("/api/v1/auth/me", headers=_auth(auth_headers))
    assert me.status_code == 200, me.text
    user_id = me.json()["id"]
    session = await _create_terminal_session(test_db, project_id=project["id"])
    command = CommandHistory(
        id=f"cmd-{uuid.uuid4().hex[:8]}",
        project_id=project["id"],
        session_id=session.id,
        command="nmap -sV 10.129.34.191",
        output="80/tcp open http",
        output_preview="80/tcp open http",
        exit_code=0,
        cwd="/tmp",
        duration_ms=125,
        executed_by=user_id,
    )
    test_db.add(command)
    await test_db.commit()

    payload = {
        "section_hint": "enumeration",
        "content_md": "### WEB01 evidence\n\n- Command: `nmap -sV 10.129.34.191`",
        "summary": "Add WEB01 service enumeration evidence",
        "trigger_type": "graph_evidence",
        "evidence": [
            {"source_type": "command_history", "source_id": command.id},
        ],
    }

    first_response = await client.post(
        f"/api/v1/projects/{project['id']}/report/proposals",
        headers=_auth(auth_headers),
        json=payload,
    )
    second_response = await client.post(
        f"/api/v1/projects/{project['id']}/report/proposals",
        headers=_auth(auth_headers),
        json={
            **payload,
            "content_md": "### Duplicate content that should not be persisted",
        },
    )

    assert first_response.status_code == 201, first_response.text
    assert second_response.status_code == 200, second_response.text
    first_payload = first_response.json()
    second_payload = second_response.json()
    assert first_payload["duplicate"] is False
    assert second_payload["duplicate"] is True
    assert second_payload["proposal"]["id"] == first_payload["proposal"]["id"]
    assert "Duplicate content" not in second_payload["proposal"]["section_patches"][0]["content_md"]

    proposals_response = await client.get(
        f"/api/v1/projects/{project['id']}/report/proposals",
        headers=_auth(auth_headers),
    )
    assert proposals_response.status_code == 200, proposals_response.text
    assert proposals_response.json()["total"] == 1


@pytest.mark.anyio
async def test_recording_command_marks_project_report_dirty(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    project = await _create_project(client, auth_headers)
    session = await _create_terminal_session(test_db, project_id=project["id"])
    fresh_signal_service = ReportSignalService()
    monkeypatch.setattr(
        "app.routers.command_history.report_signal_service",
        fresh_signal_service,
    )

    response = await client.post(
        f"/api/v1/terminal/sessions/{session.id}/commands",
        headers=_auth(auth_headers),
        json={
            "command": "nmap -sV 10.10.10.10",
            "output": "80/tcp open http",
            "exit_code": 0,
            "cwd": "/tmp",
            "duration_ms": 42,
        },
    )

    assert response.status_code == 201, response.text
    assert fresh_signal_service.list_pending_project_ids() == [project["id"]]


@pytest.mark.anyio
async def test_evaluate_project_report_creates_pending_proposal(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    project = await _create_project(client, auth_headers)
    me = await client.get("/api/v1/auth/me", headers=_auth(auth_headers))
    user_id = me.json()["id"]
    report = await ReportService(test_db).ensure_report(project["id"], project["name"])
    await ReportService(test_db).seed_default_sections(report.id)
    proposal = await ReportService(test_db).create_manual_proposal(
        report.id,
        [
            {
                "section_key": "recon",
                "content_md": "Generated recon draft",
                "summary": "Generated recon update",
            }
        ],
        trigger_type="manual",
    )
    queued_task = ReportEvaluationTask(
        task_id=f"task-{uuid.uuid4().hex[:8]}",
        project_id=project["id"],
        user_id=user_id,
        trigger_type="manual",
        status="queued",
    )
    completed_task = ReportEvaluationTask(
        task_id=queued_task.task_id,
        project_id=project["id"],
        user_id=user_id,
        trigger_type="manual",
        status="completed",
        proposal_id=proposal.id,
        created_at=queued_task.created_at,
        started_at=queued_task.created_at,
        completed_at=queued_task.created_at,
    )
    monkeypatch.setattr(
        "app.routers.report.report_evaluation_task_manager",
        _StubReportEvaluationTaskManager(
            queued_task=queued_task,
            completed_task=completed_task,
        ),
    )

    response = await client.post(
        f"/api/v1/projects/{project['id']}/report/evaluate",
        headers=_auth(auth_headers),
    )

    assert response.status_code == 202, response.text
    payload = response.json()
    assert payload["project_id"] == project["id"]
    assert payload["status"] in {"queued", "running"}
    assert payload["task_id"]
    assert payload["proposal_id"] is None

    status_payload = None
    for _ in range(20):
        status_response = await client.get(
            f"/api/v1/projects/{project['id']}/report/evaluate/{payload['task_id']}",
            headers=_auth(auth_headers),
        )
        assert status_response.status_code == 200, status_response.text
        status_payload = status_response.json()
        if status_payload["status"] == "completed":
            break
        await asyncio.sleep(0.01)

    assert status_payload is not None
    assert status_payload["status"] == "completed"
    assert status_payload["proposal_id"] is not None

    proposals_response = await client.get(
        f"/api/v1/projects/{project['id']}/report/proposals",
        headers=_auth(auth_headers),
    )

    assert proposals_response.status_code == 200, proposals_response.text
    proposals_payload = proposals_response.json()
    assert proposals_payload["total"] == 1
    assert proposals_payload["items"][0]["id"] == status_payload["proposal_id"]
    assert proposals_payload["items"][0]["status"] == "pending"


@pytest.mark.anyio
async def test_evaluate_project_report_reuses_existing_running_task(
    client: AsyncClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
):
    project = await _create_project(client, auth_headers)
    release_generation = asyncio.Event()
    me = await client.get("/api/v1/auth/me", headers=_auth(auth_headers))
    user_id = me.json()["id"]
    queued_task = ReportEvaluationTask(
        task_id=f"task-{uuid.uuid4().hex[:8]}",
        project_id=project["id"],
        user_id=user_id,
        trigger_type="manual",
        status="running",
    )
    completed_task = ReportEvaluationTask(
        task_id=queued_task.task_id,
        project_id=project["id"],
        user_id=user_id,
        trigger_type="manual",
        status="completed",
        created_at=queued_task.created_at,
        started_at=queued_task.created_at,
        completed_at=queued_task.created_at,
    )
    monkeypatch.setattr(
        "app.routers.report.report_evaluation_task_manager",
        _StubReportEvaluationTaskManager(
            queued_task=queued_task,
            completed_task=completed_task,
            completion_event=release_generation,
        ),
    )

    first_response = await client.post(
        f"/api/v1/projects/{project['id']}/report/evaluate",
        headers=_auth(auth_headers),
    )
    second_response = await client.post(
        f"/api/v1/projects/{project['id']}/report/evaluate",
        headers=_auth(auth_headers),
    )

    assert first_response.status_code == 202, first_response.text
    assert second_response.status_code == 202, second_response.text
    first_payload = first_response.json()
    second_payload = second_response.json()
    assert second_payload["task_id"] == first_payload["task_id"]
    assert second_payload["status"] in {"queued", "running"}

    release_generation.set()
    final_payload = None
    for _ in range(20):
        status_response = await client.get(
            f"/api/v1/projects/{project['id']}/report/evaluate/{first_payload['task_id']}",
            headers=_auth(auth_headers),
        )
        assert status_response.status_code == 200, status_response.text
        final_payload = status_response.json()
        if final_payload["status"] == "completed":
            break
        await asyncio.sleep(0.01)

    assert final_payload is not None
    assert final_payload["status"] == "completed"


@pytest.mark.anyio
async def test_section_scoped_evaluate_project_report_queues_targeted_task(
    client: AsyncClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
):
    project = await _create_project(client, auth_headers)
    me = await client.get("/api/v1/auth/me", headers=_auth(auth_headers))
    user_id = me.json()["id"]
    queued_task = SimpleNamespace(
        task_id=f"task-{uuid.uuid4().hex[:8]}",
        project_id=project["id"],
        user_id=user_id,
        trigger_type="manual",
        target_section_keys=["privilege_escalation"],
        status="queued",
        proposal_id=None,
        error=None,
        created_at=datetime.now(UTC),
        started_at=None,
        completed_at=None,
    )
    monkeypatch.setattr(
        "app.routers.report.report_evaluation_task_manager",
        _StubReportEvaluationTaskManager(
            queued_task=queued_task,
            expected_target_section_keys=["privilege_escalation"],
        ),
    )

    response = await client.post(
        f"/api/v1/projects/{project['id']}/report/sections/privilege_escalation/evaluate",
        headers=_auth(auth_headers),
    )

    assert response.status_code == 202, response.text
    payload = response.json()
    assert payload["project_id"] == project["id"]
    assert payload["status"] == "queued"
    assert payload["target_section_keys"] == ["privilege_escalation"]


@pytest.mark.anyio
async def test_accept_proposal_increments_revision_and_rewrites_markdown(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)
    report_service = ReportService(test_db)
    report = await report_service.ensure_report(project["id"], project["name"])
    await report_service.seed_default_sections(report.id)
    before_response = await client.get(
        f"/api/v1/projects/{project['id']}/report",
        headers=_auth(auth_headers),
    )
    assert before_response.status_code == 200, before_response.text
    before_revision = before_response.json()["current_revision"]
    report_path = Path(project["workspace_path"]) / "report.md"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("stale write-up\n")
    proposal = await report_service.create_manual_proposal(
        report.id,
        [
            {
                "section_key": "privilege_escalation",
                "content_md": "Escalated to root via capability abuse.",
                "summary": "Add privesc details",
            }
        ],
    )

    response = await client.post(
        f"/api/v1/projects/{project['id']}/report/proposals/{proposal.id}/accept",
        headers=_auth(auth_headers),
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["report"]["current_revision"] == before_revision + 1
    assert payload["proposal"]["status"] == "accepted"
    assert payload["report"]["markdown_path"] == str(report_path)

    written_report = report_path.read_text()
    expected_report = await report_service.render_report_markdown(report.id)
    assert written_report != "stale write-up\n"
    assert "stale write-up" not in written_report
    assert written_report == expected_report
    assert "Escalated to root via capability abuse." in written_report


@pytest.mark.anyio
async def test_reject_proposal_marks_it_rejected(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)
    report_service = ReportService(test_db)
    report = await report_service.ensure_report(project["id"], project["name"])
    await report_service.seed_default_sections(report.id)
    proposal = await report_service.create_manual_proposal(
        report.id,
        [
            {
                "section_key": "loot_evidence",
                "content_md": "Should not be accepted.",
                "summary": "Reject this update",
            }
        ],
    )

    response = await client.post(
        f"/api/v1/projects/{project['id']}/report/proposals/{proposal.id}/reject",
        headers=_auth(auth_headers),
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["proposal"]["status"] == "rejected"
    assert payload["report"]["current_revision"] == 0


@pytest.mark.anyio
async def test_mock_seed_creates_profiled_report_pending_updates_and_graph(
    client: AsyncClient,
    auth_headers: dict[str, str],
):
    response = await client.post(
        "/api/v1/projects",
        json={"name": f"Mock HTB {uuid.uuid4().hex[:8]}", "type": "htb"},
        headers=_auth(auth_headers),
    )
    assert response.status_code == 201, response.text
    project = response.json()

    seed_response = await client.post(
        f"/api/v1/projects/{project['id']}/report/mock-seed/demo-ctf",
        headers=_auth(auth_headers),
    )

    assert seed_response.status_code == 200, seed_response.text
    payload = seed_response.json()
    assert payload["project_id"] == project["id"]
    assert payload["scenario"] == "demo-ctf"
    assert payload["accepted_revision_count"] >= 1
    assert payload["report"]["profile"] == "htb_writeup"
    assert payload["report"]["current_revision"] >= 1
    assert payload["pending_proposals"]
    assert payload["pending_proposals"][0]["section_patches"]
    assert payload["pending_proposals"][0]["section_patches"][0]["evidence_links"]

    graph_response = await client.get(
        f"/api/v1/projects/{project['id']}/graph",
        headers=_auth(auth_headers),
    )
    assert graph_response.status_code == 200, graph_response.text
    graph_payload = graph_response.json()
    assert graph_payload["nodes"]
    assert graph_payload["edges"]
