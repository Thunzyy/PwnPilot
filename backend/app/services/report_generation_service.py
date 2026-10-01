from __future__ import annotations

import json
import subprocess
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.command_history import CommandHistory
from app.models.credential import Credential, Flag
from app.models.graph import GraphEdgeDB, GraphNodeDB
from app.models.project import Project
from app.models.report import (
    ReportDB,
    ReportEvidenceLinkDB,
    ReportSectionDB,
    ReportUpdateProposalDB,
    ReportUpdateSectionPatchDB,
)
from app.models.timeline import Timeline
from app.services.base import BaseService
from app.services.cli_detector import get_known_cli_profile, get_recommended_cli_timeout
from app.services.context_builder import ContextBuilder
from app.services.llm.cli_provider import CLIProvider
from app.services.llm_service import LLMService
from app.services.report_service import ReportService


def utc_now() -> datetime:
    return datetime.now(UTC)


class ReportGenerationService(BaseService):
    _REPORTING_RETRY_ATTEMPTS = 2
    _REPORTING_CLI_TIMEOUT_FLOOR_SECONDS = 120
    _REPORTING_COMMAND_OUTPUT_MAX_LINES = 8
    _REPORTING_COMMAND_OUTPUT_MAX_CHARS = 400

    def __init__(self, db: AsyncSession):
        super().__init__("service.report_generation")
        self.db = db
        self.report_service = ReportService(db)

    async def build_delta_evidence_pack(self, project_id: str, report_id: str) -> dict:
        report = await self.db.get(ReportDB, report_id)
        if report is None:
            raise ValueError(f"Report not found: {report_id}")

        cutoff = report.last_accepted_at
        commands = await self._load_commands(project_id, cutoff)
        timeline = await self._load_timeline(project_id, cutoff)
        findings = [entry for entry in timeline if entry.type == "finding"]
        credentials = await self._load_credentials(project_id, cutoff)
        flags = await self._load_flags(project_id, cutoff)
        graph_nodes = await self._load_graph_nodes(project_id, cutoff)
        graph_edges = await self._load_graph_edges(project_id, cutoff)
        sections = await self._load_report_sections(report_id)
        reporting_context = await ContextBuilder(self.db).build(project_id, preset="reporting")

        return {
            "report_id": report.id,
            "project_id": project_id,
            "last_accepted_at": cutoff.isoformat() if cutoff else None,
            "commands": [self._serialize_command(item) for item in commands],
            "timeline": [self._serialize_timeline(item) for item in timeline],
            "findings": [self._serialize_timeline(item) for item in findings],
            "credentials": [self._serialize_credential(item) for item in credentials],
            "flags": [self._serialize_flag(item) for item in flags],
            "graph_nodes": [self._serialize_graph_node(item) for item in graph_nodes],
            "graph_edges": [self._serialize_graph_edge(item) for item in graph_edges],
            "report_sections": [self._serialize_report_section(item) for item in sections],
            "reporting_context": reporting_context,
        }

    async def generate_update_proposal(
        self,
        project_id: str,
        user_id: str,
        trigger_type: str,
        target_section_keys: list[str] | None = None,
    ) -> ReportUpdateProposalDB | None:
        project = await self.db.get(Project, project_id)
        if project is None:
            raise ValueError(f"Project not found: {project_id}")

        report = await self.report_service.ensure_report(project_id=project_id, title=project.name)
        await self.report_service.seed_default_sections(report.id)
        normalized_target_section_keys = self._normalize_target_section_keys(target_section_keys)
        delta_pack = await self.build_delta_evidence_pack(project_id, report.id)
        if normalized_target_section_keys is not None:
            delta_pack["target_section_keys"] = normalized_target_section_keys
            delta_pack["report_sections"] = [
                section
                for section in delta_pack["report_sections"]
                if section["key"] in normalized_target_section_keys
            ]

        if not any(delta_pack[key] for key in ("commands", "timeline", "credentials", "flags", "graph_nodes", "graph_edges")):
            report.last_evaluated_at = utc_now()
            await self.db.commit()
            return None

        judge_result = await self._call_reporting_json(
            user_id=user_id,
            project_id=project_id,
            system_prompt=(
                "You evaluate whether new offensive security evidence warrants a write-up update. "
                'Return JSON with keys: decision ("no_update" or "update"), summary, sections.'
            ),
            user_prompt=self._dump_reporting_json(delta_pack),
            max_tokens=400,
        )
        report.last_evaluated_at = utc_now()

        if judge_result.get("decision") != "update":
            await self.db.commit()
            return None

        allowed_section_keys = normalized_target_section_keys or self._normalize_target_section_keys(
            judge_result.get("sections")
        )
        writer_sections = self._filter_sections(
            self._normalize_section_payloads(judge_result.get("sections")),
            allowed_section_keys,
        )
        writer_summary = judge_result.get("summary")
        if not any(section.get("content_md") for section in writer_sections):
            writer_result = await self._call_reporting_json(
                user_id=user_id,
                project_id=project_id,
                system_prompt=(
                    "You draft incremental offensive security report updates. "
                    "Return JSON with keys: summary and sections. "
                    "Each section item must contain: section_key, content_md, summary, evidence."
                ),
                user_prompt=json.dumps(
                    {
                        "delta_pack": delta_pack,
                        "judge_result": judge_result,
                    },
                    separators=(",", ":"),
                    sort_keys=True,
                ),
                max_tokens=1200,
            )
            writer_sections = self._filter_sections(
                self._normalize_section_payloads(writer_result.get("sections", [])),
                allowed_section_keys,
            )
            writer_summary = writer_result.get("summary") or writer_summary
        if not writer_sections:
            await self.db.commit()
            return None

        existing = await self._find_matching_pending_proposal(
            report_id=report.id,
            summary=writer_summary,
            sections=writer_sections,
        )
        if existing is not None:
            await self.db.commit()
            return existing

        proposal = ReportUpdateProposalDB(
            report_id=report.id,
            trigger_type=trigger_type,
            status="pending",
            summary=writer_summary,
        )
        self.db.add(proposal)
        await self.db.flush()

        for section in writer_sections:
            patch = ReportUpdateSectionPatchDB(
                proposal_id=proposal.id,
                section_key=section["section_key"],
                content_md=section["content_md"],
                summary=section.get("summary"),
            )
            self.db.add(patch)
            await self.db.flush()

            for evidence in self._normalize_evidence(section.get("evidence", [])):
                self.db.add(
                    ReportEvidenceLinkDB(
                        proposal_id=proposal.id,
                        patch_id=patch.id,
                        source_type=evidence["source_type"],
                        source_id=evidence["source_id"],
                    )
                )

        await self.db.commit()
        await self.db.refresh(proposal)
        return proposal

    @classmethod
    def _normalize_target_section_keys(
        cls,
        section_keys: list[str | dict[str, Any]] | tuple[str | dict[str, Any], ...] | None,
    ) -> list[str] | None:
        if not section_keys:
            return None

        normalized = sorted(
            {
                key
                for item in section_keys
                if (key := cls._coerce_section_key(item)) is not None
            }
        )
        return normalized or None

    @staticmethod
    def _coerce_section_key(item: str | dict[str, Any] | None) -> str | None:
        if isinstance(item, str):
            normalized = item.strip()
            return normalized or None
        if isinstance(item, dict):
            for field in ("section_key", "key"):
                value = item.get(field)
                if isinstance(value, str):
                    normalized = value.strip()
                    if normalized:
                        return normalized
        return None

    @classmethod
    def _filter_sections(
        cls,
        sections: list[dict] | None,
        allowed_section_keys: list[str] | None,
    ) -> list[dict]:
        if not sections:
            return []
        if not allowed_section_keys:
            return list(sections)
        allowed = set(cls._normalize_target_section_keys(allowed_section_keys) or [])
        return [
            section
            for section in sections
            if str(section.get("section_key", "")).strip() in allowed
        ]

    @classmethod
    def _normalize_section_payloads(
        cls,
        sections: list[dict[str, Any] | str] | tuple[dict[str, Any] | str, ...] | None,
    ) -> list[dict[str, Any]]:
        if not sections:
            return []

        normalized: list[dict[str, Any]] = []
        for section in sections:
            section_key = cls._coerce_section_key(section)
            if section_key is None:
                continue
            if isinstance(section, str):
                normalized.append(
                    {
                        "section_key": section_key,
                        "content_md": None,
                        "summary": None,
                        "evidence": [],
                    }
                )
                continue

            content_md = section.get("content_md")
            if not isinstance(content_md, str):
                content_md = section.get("content")
            summary = section.get("summary")
            normalized.append(
                {
                    "section_key": section_key,
                    "content_md": content_md if isinstance(content_md, str) else None,
                    "summary": summary if isinstance(summary, str) else None,
                    "evidence": cls._normalize_evidence(section.get("evidence", [])),
                }
            )
        return normalized

    @staticmethod
    def _normalize_evidence(evidence: Any) -> list[dict[str, str]]:
        if not isinstance(evidence, list):
            return []

        normalized: list[dict[str, str]] = []
        for item in evidence:
            if not isinstance(item, dict):
                continue
            source_type = item.get("source_type")
            source_id = item.get("source_id")
            if isinstance(source_type, str) and isinstance(source_id, str):
                normalized.append(
                    {
                        "source_type": source_type,
                        "source_id": source_id,
                    }
                )
        return normalized

    async def _call_reporting_json(
        self,
        *,
        user_id: str,
        project_id: str,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int,
    ) -> dict:
        provider = await LLMService(self.db).get_provider_for_context(
            user_id=user_id,
            context_type="reporting",
            project_id=project_id,
        )
        if provider is None:
            raise ValueError("No reporting provider configured")

        last_error: Exception | None = None
        for attempt in range(1, self._REPORTING_RETRY_ATTEMPTS + 1):
            try:
                payload = await self._collect_reporting_payload(
                    provider=provider,
                    system_prompt=system_prompt,
                    user_prompt=user_prompt,
                    max_tokens=max_tokens,
                )
                return self._parse_reporting_payload(payload)
            except Exception as exc:
                last_error = exc
                if not self._is_retryable_reporting_error(exc) or attempt >= self._REPORTING_RETRY_ATTEMPTS:
                    raise
        if last_error is not None:
            raise last_error
        raise ValueError("Reporting provider returned no content")

    async def _collect_reporting_payload(
        self,
        *,
        provider: Any,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int,
    ) -> str:
        chunks: list[str] = []
        model_override: str | None = None
        original_timeout: int | None = None
        if isinstance(provider, CLIProvider):
            original_timeout = provider.timeout
            provider.timeout = max(
                provider.timeout,
                get_recommended_cli_timeout(
                    provider.cli_command,
                    self._REPORTING_CLI_TIMEOUT_FLOOR_SECONDS,
                ),
                self._REPORTING_CLI_TIMEOUT_FLOOR_SECONDS,
            )
            profile = get_known_cli_profile(provider.cli_command)
            if (
                profile is not None
                and profile.command == "codex"
                and provider.default_model.strip().lower() == "codex-mini-latest"
            ):
                model_override = profile.default_model

        try:
            async for chunk in provider.chat_stream(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                model=model_override,
                temperature=0.1,
                max_tokens=max_tokens,
            ):
                if chunk.content:
                    chunks.append(chunk.content)
        finally:
            if isinstance(provider, CLIProvider) and original_timeout is not None:
                provider.timeout = original_timeout
        payload = "".join(chunks).strip()
        if not payload:
            raise ValueError("Reporting provider returned no content")
        return payload

    @staticmethod
    def _dump_reporting_json(payload: dict[str, Any]) -> str:
        return json.dumps(payload, separators=(",", ":"), sort_keys=True)

    async def _find_matching_pending_proposal(
        self,
        *,
        report_id: str,
        summary: str | None,
        sections: list[dict],
    ) -> ReportUpdateProposalDB | None:
        if not sections:
            return None

        new_signature = self._build_proposal_signature(summary=summary, sections=sections)
        proposals = (
            await self.db.execute(
                select(ReportUpdateProposalDB).where(
                    ReportUpdateProposalDB.report_id == report_id,
                    ReportUpdateProposalDB.status == "pending",
                )
            )
        ).scalars().all()

        for proposal in proposals:
            if await self._proposal_signature(proposal) == new_signature:
                return proposal
        return None

    async def _proposal_signature(
        self,
        proposal: ReportUpdateProposalDB,
    ) -> dict[str, Any]:
        patches = (
            await self.db.execute(
                select(ReportUpdateSectionPatchDB)
                .where(ReportUpdateSectionPatchDB.proposal_id == proposal.id)
                .order_by(ReportUpdateSectionPatchDB.created_at.asc())
            )
        ).scalars().all()
        evidence_links = (
            await self.db.execute(
                select(ReportEvidenceLinkDB)
                .where(ReportEvidenceLinkDB.proposal_id == proposal.id)
                .order_by(ReportEvidenceLinkDB.created_at.asc())
            )
        ).scalars().all()
        evidence_by_patch: dict[str, list[dict[str, str]]] = {}
        for link in evidence_links:
            if not link.patch_id:
                continue
            evidence_by_patch.setdefault(link.patch_id, []).append(
                {
                    "source_type": link.source_type,
                    "source_id": link.source_id,
                }
            )

        return self._build_proposal_signature(
            summary=proposal.summary,
            sections=[
                {
                    "section_key": patch.section_key,
                    "content_md": patch.content_md,
                    "summary": patch.summary,
                    "evidence": evidence_by_patch.get(patch.id, []),
                }
                for patch in patches
            ],
        )

    @staticmethod
    def _build_proposal_signature(
        *,
        summary: str | None,
        sections: list[dict],
    ) -> dict[str, Any]:
        normalized_sections: list[dict[str, Any]] = []
        for section in sections:
            normalized_sections.append(
                {
                    "section_key": section.get("section_key"),
                    "content_md": section.get("content_md"),
                    "summary": section.get("summary"),
                    "evidence": sorted(
                        ReportGenerationService._normalize_evidence(
                            section.get("evidence", [])
                        ),
                        key=lambda item: (item["source_type"] or "", item["source_id"] or ""),
                    ),
                }
            )

        normalized_sections.sort(key=lambda item: item["section_key"] or "")
        return {
            "summary": summary,
            "sections": normalized_sections,
        }

    @staticmethod
    def _parse_reporting_payload(payload: str) -> dict:
        text = payload.strip()
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            fenced = ReportGenerationService._extract_json_from_fence(text)
            if fenced is not None:
                return json.loads(fenced)
            extracted = ReportGenerationService._extract_json_object(text)
            if extracted is None:
                raise
            parsed = json.loads(extracted)

        if not isinstance(parsed, dict):
            raise ValueError("Reporting provider must return a JSON object")
        return parsed

    @staticmethod
    def _extract_json_from_fence(text: str) -> str | None:
        start = text.find("```")
        while start != -1:
            line_end = text.find("\n", start)
            if line_end == -1:
                return None
            body_start = line_end + 1
            end = text.find("```", body_start)
            if end == -1:
                return None
            block = text[body_start:end].strip()
            if block:
                return block
            start = text.find("```", end + 3)
        return None

    @staticmethod
    def _extract_json_object(text: str) -> str | None:
        start = text.find("{")
        while start != -1:
            depth = 0
            in_string = False
            escape = False
            for index in range(start, len(text)):
                char = text[index]
                if in_string:
                    if escape:
                        escape = False
                    elif char == "\\":
                        escape = True
                    elif char == '"':
                        in_string = False
                    continue
                if char == '"':
                    in_string = True
                elif char == "{":
                    depth += 1
                elif char == "}":
                    depth -= 1
                    if depth == 0:
                        return text[start : index + 1]
            start = text.find("{", start + 1)
        return None

    @staticmethod
    def _is_retryable_reporting_error(exc: Exception) -> bool:
        if isinstance(exc, TimeoutError | subprocess.TimeoutExpired):
            return False
        if isinstance(exc, RuntimeError | json.JSONDecodeError):
            return True
        if isinstance(exc, ValueError):
            return str(exc) != "No reporting provider configured"
        return False

    async def _load_commands(
        self, project_id: str, cutoff: datetime | None
    ) -> list[CommandHistory]:
        stmt = select(CommandHistory).where(CommandHistory.project_id == project_id)
        if cutoff is not None:
            stmt = stmt.where(CommandHistory.created_at > cutoff)
        stmt = stmt.order_by(CommandHistory.created_at.asc())
        return list((await self.db.execute(stmt)).scalars().all())

    async def _load_timeline(self, project_id: str, cutoff: datetime | None) -> list[Timeline]:
        stmt = select(Timeline).where(Timeline.project_id == project_id)
        if cutoff is not None:
            stmt = stmt.where(Timeline.created_at > cutoff)
        stmt = stmt.order_by(Timeline.created_at.asc())
        return list((await self.db.execute(stmt)).scalars().all())

    async def _load_credentials(
        self, project_id: str, cutoff: datetime | None
    ) -> list[Credential]:
        stmt = select(Credential).where(Credential.project_id == project_id)
        if cutoff is not None:
            stmt = stmt.where(Credential.created_at > cutoff)
        stmt = stmt.order_by(Credential.created_at.asc())
        return list((await self.db.execute(stmt)).scalars().all())

    async def _load_flags(self, project_id: str, cutoff: datetime | None) -> list[Flag]:
        stmt = select(Flag).where(Flag.project_id == project_id)
        if cutoff is not None:
            stmt = stmt.where(Flag.created_at > cutoff)
        stmt = stmt.order_by(Flag.created_at.asc())
        return list((await self.db.execute(stmt)).scalars().all())

    async def _load_graph_nodes(
        self, project_id: str, cutoff: datetime | None
    ) -> list[GraphNodeDB]:
        stmt = select(GraphNodeDB).where(
            GraphNodeDB.project_id == project_id,
            GraphNodeDB.is_deleted.is_(False),
        )
        if cutoff is not None:
            stmt = stmt.where(GraphNodeDB.created_at > cutoff)
        stmt = stmt.order_by(GraphNodeDB.created_at.asc(), GraphNodeDB.sequence_index.asc())
        return list((await self.db.execute(stmt)).scalars().all())

    async def _load_graph_edges(
        self, project_id: str, cutoff: datetime | None
    ) -> list[GraphEdgeDB]:
        stmt = select(GraphEdgeDB).where(GraphEdgeDB.project_id == project_id)
        if cutoff is not None:
            stmt = stmt.where(GraphEdgeDB.created_at > cutoff)
        stmt = stmt.order_by(GraphEdgeDB.created_at.asc(), GraphEdgeDB.sequence_index.asc())
        return list((await self.db.execute(stmt)).scalars().all())

    async def _load_report_sections(self, report_id: str) -> list[ReportSectionDB]:
        stmt = (
            select(ReportSectionDB)
            .where(ReportSectionDB.report_id == report_id)
            .order_by(ReportSectionDB.position.asc())
        )
        return list((await self.db.execute(stmt)).scalars().all())

    @staticmethod
    def _serialize_command(item: CommandHistory) -> dict:
        return {
            "id": item.id,
            "source_type": "command_history",
            "command": item.command,
            "output": ReportGenerationService._summarize_command_output(
                item.output,
                preview=item.output_preview,
            ),
            "created_at": item.created_at.isoformat(),
        }

    @classmethod
    def _summarize_command_output(
        cls,
        output: str | None,
        *,
        preview: str | None = None,
    ) -> str | None:
        if not output:
            return preview or None

        stripped = output.strip()
        if not stripped:
            return preview or None

        lines = stripped.splitlines()
        excerpt = "\n".join(lines[: cls._REPORTING_COMMAND_OUTPUT_MAX_LINES]).strip()
        if len(excerpt) > cls._REPORTING_COMMAND_OUTPUT_MAX_CHARS:
            excerpt = excerpt[: cls._REPORTING_COMMAND_OUTPUT_MAX_CHARS].rstrip()

        truncated = (
            len(lines) > cls._REPORTING_COMMAND_OUTPUT_MAX_LINES
            or len(stripped) > len(excerpt)
        )
        if truncated:
            tail_line = next((line.strip() for line in reversed(lines) if line.strip()), "")
            preserved_tail = False
            if cls._should_preserve_tail_line(tail_line) and tail_line not in excerpt:
                excerpt = f"{excerpt}\n...\n{tail_line}".strip()
                preserved_tail = True
            if not preserved_tail:
                excerpt = f"{excerpt}..."

        if preview and preview.strip() and preview.strip() not in excerpt:
            preview_text = preview.strip()
            if len(preview_text) > cls._REPORTING_COMMAND_OUTPUT_MAX_CHARS:
                preview_text = preview_text[: cls._REPORTING_COMMAND_OUTPUT_MAX_CHARS].rstrip()
            excerpt = f"{preview_text}\n{excerpt}".strip()

        return excerpt

    @staticmethod
    def _should_preserve_tail_line(tail_line: str) -> bool:
        if not tail_line or " " in tail_line:
            return False
        normalized = tail_line.strip()
        return len(normalized) >= 24 and normalized.replace("-", "").isalnum()

    @staticmethod
    def _serialize_timeline(item: Timeline) -> dict:
        return {
            "id": item.id,
            "source_type": "timeline",
            "type": item.type,
            "content": item.content,
            "created_at": item.created_at.isoformat(),
        }

    @staticmethod
    def _serialize_credential(item: Credential) -> dict:
        return {
            "id": item.id,
            "source_type": "credential",
            "username": item.username,
            "service": item.service,
            "created_at": item.created_at.isoformat(),
        }

    @staticmethod
    def _serialize_flag(item: Flag) -> dict:
        return {
            "id": item.id,
            "source_type": "flag",
            "type": item.type,
            "value": item.value,
            "created_at": item.created_at.isoformat(),
        }

    @staticmethod
    def _serialize_graph_node(item: GraphNodeDB) -> dict:
        return {
            "id": item.id,
            "source_type": "graph_node",
            "type": item.type,
            "label": item.label,
            "created_at": item.created_at.isoformat(),
        }

    @staticmethod
    def _serialize_graph_edge(item: GraphEdgeDB) -> dict:
        return {
            "id": item.id,
            "source_type": "graph_edge",
            "kind": item.kind,
            "source_id": item.source_id,
            "target_id": item.target_id,
            "created_at": item.created_at.isoformat(),
        }

    @staticmethod
    def _serialize_report_section(item: ReportSectionDB) -> dict:
        return {
            "key": item.key,
            "title": item.title,
            "content_md": item.content_md,
        }
