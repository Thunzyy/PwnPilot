from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.models.report import (
    ReportDB,
    ReportEvidenceLinkDB,
    ReportSectionDB,
    ReportUpdateProposalDB,
    ReportUpdateSectionPatchDB,
)
from app.services.base import BaseService

DEFAULT_REPORT_SECTIONS: tuple[dict[str, str | int], ...] = (
    {"key": "recon", "title": "Recon", "position": 0},
    {"key": "initial_access", "title": "Initial Access", "position": 1},
    {"key": "privilege_escalation", "title": "Privilege Escalation", "position": 2},
    {"key": "loot_evidence", "title": "Loot / Evidence", "position": 3},
)

HTB_WRITEUP_REPORT_SECTIONS: tuple[dict[str, str | int], ...] = (
    {"key": "overview", "title": "Overview", "position": 0},
    {"key": "attack_path", "title": "Attack Path", "position": 1},
    {"key": "enumeration", "title": "Enumeration", "position": 2},
    {"key": "foothold", "title": "Foothold", "position": 3},
    {"key": "privilege_escalation", "title": "Privilege Escalation", "position": 4},
    {"key": "flags_evidence", "title": "Flags / Evidence", "position": 5},
    {"key": "command_timeline", "title": "Command Timeline", "position": 6},
)

PENTEST_REPORT_SECTIONS: tuple[dict[str, str | int], ...] = (
    {"key": "executive_summary", "title": "Executive Summary", "position": 0},
    {"key": "scope_methodology", "title": "Scope / Methodology", "position": 1},
    {"key": "findings", "title": "Findings", "position": 2},
    {"key": "recommendations", "title": "Recommendations", "position": 3},
    {"key": "appendix_evidence", "title": "Appendix / Evidence", "position": 4},
)

REPORT_SECTIONS_BY_PROFILE: dict[str, tuple[dict[str, str | int], ...]] = {
    "hybrid": DEFAULT_REPORT_SECTIONS,
    "htb_writeup": HTB_WRITEUP_REPORT_SECTIONS,
    "pentest_report": PENTEST_REPORT_SECTIONS,
}

PROJECT_TYPE_TO_REPORT_PROFILE: dict[str, str] = {
    "htb": "htb_writeup",
    "thm": "htb_writeup",
    "ctf": "htb_writeup",
    "real": "pentest_report",
}

_TEMPLATE_ENV = Environment(
    loader=FileSystemLoader(str(Path(__file__).resolve().parent.parent / "templates")),
    autoescape=select_autoescape(default_for_string=False, disabled_extensions=("j2",)),
    trim_blocks=True,
    lstrip_blocks=True,
)


def utc_now() -> datetime:
    return datetime.now(UTC)


