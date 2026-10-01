from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.command_history import CommandHistory
from app.models.project import Project
from app.models.report import ReportEvidenceLinkDB, ReportSectionDB, ReportUpdateProposalDB
from app.models.terminal_session import TerminalSessionDB
from app.models.timeline import Timeline
from app.models.user import User
from app.services.report_service import DEFAULT_REPORT_SECTIONS, ReportService


async def _create_project(
    test_db: AsyncSession,
    tmp_path: Path,
    project_id: str = "project-1",
    project_type: str = "custom",
) -> Project:
    workspace_path = tmp_path / project_id
    workspace_path.mkdir(parents=True, exist_ok=True)
    project = Project(
        id=project_id,
        name="Cap",
        slug=f"cap-{project_id}",
        type=project_type,
        workspace_path=str(workspace_path),
    )
    test_db.add(project)
    await test_db.commit()
    await test_db.refresh(project)
    return project


@pytest.mark.anyio
async def test_seed_default_sections_uses_htb_profile_for_htb_projects(
    test_db: AsyncSession,
    tmp_path: Path,
):
    project = await _create_project(
        test_db,
        tmp_path,
        project_id="project-htb",
        project_type="htb",
    )
    service = ReportService(test_db)

    report = await service.ensure_report(project_id=project.id, title="Cap")
    await service.seed_default_sections(report.id)

    result = await test_db.execute(
        select(ReportSectionDB)
        .where(ReportSectionDB.report_id == report.id)
        .order_by(ReportSectionDB.position.asc())
    )
    sections = result.scalars().all()

    assert report.profile == "htb_writeup"
    assert [section.key for section in sections] == [
        "overview",
        "attack_path",
        "enumeration",
        "foothold",
        "privilege_escalation",
        "flags_evidence",
        "command_timeline",
    ]
    assert [section.title for section in sections] == [
        "Overview",
        "Attack Path",
        "Enumeration",
        "Foothold",
        "Privilege Escalation",
        "Flags / Evidence",
        "Command Timeline",
    ]


@pytest.mark.anyio
async def test_seed_default_sections_keeps_hybrid_profile_for_custom_projects(
    test_db: AsyncSession,
    tmp_path: Path,
):
    project = await _create_project(
        test_db,
        tmp_path,
        project_id="project-custom",
        project_type="custom",
    )
    service = ReportService(test_db)

    report = await service.ensure_report(project_id=project.id, title="Cap")
    await service.seed_default_sections(report.id)

    result = await test_db.execute(
        select(ReportSectionDB)
        .where(ReportSectionDB.report_id == report.id)
        .order_by(ReportSectionDB.position.asc())
    )
    sections = result.scalars().all()

    assert report.profile == "hybrid"
    assert [section.key for section in sections] == [item["key"] for item in DEFAULT_REPORT_SECTIONS]
    assert [section.title for section in sections] == [item["title"] for item in DEFAULT_REPORT_SECTIONS]


@pytest.mark.anyio
async def test_seed_default_sections_reorders_existing_htb_sections_to_profile_positions(
    test_db: AsyncSession,
    tmp_path: Path,
):
    project = await _create_project(
        test_db,
        tmp_path,
        project_id="project-htb-reseed",
        project_type="htb",
    )
    service = ReportService(test_db)

    report = await service.ensure_report(project_id=project.id, title="Cap")
    await service.seed_default_sections(report.id)

    sections = (
        await test_db.execute(
            select(ReportSectionDB)
            .where(ReportSectionDB.report_id == report.id)
            .order_by(ReportSectionDB.position.asc(), ReportSectionDB.id.asc())
        )
    ).scalars().all()
    for section in sections:
        if section.key == "overview":
            continue
        section.position = max(0, section.position - 1)
    await test_db.commit()

    await service.seed_default_sections(report.id)

    reseeded = (
        await test_db.execute(
            select(ReportSectionDB)
            .where(ReportSectionDB.report_id == report.id)
            .order_by(ReportSectionDB.position.asc(), ReportSectionDB.id.asc())
        )
    ).scalars().all()

    assert [section.key for section in reseeded] == [
        "overview",
        "attack_path",
        "enumeration",
        "foothold",
        "privilege_escalation",
        "flags_evidence",
        "command_timeline",
    ]
    assert [section.position for section in reseeded] == list(range(len(reseeded)))


