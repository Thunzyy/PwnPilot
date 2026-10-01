from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.command_history import CommandHistory
from app.models.project import Project
from app.models.report import ReportDB, ReportUpdateProposalDB
from app.models.timeline import Timeline
from app.services.base import BaseService
from app.services.graph_service import GraphService
from app.services.report_service import ReportService


@dataclass(slots=True)
class ReportMockSeedResult:
    scenario: str
    report: ReportDB
    accepted_revision_count: int
    pending_proposals: list[ReportUpdateProposalDB]


class ReportMockSeedService(BaseService):
    def __init__(self, db: AsyncSession):
        super().__init__("service.report_mock_seed")
        self.db = db
        self.report_service = ReportService(db)

    async def seed_demo_ctf(self, project: Project, *, user_id: str) -> ReportMockSeedResult:
        report = await self.report_service.ensure_report(project.id, project.name)
        await self.report_service.seed_default_sections(report.id)

        existing_seed = dict(project.variables or {}).get("report_mock_seed")
        if existing_seed and existing_seed.get("scenario") == "demo-ctf":
            return ReportMockSeedResult(
                scenario="demo-ctf",
                report=report,
                accepted_revision_count=report.current_revision,
                pending_proposals=await self._load_pending_proposals(report.id),
            )

        await GraphService(self.db).seed_demo_ctf(project, user_id=user_id)

        accepted_patches, pending_patches = await self._build_profile_patches(
            project_id=project.id,
            profile=report.profile,
        )

        accepted = await self.report_service.create_manual_proposal(
            report_id=report.id,
            section_patches=accepted_patches,
            trigger_type="mock_seed",
        )
        await self.report_service.accept_proposal(
            report_id=report.id,
            proposal_id=accepted.id,
            workspace_path=project.workspace_path,
        )
        pending = await self.report_service.create_manual_proposal(
            report_id=report.id,
            section_patches=pending_patches,
            trigger_type="mock_seed",
        )

        refreshed_report = await self.db.get(ReportDB, report.id)
        variables = dict(project.variables or {})
        variables["report_mock_seed"] = {
            "scenario": "demo-ctf",
            "profile": refreshed_report.profile if refreshed_report else report.profile,
        }
        project.variables = variables
        await self.db.commit()

        return ReportMockSeedResult(
            scenario="demo-ctf",
            report=refreshed_report or report,
            accepted_revision_count=(refreshed_report or report).current_revision,
            pending_proposals=[pending],
        )

    async def _build_profile_patches(
        self,
        *,
        project_id: str,
        profile: str,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        commands = await self._load_commands(project_id)
        timeline = await self._load_timeline(project_id)
        command_map = {
            "nmap": self._find_command(commands, "nmap -sv -pn"),
            "ffuf": self._find_command(commands, "ffuf -u"),
            "jenkins_rce": self._find_command(commands, "jenkins_console_rce.py"),
            "sudo_l": self._find_command(commands, "sudo -l"),
            "backup_runner": self._find_command(commands, "backup-runner"),
            "user_flag": self._find_command(commands, "cat /home/jenkins/user.txt"),
            "root_flag": self._find_command(commands, "cat /root/root.txt"),
            "svc_backup": self._find_command(commands, "svc_backup"),
            "smb_loot": self._find_command(commands, "smbclient //10.10.110.20/forensic"),
        }
        timeline_map = {
            "jenkins": self._find_timeline(timeline, "Jenkins script console"),
            "backup": self._find_timeline(timeline, "backup-runner"),
            "svc": self._find_timeline(timeline, "svc_backup credential"),
            "forensic": self._find_timeline(timeline, "forensic archive"),
        }

        if profile == "htb_writeup":
            return (
                [
                    {
                        "section_key": "overview",
                        "summary": "Seed overview",
                        "content_md": (
                            "WEB01 exposed Jenkins and FILE01 exposed SMB. The seeded attack "
                            "path demonstrates a realistic CTF chain from web enumeration to "
                            "credential reuse and root access."
                        ),
                        "evidence": self._collect_evidence(
                            command_map["nmap"],
                            timeline_map["jenkins"],
                        ),
                    },
                    {
                        "section_key": "enumeration",
                        "summary": "Seed enumeration",
                        "content_md": (
                            "Initial enumeration identified SSH, HTTP, Jenkins, and SMB services. "
                            "Directory fuzzing surfaced `/jenkins` and `/backup`, which narrowed the "
                            "initial access path quickly."
                        ),
                        "evidence": self._collect_evidence(
                            command_map["nmap"],
                            command_map["ffuf"],
                        ),
                    },
                ],
                [
                    {
                        "section_key": "foothold",
                        "summary": "Seed foothold",
                        "content_md": (
                            "Code execution through the Jenkins script console yielded a `www-data` "
                            "shell on WEB01, establishing the first interactive foothold."
                        ),
                        "evidence": self._collect_evidence(
                            command_map["jenkins_rce"],
                            timeline_map["jenkins"],
                        ),
                    },
                    {
                        "section_key": "privilege_escalation",
                        "summary": "Seed privesc",
                        "content_md": (
                            "The `www-data` context could run `backup-runner` with sudo. That path "
                            "was turned into a root shell by dropping a SUID bash payload through the "
                            "trusted script execution flow."
                        ),
                        "evidence": self._collect_evidence(
                            command_map["sudo_l"],
                            command_map["backup_runner"],
                            timeline_map["backup"],
                        ),
                    },
                    {
                        "section_key": "flags_evidence",
                        "summary": "Seed flags and loot",
                        "content_md": (
                            "Both user and root flags were recovered after escalation. The same host "
                            "also leaked `svc_backup`, which enabled access to FILE01 shares and the "
                            "collection of the forensic archive."
                        ),
                        "evidence": self._collect_evidence(
                            command_map["user_flag"],
                            command_map["root_flag"],
                            command_map["svc_backup"],
                            command_map["smb_loot"],
                            timeline_map["svc"],
                            timeline_map["forensic"],
                        ),
                    },
                ],
            )

        if profile == "pentest_report":
            return (
                [
                    {
                        "section_key": "executive_summary",
                        "summary": "Seed executive summary",
                        "content_md": (
                            "A chained compromise was demonstrated from exposed web administration "
                            "through local privilege escalation, followed by credential reuse against "
                            "a second internal system."
                        ),
                        "evidence": self._collect_evidence(
                            command_map["nmap"],
                            command_map["jenkins_rce"],
                        ),
                    },
                    {
                        "section_key": "scope_methodology",
                        "summary": "Seed scope and methodology",
                        "content_md": (
                            "Testing covered service discovery, web enumeration, exploitation of the "
                            "Jenkins administration surface, local privilege escalation, and SMB "
                            "credential validation on FILE01."
                        ),
                        "evidence": self._collect_evidence(
                            command_map["nmap"],
                            command_map["ffuf"],
                            command_map["smb_loot"],
                        ),
                    },
                ],
                [
                    {
                        "section_key": "findings",
                        "summary": "Seed findings",
                        "content_md": (
                            "Findings include exposed Jenkins administrative functionality, a sudo "
                            "misconfiguration enabling `backup-runner` abuse, and credential material "
                            "stored on disk that was reusable over SMB."
                        ),
                        "evidence": self._collect_evidence(
                            command_map["jenkins_rce"],
                            command_map["sudo_l"],
                            command_map["svc_backup"],
                        ),
                    },
                    {
                        "section_key": "recommendations",
                        "summary": "Seed recommendations",
                        "content_md": (
                            "Restrict Jenkins administrative access, remove unnecessary sudo rights "
                            "from service accounts, and rotate credentials recovered from host-side "
                            "notes or backup material."
                        ),
                        "evidence": self._collect_evidence(
                            timeline_map["backup"],
                            timeline_map["svc"],
                        ),
                    },
                    {
                        "section_key": "appendix_evidence",
                        "summary": "Seed appendix",
                        "content_md": (
                            "Evidence packages include shell execution traces, recovered flag reads, "
                            "and file share enumeration showing access to the forensic archive."
                        ),
                        "evidence": self._collect_evidence(
                            command_map["user_flag"],
                            command_map["root_flag"],
                            command_map["smb_loot"],
                            timeline_map["forensic"],
                        ),
                    },
                ],
            )

        return (
            [
                {
                    "section_key": "recon",
                    "summary": "Seed recon",
                    "content_md": (
                        "Service discovery identified WEB01 and FILE01. Jenkins and backup-related "
                        "content stood out early and shaped the rest of the attack path."
                    ),
                    "evidence": self._collect_evidence(
                        command_map["nmap"],
                        command_map["ffuf"],
                    ),
                },
            ],
            [
                {
                    "section_key": "initial_access",
                    "summary": "Seed initial access",
                    "content_md": (
                        "Remote command execution through Jenkins produced an interactive `www-data` "
                        "foothold on WEB01."
                    ),
                    "evidence": self._collect_evidence(
                        command_map["jenkins_rce"],
                        timeline_map["jenkins"],
                    ),
                },
                {
                    "section_key": "privilege_escalation",
                    "summary": "Seed privesc",
                    "content_md": (
                        "Privilege escalation succeeded by abusing `backup-runner` via sudo and "
                        "turning the script execution path into a root shell."
                    ),
                    "evidence": self._collect_evidence(
                        command_map["sudo_l"],
                        command_map["backup_runner"],
                    ),
                },
                {
                    "section_key": "loot_evidence",
                    "summary": "Seed loot",
                    "content_md": (
                        "User and root flags were collected, and the recovered `svc_backup` "
                        "credential unlocked FILE01 forensic material over SMB."
                    ),
                    "evidence": self._collect_evidence(
                        command_map["user_flag"],
                        command_map["root_flag"],
                        command_map["svc_backup"],
                        command_map["smb_loot"],
                    ),
                },
            ],
        )

    async def _load_commands(self, project_id: str) -> list[CommandHistory]:
        return list(
            (
                await self.db.execute(
                    select(CommandHistory)
                    .where(CommandHistory.project_id == project_id)
                    .order_by(CommandHistory.created_at.asc())
                )
            ).scalars().all()
        )

    async def _load_timeline(self, project_id: str) -> list[Timeline]:
        return list(
            (
                await self.db.execute(
                    select(Timeline)
                    .where(Timeline.project_id == project_id)
                    .order_by(Timeline.created_at.asc())
                )
            ).scalars().all()
        )

    async def _load_pending_proposals(self, report_id: str) -> list[ReportUpdateProposalDB]:
        return list(
            (
                await self.db.execute(
                    select(ReportUpdateProposalDB)
                    .where(
                        ReportUpdateProposalDB.report_id == report_id,
                        ReportUpdateProposalDB.status == "pending",
                    )
                    .order_by(ReportUpdateProposalDB.created_at.asc())
                )
            ).scalars().all()
        )

    def _find_command(
        self,
        commands: list[CommandHistory],
        needle: str,
    ) -> CommandHistory | None:
        lowered = needle.lower()
        return next((item for item in commands if lowered in item.command.lower()), None)

    def _find_timeline(
        self,
        timeline: list[Timeline],
        needle: str,
    ) -> Timeline | None:
        lowered = needle.lower()
        return next((item for item in timeline if lowered in item.content.lower()), None)

    def _collect_evidence(self, *items: CommandHistory | Timeline | None) -> list[dict[str, str]]:
        evidence: list[dict[str, str]] = []
        for item in items:
            if item is None:
                continue
            source_type = "timeline" if isinstance(item, Timeline) else "command_history"
            evidence.append(
                {
                    "source_type": source_type,
                    "source_id": item.id,
                }
            )
        return evidence
