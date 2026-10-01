import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.project import Project
from app.models.report import (
    ReportDB,
    ReportEvidenceLinkDB,
    ReportEvaluationTaskDB,
    ReportSectionDB,
    ReportUpdateProposalDB,
    ReportUpdateSectionPatchDB,
)
from app.models.user import User


@pytest.mark.anyio
async def test_report_models_persist_sections_proposals_and_evidence(test_db: AsyncSession):
    report = ReportDB(project_id="project-1", title="HTB Cap Report", profile="htb_writeup")
    test_db.add(report)
    await test_db.flush()

    section = ReportSectionDB(
        report_id=report.id,
        key="recon",
        title="Recon",
        content_md="Initial recon draft",
        position=0,
    )
    proposal = ReportUpdateProposalDB(
        report_id=report.id,
        trigger_type="event",
        status="pending",
        summary="Add foothold details",
    )
    test_db.add_all([section, proposal])
    await test_db.flush()

    patch = ReportUpdateSectionPatchDB(
        proposal_id=proposal.id,
        section_key="recon",
        content_md="Updated recon details",
        summary="Expanded recon section",
    )
    evidence_links = [
        ReportEvidenceLinkDB(
            proposal_id=proposal.id,
            source_type=source_type,
            source_id=f"{source_type}-1",
        )
        for source_type in ("command_history", "timeline", "graph_node", "graph_edge")
    ]
    test_db.add(patch)
    test_db.add_all(evidence_links)
    await test_db.commit()

    fetched = (
        await test_db.execute(
            select(ReportUpdateProposalDB)
            .options(
                selectinload(ReportUpdateProposalDB.evidence_links),
                selectinload(ReportUpdateProposalDB.section_patches),
            )
            .where(ReportUpdateProposalDB.id == proposal.id)
        )
    ).scalar_one()

    assert report.id is not None
    assert report.profile == "htb_writeup"
    assert patch.id is not None
    assert fetched.status == "pending"
    assert fetched.trigger_type == "event"
    assert fetched.summary == "Add foothold details"
    assert {link.source_type for link in fetched.evidence_links} == {
        "command_history",
        "timeline",
        "graph_node",
        "graph_edge",
    }
    assert fetched.section_patches[0].section_key == "recon"


@pytest.mark.anyio
async def test_report_sections_require_unique_keys_per_report(test_db: AsyncSession):
    report = ReportDB(project_id="project-2", title="Report")
    test_db.add(report)
    await test_db.flush()

    test_db.add_all(
        [
            ReportSectionDB(
                report_id=report.id,
                key="privilege_escalation",
                title="Privilege Escalation",
                content_md="First",
                position=0,
            ),
            ReportSectionDB(
                report_id=report.id,
                key="privilege_escalation",
                title="Privilege Escalation",
                content_md="Duplicate",
                position=1,
            ),
        ]
    )

    with pytest.raises(IntegrityError):
        await test_db.commit()


@pytest.mark.anyio
async def test_report_evaluation_tasks_persist_status_and_optional_proposal(
    test_db: AsyncSession,
):
    user = User(
        id="user-3",
        username="user3",
        email="user3@example.com",
        password_hash="hash",
    )
    project = Project(
        id="project-3",
        name="Cap",
        slug="cap-project-3",
        type="htb",
        workspace_path="/tmp/project-3",
    )
    report = ReportDB(project_id="project-3", title="Report")
    proposal = ReportUpdateProposalDB(
        report=report,
        trigger_type="manual",
        status="pending",
        summary="Proposal",
    )
    task = ReportEvaluationTaskDB(
        project_id="project-3",
        user_id="user-3",
        trigger_type="manual",
        target_section_keys=["privilege_escalation"],
        status="completed",
        proposal=proposal,
        error=None,
    )
    test_db.add_all([user, project, report, proposal, task])
    await test_db.commit()

    fetched = (
        await test_db.execute(
            select(ReportEvaluationTaskDB).where(ReportEvaluationTaskDB.id == task.id)
        )
    ).scalar_one()

    assert fetched.project_id == "project-3"
    assert fetched.user_id == "user-3"
    assert fetched.status == "completed"
    assert fetched.proposal_id == proposal.id
    assert fetched.target_section_keys == ["privilege_escalation"]
    assert fetched.lease_version == 0
    assert fetched.lease_expires_at is None
    assert fetched.heartbeat_at is None