@pytest.mark.anyio
async def test_accepting_proposal_updates_only_target_section_and_syncs_markdown(
    test_db: AsyncSession,
    tmp_path: Path,
):
    project = await _create_project(test_db, tmp_path, project_id="project-2")
    service = ReportService(test_db)

    report = await service.ensure_report(project_id=project.id, title="Cap")
    await service.seed_default_sections(report.id)
    proposal = await service.create_manual_proposal(
        report_id=report.id,
        section_patches=[
            {
                "section_key": "initial_access",
                "content_md": "Updated foothold section",
                "summary": "Add credential reuse details",
            }
        ],
    )

    await service.accept_proposal(
        report_id=report.id,
        proposal_id=proposal.id,
        workspace_path=project.workspace_path,
    )
    rendered = await service.render_report_markdown(report_id=report.id)

    sections = (
        await test_db.execute(
            select(ReportSectionDB)
            .where(ReportSectionDB.report_id == report.id)
            .order_by(ReportSectionDB.position.asc())
        )
    ).scalars().all()
    stored_proposal = await test_db.get(ReportUpdateProposalDB, proposal.id)
    report_path = Path(project.workspace_path) / "report.md"

    assert stored_proposal is not None
    assert stored_proposal.status == "accepted"
    assert "Updated foothold section" in rendered
    assert "## Privilege Escalation" in rendered
    assert sections[1].content_md == "Updated foothold section"
    assert sections[2].content_md == ""
    assert report_path.read_text() == rendered


@pytest.mark.anyio
async def test_create_manual_proposal_persists_patch_evidence_links(
    test_db: AsyncSession,
    tmp_path: Path,
):
    project = await _create_project(test_db, tmp_path, project_id="project-evidence")
    user = User(
        id="user-evidence",
        username="user-evidence",
        email="user-evidence@example.com",
        password_hash="hash",
    )
    session = TerminalSessionDB(
        id="session-evidence",
        project_id=project.id,
        name="Recon",
        master_token="master-token",
        viewer_token="viewer-token",
        is_alive=True,
    )
    command = CommandHistory(
        id="cmd-evidence",
        project_id=project.id,
        session_id=session.id,
        command="nmap -sV 10.10.10.10",
        output="80/tcp open http",
        output_preview="80/tcp open http",
        exit_code=0,
        cwd="/tmp",
        duration_ms=25,
        executed_by=user.id,
    )
    finding = Timeline(
        id="timeline-evidence",
        project_id=project.id,
        type="finding",
        content="Export endpoint leaked credentials.",
    )
    test_db.add_all([user, session, command, finding])
    await test_db.commit()

    service = ReportService(test_db)
    report = await service.ensure_report(project_id=project.id, title="Cap")
    await service.seed_default_sections(report.id)

    proposal = await service.create_manual_proposal(
        report_id=report.id,
        section_patches=[
            {
                "section_key": "recon",
                "content_md": "Captured the initial recon evidence.",
                "summary": "Add recon evidence",
                "evidence": [
                    {"source_type": "command_history", "source_id": command.id},
                    {"source_type": "timeline", "source_id": finding.id},
                ],
            }
        ],
    )

    evidence_links = (
        await test_db.execute(
            select(ReportEvidenceLinkDB)
            .where(ReportEvidenceLinkDB.proposal_id == proposal.id)
            .order_by(ReportEvidenceLinkDB.created_at.asc(), ReportEvidenceLinkDB.id.asc())
        )
    ).scalars().all()

    assert len(evidence_links) == 2
    assert {link.source_type for link in evidence_links} == {"command_history", "timeline"}
    assert {link.source_id for link in evidence_links} == {command.id, finding.id}
    assert all(link.patch_id for link in evidence_links)


@pytest.mark.anyio
async def test_reject_proposal_marks_it_rejected_without_changing_sections(
    test_db: AsyncSession,
    tmp_path: Path,
):
    project = await _create_project(test_db, tmp_path, project_id="project-3")
    service = ReportService(test_db)

    report = await service.ensure_report(project_id=project.id, title="Cap")
    await service.seed_default_sections(report.id)
    proposal = await service.create_manual_proposal(
        report_id=report.id,
        section_patches=[
            {
                "section_key": "recon",
                "content_md": "Recon update that should not land",
                "summary": "Pending recon update",
            }
        ],
    )

    await service.reject_proposal(report_id=report.id, proposal_id=proposal.id)

    stored_proposal = await test_db.get(ReportUpdateProposalDB, proposal.id)
    sections = (
        await test_db.execute(
            select(ReportSectionDB)
            .where(ReportSectionDB.report_id == report.id)
            .order_by(ReportSectionDB.position.asc())
        )
    ).scalars().all()

    assert stored_proposal is not None
    assert stored_proposal.status == "rejected"
    assert sections[0].content_md == ""