class ReportService(BaseService):
    def __init__(self, db: AsyncSession):
        super().__init__("service.report")
        self.db = db

    async def ensure_report(self, project_id: str, title: str) -> ReportDB:
        result = await self.db.execute(
            select(ReportDB).where(ReportDB.project_id == project_id)
        )
        report = result.scalar_one_or_none()
        if report is not None:
            return report

        project = await self.db.get(Project, project_id)
        report = ReportDB(
            project_id=project_id,
            title=title,
            profile=infer_report_profile(project.type if project else None),
        )
        self.db.add(report)
        await self.db.commit()
        await self.db.refresh(report)
        return report

    async def seed_default_sections(self, report_id: str) -> list[ReportSectionDB]:
        report = await self._get_report(report_id)
        result = await self.db.execute(
            select(ReportSectionDB).where(ReportSectionDB.report_id == report_id)
        )
        existing_sections = {section.key: section for section in result.scalars().all()}

        for item in sections_for_profile(report.profile):
            key = str(item["key"])
            if key in existing_sections:
                section = existing_sections[key]
                section.title = str(item["title"])
                section.position = int(item["position"])
                continue
            section = ReportSectionDB(
                report_id=report_id,
                key=key,
                title=str(item["title"]),
                content_md="",
                position=int(item["position"]),
            )
            self.db.add(section)
            existing_sections[key] = section

        await self.db.commit()
        refreshed = await self.db.execute(
            select(ReportSectionDB)
            .where(ReportSectionDB.report_id == report_id)
            .order_by(ReportSectionDB.position.asc())
        )
        return list(refreshed.scalars().all())

    async def render_report_markdown(self, report_id: str) -> str:
        report = await self._get_report(report_id)
        sections = await self._get_sections(report_id)
        template = _TEMPLATE_ENV.get_template("report.md.j2")
        return template.render(report=report, sections=sections).strip() + "\n"

    async def create_manual_proposal(
        self,
        report_id: str,
        section_patches: list[dict[str, object]],
        trigger_type: str = "manual",
    ) -> ReportUpdateProposalDB:
        proposal = ReportUpdateProposalDB(
            report_id=report_id,
            trigger_type=trigger_type,
            status="pending",
            summary="; ".join(
                patch.get("summary", patch["section_key"]) for patch in section_patches
            ),
        )
        self.db.add(proposal)
        await self.db.flush()

        for patch in section_patches:
            section_patch = ReportUpdateSectionPatchDB(
                proposal_id=proposal.id,
                section_key=str(patch["section_key"]),
                content_md=str(patch["content_md"]),
                summary=str(patch["summary"]) if patch.get("summary") is not None else None,
            )
            self.db.add(section_patch)
            await self.db.flush()

            for evidence in patch.get("evidence", []):
                if not isinstance(evidence, dict):
                    continue
                source_type = evidence.get("source_type")
                source_id = evidence.get("source_id")
                if not source_type or not source_id:
                    continue
                self.db.add(
                    ReportEvidenceLinkDB(
                        proposal_id=proposal.id,
                        patch_id=section_patch.id,
                        source_type=str(source_type),
                        source_id=str(source_id),
                    )
                )

        await self.db.commit()
        await self.db.refresh(proposal)
        return proposal

    async def accept_proposal(
        self,
        report_id: str,
        proposal_id: str,
        workspace_path: str,
    ) -> ReportUpdateProposalDB:
        report = await self._get_report(report_id)
        proposal = await self._get_proposal(report_id, proposal_id)
        patches = await self._get_section_patches(proposal.id)
        sections = {section.key: section for section in await self._get_sections(report_id)}

        for patch in patches:
            section = sections.get(patch.section_key)
            if section is None:
                continue
            section.content_md = patch.content_md
            section.updated_at = utc_now()

        proposal.status = "accepted"
        proposal.resolved_at = utc_now()
        proposal.updated_at = utc_now()
        report.current_revision += 1
        report.last_accepted_at = utc_now()

        report_path = Path(workspace_path) / "report.md"
        report.markdown_path = str(report_path)

        await self.db.commit()

        rendered = await self.render_report_markdown(report_id)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(rendered)
        return proposal

    async def reject_proposal(self, report_id: str, proposal_id: str) -> ReportUpdateProposalDB:
        proposal = await self._get_proposal(report_id, proposal_id)
        proposal.status = "rejected"
        proposal.resolved_at = utc_now()
        proposal.updated_at = utc_now()
        await self.db.commit()
        await self.db.refresh(proposal)
        return proposal

    async def _get_report(self, report_id: str) -> ReportDB:
        report = await self.db.get(ReportDB, report_id)
        if report is None:
            raise ValueError(f"Report not found: {report_id}")
        return report

    async def _get_sections(self, report_id: str) -> list[ReportSectionDB]:
        result = await self.db.execute(
            select(ReportSectionDB)
            .where(ReportSectionDB.report_id == report_id)
            .order_by(ReportSectionDB.position.asc())
        )
        return list(result.scalars().all())

    async def _get_proposal(self, report_id: str, proposal_id: str) -> ReportUpdateProposalDB:
        result = await self.db.execute(
            select(ReportUpdateProposalDB).where(
                ReportUpdateProposalDB.id == proposal_id,
                ReportUpdateProposalDB.report_id == report_id,
            )
        )
        proposal = result.scalar_one_or_none()
        if proposal is None:
            raise ValueError(f"Proposal not found: {proposal_id}")
        return proposal

    async def _get_section_patches(self, proposal_id: str) -> list[ReportUpdateSectionPatchDB]:
        result = await self.db.execute(
            select(ReportUpdateSectionPatchDB)
            .where(ReportUpdateSectionPatchDB.proposal_id == proposal_id)
            .order_by(ReportUpdateSectionPatchDB.created_at.asc())
        )
        return list(result.scalars().all())


def infer_report_profile(project_type: str | None) -> str:
    if not project_type:
        return "hybrid"
    return PROJECT_TYPE_TO_REPORT_PROFILE.get(project_type, "hybrid")


def sections_for_profile(profile: str | None) -> tuple[dict[str, str | int], ...]:
    if not profile:
        return DEFAULT_REPORT_SECTIONS
    return REPORT_SECTIONS_BY_PROFILE.get(profile, DEFAULT_REPORT_SECTIONS)
