from __future__ import annotations

import json
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from difflib import unified_diff
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.command_history import CommandHistory
from app.models.knowledge import KnowledgeDoc, KnowledgeSource
from app.models.project import Project
from app.models.report import (
    ReportArtifactDB,
    ReportDB,
    ReportEvidenceLinkDB,
    ReportUpdateProposalDB,
    ReportUpdateSectionPatchDB,
)
from app.schemas.graph import GraphResponse
from app.services.graph_service import GraphService
from app.services.graph_svg_renderer import render_attack_graph_png, render_attack_graph_svg
from app.services.kb_service import KBService
from app.services.report_service import ReportService

REPORT_NOTES_DIR_NAME = "writeup-notes"
REPORT_NOTES_DOC_NAME = "Write-up.md"
REPORT_NOTES_SOURCE_NAME = "Report Write-up"
REPORT_NOTES_FILE_PATHS = {
    "report_md": REPORT_NOTES_DOC_NAME,
    "attack_graph_json": "attack-graph.json",
    "attack_graph_png": "attack-graph.png",
    "attack_graph_svg": "attack-graph.svg",
    "accepted_evidence_commands_md": "accepted-evidence-commands.md",
    "accepted_evidence_commands_json": "accepted-evidence-commands.json",
    "manifest_json": "manifest.json",
}


@dataclass(frozen=True, slots=True)
class ReportBundle:
    filename: str
    content: bytes
    artifact: ReportArtifactDB | None = None


@dataclass(frozen=True, slots=True)
class ReportBundleArchivePayload:
    filename: str
    content: bytes
    manifest: dict[str, Any]
    report_revision: int
    graph_node_count: int
    graph_edge_count: int
    accepted_command_count: int
    accepted_command_ids: list[str]


@dataclass(frozen=True, slots=True)
class ReportFolderExport:
    path: str
    files: dict[str, str]
    file_count: int
    manifest: dict[str, Any]


@dataclass(frozen=True, slots=True)
class ReportNotesSync:
    source_id: str
    source_name: str
    source_path: str
    doc_id: str | None
    doc_path: str
    report_revision: int | None
    generated_at: str | None
    files: dict[str, str]
    file_count: int
    stats: dict[str, Any]


@dataclass(frozen=True, slots=True)
class ReportNotesSyncDiff:
    changed: bool
    synced_report_revision: int | None
    current_report_revision: int
    diff_text: str


@dataclass(frozen=True, slots=True)
class AcceptedCommandEvidence:
    command: CommandHistory
    link: ReportEvidenceLinkDB
    proposal: ReportUpdateProposalDB
    patch: ReportUpdateSectionPatchDB | None


@dataclass(frozen=True, slots=True)
class BundleArchiveSnapshot:
    report_markdown: str
    graph_nodes: list[dict[str, Any]]
    graph_edges: list[dict[str, Any]]
    graph_node_ids: list[str]
    graph_edge_ids: list[str]
    accepted_command_ids: list[str]


@dataclass(frozen=True, slots=True)
class BundleArtifactComparison:
    base: ReportArtifactDB
    target: ReportArtifactDB
    report_diff_text: str
    report_changed: bool
    added_command_ids: list[str]
    removed_command_ids: list[str]
    unchanged_command_ids: list[str]
    added_node_ids: list[str]
    removed_node_ids: list[str]
    added_nodes: list[dict[str, Any]]
    removed_nodes: list[dict[str, Any]]
    added_edge_ids: list[str]
    removed_edge_ids: list[str]
    added_edges: list[dict[str, Any]]
    removed_edges: list[dict[str, Any]]


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _json_default(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _safe_archive_filename(value: str) -> str:
    cleaned = "".join(char if char.isalnum() or char in "-_." else "-" for char in value.strip())
    cleaned = "-".join(part for part in cleaned.split("-") if part)
    return cleaned.lower() or "report"


def _fenced_text(value: str | None) -> str:
    if not value:
        return ""
    return value.replace("```", "` ` `")


def _ordered_set_difference(left: list[str], right: list[str]) -> list[str]:
    right_set = set(right)
    return [item for item in left if item not in right_set]


def _ordered_intersection(left: list[str], right: list[str]) -> list[str]:
    right_set = set(right)
    return [item for item in left if item in right_set]


def _ordered_items_by_id(items: list[dict[str, Any]], ids: list[str]) -> list[dict[str, Any]]:
    by_id = {
        str(item["id"]): item
        for item in items
        if isinstance(item, dict) and item.get("id") is not None
    }
    return [by_id[item_id] for item_id in ids if item_id in by_id]


class ReportBundleService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.report_service = ReportService(db)
        self.graph_service = GraphService(db)

    async def build_bundle(self, *, project: Project, report: ReportDB) -> ReportBundle:
        payload = await self._build_archive_payload(project=project, report=report)
        artifact = ReportArtifactDB(
            project_id=project.id,
            report_id=report.id,
            kind="bundle",
            filename=payload.filename,
            content_type="application/zip",
            content=payload.content,
            size_bytes=len(payload.content),
            sha256=sha256(payload.content).hexdigest(),
            report_revision=payload.report_revision,
            graph_node_count=payload.graph_node_count,
            graph_edge_count=payload.graph_edge_count,
            accepted_command_count=payload.accepted_command_count,
            accepted_command_ids=payload.accepted_command_ids,
            manifest_json=payload.manifest,
        )
        self.db.add(artifact)
        await self.db.commit()
        await self.db.refresh(artifact)
        return ReportBundle(filename=payload.filename, content=payload.content, artifact=artifact)

    async def export_bundle_folder(
        self,
        *,
        project: Project,
        report: ReportDB,
    ) -> ReportFolderExport:
        payload = await self._build_archive_payload(project=project, report=report)
        export_dir = Path(project.workspace_path) / "writeup-export"
        export_dir.mkdir(parents=True, exist_ok=True)

        with zipfile.ZipFile(BytesIO(payload.content)) as archive:
            for member_name in archive.namelist():
                member_path = Path(member_name)
                if member_path.is_absolute() or ".." in member_path.parts:
                    msg = f"Unsafe report export archive member: {member_name}"
                    raise ValueError(msg)
                target_path = export_dir / member_path
                target_path.parent.mkdir(parents=True, exist_ok=True)
                target_path.write_bytes(archive.read(member_name))

        manifest_files = payload.manifest.get("files", {})
        files = {
            key: str(export_dir / relative_path)
            for key, relative_path in manifest_files.items()
            if isinstance(relative_path, str)
        }
        return ReportFolderExport(
            path=str(export_dir),
            files=files,
            file_count=len(files),
            manifest=payload.manifest,
        )

    async def sync_bundle_to_notes(
        self,
        *,
        project: Project,
        report: ReportDB,
        user_id: str,
    ) -> ReportNotesSync:
        payload = await self._build_archive_payload(project=project, report=report)
        notes_dir = Path(project.workspace_path) / REPORT_NOTES_DIR_NAME
        notes_dir.mkdir(parents=True, exist_ok=True)

        with zipfile.ZipFile(BytesIO(payload.content)) as archive:
            for member_name in archive.namelist():
                member_path = Path(member_name)
                if member_path.is_absolute() or ".." in member_path.parts:
                    msg = f"Unsafe report notes archive member: {member_name}"
                    raise ValueError(msg)
                target_name = REPORT_NOTES_DOC_NAME if member_name == "report.md" else member_name
                target_path = notes_dir / target_name
                target_path.parent.mkdir(parents=True, exist_ok=True)
                content = archive.read(member_name)
                if member_name == "report.md":
                    content = self._render_notes_markdown(
                        content.decode(),
                        project_id=project.id,
                        report_id=report.id,
                    ).encode()
                target_path.write_bytes(content)

        source = await self._ensure_report_notes_source(
            project=project,
            user_id=user_id,
            notes_dir=notes_dir,
        )
        stats = await KBService(self.db).index_vault(source.id, str(notes_dir))
        doc = await self._get_notes_writeup_doc(source.id)

        manifest_files = payload.manifest.get("files", {})
        files = {
            key: str(notes_dir / (REPORT_NOTES_DOC_NAME if relative_path == "report.md" else relative_path))
            for key, relative_path in manifest_files.items()
            if isinstance(relative_path, str)
        }
        return ReportNotesSync(
            source_id=source.id,
            source_name=source.name,
            source_path=str(notes_dir),
            doc_id=doc.id if doc else None,
            doc_path=REPORT_NOTES_DOC_NAME,
            report_revision=payload.report_revision,
            generated_at=str(payload.manifest["generated_at"]),
            files=files,
            file_count=len(files),
            stats=stats,
        )

    async def get_existing_notes_sync(
        self,
        *,
        project: Project,
        user_id: str,
    ) -> ReportNotesSync | None:
        notes_dir = Path(project.workspace_path) / REPORT_NOTES_DIR_NAME
        source = await self._get_report_notes_source(
            project_id=project.id,
            user_id=user_id,
            notes_dir=notes_dir,
        )
        if source is None:
            return None

        doc = await self._get_notes_writeup_doc(source.id)
        manifest = self._read_notes_manifest(notes_dir)
        files = self._build_notes_files(notes_dir)
        return ReportNotesSync(
            source_id=source.id,
            source_name=source.name,
            source_path=str(notes_dir),
            doc_id=doc.id if doc else None,
            doc_path=REPORT_NOTES_DOC_NAME,
            report_revision=self._get_manifest_report_revision(manifest),
            generated_at=self._get_manifest_generated_at(manifest),
            files=files,
            file_count=len(files),
            stats={"cached": True, "errors": []},
        )

    async def get_notes_sync_diff(
        self,
        *,
        project: Project,
        report: ReportDB,
        user_id: str,
    ) -> ReportNotesSyncDiff | None:
        notes_sync = await self.get_existing_notes_sync(project=project, user_id=user_id)
        if notes_sync is None:
            return None

        notes_dir = Path(notes_sync.source_path)
        synced_markdown = self._strip_notes_frontmatter(
            self._read_notes_writeup_markdown(notes_dir),
        )
        current_markdown = self._append_attack_graph_visual(
            await self.report_service.render_report_markdown(report.id),
        )
        diff_text = "\n".join(
            unified_diff(
                synced_markdown.splitlines(),
                current_markdown.splitlines(),
                fromfile=f"notes:{REPORT_NOTES_DOC_NAME}",
                tofile=f"report:revision-{report.current_revision}",
                lineterm="",
            )
        )
        return ReportNotesSyncDiff(
            changed=synced_markdown != current_markdown,
            synced_report_revision=notes_sync.report_revision,
            current_report_revision=report.current_revision,
            diff_text=diff_text,
        )

    async def _build_archive_payload(
        self,
        *,
        project: Project,
        report: ReportDB,
    ) -> ReportBundleArchivePayload:
        generated_at = _utc_now_iso()
        report_markdown = await self.report_service.render_report_markdown(report.id)
        graph = await self.graph_service.get_graph(project.id)
        graph_png = render_attack_graph_png(graph, title=f"{project.name} Attack Graph")
        graph_svg = render_attack_graph_svg(graph, title=f"{project.name} Attack Graph")
        export_report_markdown = self._append_attack_graph_visual(report_markdown)
        accepted_commands = await self._load_accepted_command_evidence(report.id, project.id)
        command_payload = self._build_command_payload(
            generated_at=generated_at,
            project=project,
            report=report,
            accepted_commands=accepted_commands,
        )
        files = {
            "report_md": "report.md",
            "attack_graph_json": "attack-graph.json",
            "attack_graph_png": "attack-graph.png",
            "attack_graph_svg": "attack-graph.svg",
            "accepted_evidence_commands_md": "accepted-evidence-commands.md",
            "accepted_evidence_commands_json": "accepted-evidence-commands.json",
            "manifest_json": "manifest.json",
        }
        accepted_command_ids = [item.command.id for item in accepted_commands]
        manifest = {
            "generated_at": generated_at,
            "project": {
                "id": project.id,
                "name": project.name,
                "slug": project.slug,
                "type": project.type,
            },
            "report": {
                "id": report.id,
                "title": report.title,
                "profile": report.profile,
                "current_revision": report.current_revision,
                "markdown_path": report.markdown_path,
            },
            "accepted_command_count": len(command_payload["commands"]),
            "accepted_command_ids": accepted_command_ids,
            "graph": {
                "node_count": len(graph.nodes),
                "edge_count": len(graph.edges),
                "scenario_count": len(graph.scenarios),
            },
            "files": files,
        }

        content = BytesIO()
        with zipfile.ZipFile(content, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(files["report_md"], export_report_markdown)
            archive.writestr(
                files["attack_graph_json"],
                json.dumps(graph.model_dump(mode="json"), indent=2, sort_keys=True),
            )
            archive.writestr(files["attack_graph_png"], graph_png)
            archive.writestr(files["attack_graph_svg"], graph_svg)
            archive.writestr(
                files["accepted_evidence_commands_md"],
                self._render_command_appendix_markdown(
                    project=project,
                    generated_at=generated_at,
                    accepted_commands=accepted_commands,
                ),
            )
            archive.writestr(
                files["accepted_evidence_commands_json"],
                json.dumps(command_payload, default=_json_default, indent=2, sort_keys=True),
            )
            archive.writestr(
                files["manifest_json"],
                json.dumps(manifest, default=_json_default, indent=2, sort_keys=True),
            )

        filename = f"{_safe_archive_filename(project.slug or project.name)}-report-bundle.zip"
        bundle_content = content.getvalue()
        return ReportBundleArchivePayload(
            filename=filename,
            content=bundle_content,
            manifest=manifest,
            report_revision=report.current_revision,
            graph_node_count=len(graph.nodes),
            graph_edge_count=len(graph.edges),
            accepted_command_count=len(accepted_command_ids),
            accepted_command_ids=accepted_command_ids,
        )

    async def _ensure_report_notes_source(
        self,
        *,
        project: Project,
        user_id: str,
        notes_dir: Path,
    ) -> KnowledgeSource:
        source_path = str(notes_dir)
        source = await self._get_report_notes_source(
            project_id=project.id,
            user_id=user_id,
            notes_dir=notes_dir,
        )
        if source is None:
            source = KnowledgeSource(
                name=REPORT_NOTES_SOURCE_NAME,
                source_type="local",
                origin="report_sync",
                path=source_path,
                user_id=user_id,
                project_id=project.id,
                read_only=False,
                opsec_acknowledged=True,
            )
            self.db.add(source)
        else:
            source.name = REPORT_NOTES_SOURCE_NAME
            source.origin = source.origin or "report_sync"
            source.read_only = False
            source.opsec_acknowledged = True

        await self.db.commit()
        await self.db.refresh(source)
        return source

    async def _get_report_notes_source(
        self,
        *,
        project_id: str,
        user_id: str,
        notes_dir: Path,
    ) -> KnowledgeSource | None:
        result = await self.db.execute(
            select(KnowledgeSource)
            .where(
                KnowledgeSource.project_id == project_id,
                KnowledgeSource.user_id == user_id,
                KnowledgeSource.source_type == "local",
                KnowledgeSource.path == str(notes_dir),
            )
            .order_by(KnowledgeSource.created_at.asc(), KnowledgeSource.id.asc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def _get_notes_writeup_doc(self, source_id: str) -> KnowledgeDoc | None:
        result = await self.db.execute(
            select(KnowledgeDoc).where(
                KnowledgeDoc.source_id == source_id,
                KnowledgeDoc.relative_path == REPORT_NOTES_DOC_NAME,
            )
        )
        return result.scalar_one_or_none()

    def _build_notes_files(self, notes_dir: Path) -> dict[str, str]:
        return {
            key: str(notes_dir / relative_path)
            for key, relative_path in REPORT_NOTES_FILE_PATHS.items()
        }

    def _read_notes_manifest(self, notes_dir: Path) -> dict[str, Any]:
        try:
            manifest = json.loads((notes_dir / "manifest.json").read_text())
        except (OSError, json.JSONDecodeError):
            return {}
        return manifest if isinstance(manifest, dict) else {}

    def _get_manifest_report_revision(self, manifest: dict[str, Any]) -> int | None:
        report = manifest.get("report")
        if not isinstance(report, dict):
            return None
        revision = report.get("current_revision")
        return revision if isinstance(revision, int) else None

    def _get_manifest_generated_at(self, manifest: dict[str, Any]) -> str | None:
        generated_at = manifest.get("generated_at")
        return generated_at if isinstance(generated_at, str) else None

    def _read_notes_writeup_markdown(self, notes_dir: Path) -> str:
        try:
            return (notes_dir / REPORT_NOTES_DOC_NAME).read_text()
        except OSError:
            return ""

    def _strip_notes_frontmatter(self, markdown: str) -> str:
        if not markdown.startswith("---\n"):
            return markdown
        end_marker_index = markdown.find("\n---\n", 4)
        if end_marker_index == -1:
            return markdown
        return markdown[end_marker_index + len("\n---\n") :]

    async def list_bundle_artifacts(
        self,
        *,
        project_id: str,
        report_id: str,
        limit: int = 20,
    ) -> list[ReportArtifactDB]:
        result = await self.db.execute(
            select(ReportArtifactDB)
            .where(
                ReportArtifactDB.project_id == project_id,
                ReportArtifactDB.report_id == report_id,
                ReportArtifactDB.kind == "bundle",
            )
            .order_by(ReportArtifactDB.created_at.desc(), ReportArtifactDB.id.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def get_bundle_artifact(
        self,
        *,
        project_id: str,
        report_id: str,
        artifact_id: str,
    ) -> ReportArtifactDB | None:
        result = await self.db.execute(
            select(ReportArtifactDB).where(
                ReportArtifactDB.id == artifact_id,
                ReportArtifactDB.project_id == project_id,
                ReportArtifactDB.report_id == report_id,
                ReportArtifactDB.kind == "bundle",
            )
        )
        return result.scalar_one_or_none()

    async def get_bundle_artifact_graph_svg(
        self,
        *,
        project_id: str,
        report_id: str,
        artifact_id: str,
    ) -> str | None:
        artifact = await self.get_bundle_artifact(
            project_id=project_id,
            report_id=report_id,
            artifact_id=artifact_id,
        )
        if artifact is None:
            return None

        with zipfile.ZipFile(BytesIO(artifact.content)) as archive:
            try:
                return archive.read("attack-graph.svg").decode()
            except KeyError:
                graph_payload = json.loads(archive.read("attack-graph.json"))
                graph = GraphResponse.model_validate(graph_payload)
                return render_attack_graph_svg(graph)

    async def get_bundle_artifact_graph_png(
        self,
        *,
        project_id: str,
        report_id: str,
        artifact_id: str,
    ) -> bytes | None:
        artifact = await self.get_bundle_artifact(
            project_id=project_id,
            report_id=report_id,
            artifact_id=artifact_id,
        )
        if artifact is None:
            return None

        with zipfile.ZipFile(BytesIO(artifact.content)) as archive:
            try:
                return archive.read("attack-graph.png")
            except KeyError:
                graph_payload = json.loads(archive.read("attack-graph.json"))
                graph = GraphResponse.model_validate(graph_payload)
                return render_attack_graph_png(graph)

    async def compare_bundle_artifacts(
        self,
        *,
        project_id: str,
        report_id: str,
        base_artifact_id: str,
        target_artifact_id: str,
    ) -> BundleArtifactComparison | None:
        base_artifact = await self.get_bundle_artifact(
            project_id=project_id,
            report_id=report_id,
            artifact_id=base_artifact_id,
        )
        target_artifact = await self.get_bundle_artifact(
            project_id=project_id,
            report_id=report_id,
            artifact_id=target_artifact_id,
        )
        if base_artifact is None or target_artifact is None:
            return None

        base_snapshot = self._read_bundle_snapshot(base_artifact)
        target_snapshot = self._read_bundle_snapshot(target_artifact)
        added_node_ids = _ordered_set_difference(
            target_snapshot.graph_node_ids,
            base_snapshot.graph_node_ids,
        )
        removed_node_ids = _ordered_set_difference(
            base_snapshot.graph_node_ids,
            target_snapshot.graph_node_ids,
        )
        added_edge_ids = _ordered_set_difference(
            target_snapshot.graph_edge_ids,
            base_snapshot.graph_edge_ids,
        )
        removed_edge_ids = _ordered_set_difference(
            base_snapshot.graph_edge_ids,
            target_snapshot.graph_edge_ids,
        )
        report_diff = "\n".join(
            unified_diff(
                base_snapshot.report_markdown.splitlines(),
                target_snapshot.report_markdown.splitlines(),
                fromfile=f"{base_artifact.filename}:report.md",
                tofile=f"{target_artifact.filename}:report.md",
                lineterm="",
            )
        )

        return BundleArtifactComparison(
            base=base_artifact,
            target=target_artifact,
            report_diff_text=report_diff,
            report_changed=base_snapshot.report_markdown != target_snapshot.report_markdown,
            added_command_ids=_ordered_set_difference(
                target_snapshot.accepted_command_ids,
                base_snapshot.accepted_command_ids,
            ),
            removed_command_ids=_ordered_set_difference(
                base_snapshot.accepted_command_ids,
                target_snapshot.accepted_command_ids,
            ),
            unchanged_command_ids=_ordered_intersection(
                base_snapshot.accepted_command_ids,
                target_snapshot.accepted_command_ids,
            ),
            added_node_ids=added_node_ids,
            removed_node_ids=removed_node_ids,
            added_nodes=_ordered_items_by_id(target_snapshot.graph_nodes, added_node_ids),
            removed_nodes=_ordered_items_by_id(base_snapshot.graph_nodes, removed_node_ids),
            added_edge_ids=added_edge_ids,
            removed_edge_ids=removed_edge_ids,
            added_edges=_ordered_items_by_id(target_snapshot.graph_edges, added_edge_ids),
            removed_edges=_ordered_items_by_id(base_snapshot.graph_edges, removed_edge_ids),
        )

    async def _load_accepted_command_evidence(
        self,
        report_id: str,
        project_id: str,
    ) -> list[AcceptedCommandEvidence]:
        result = await self.db.execute(
            select(
                CommandHistory,
                ReportEvidenceLinkDB,
                ReportUpdateProposalDB,
                ReportUpdateSectionPatchDB,
            )
            .join(
                ReportEvidenceLinkDB,
                ReportEvidenceLinkDB.source_id == CommandHistory.id,
            )
            .join(
                ReportUpdateProposalDB,
                ReportUpdateProposalDB.id == ReportEvidenceLinkDB.proposal_id,
            )
            .outerjoin(
                ReportUpdateSectionPatchDB,
                ReportUpdateSectionPatchDB.id == ReportEvidenceLinkDB.patch_id,
            )
            .where(
                CommandHistory.project_id == project_id,
                ReportEvidenceLinkDB.source_type == "command_history",
                ReportUpdateProposalDB.report_id == report_id,
                ReportUpdateProposalDB.status == "accepted",
            )
            .order_by(
                ReportEvidenceLinkDB.created_at.asc(),
                CommandHistory.created_at.asc(),
                CommandHistory.id.asc(),
            )
        )
        deduped: dict[str, AcceptedCommandEvidence] = {}
        for command, link, proposal, patch in result.all():
            deduped.setdefault(
                command.id,
                AcceptedCommandEvidence(
                    command=command,
                    link=link,
                    proposal=proposal,
                    patch=patch,
                ),
            )
        return list(deduped.values())

    def _build_command_payload(
        self,
        *,
        generated_at: str,
        project: Project,
        report: ReportDB,
        accepted_commands: list[AcceptedCommandEvidence],
    ) -> dict[str, Any]:
        return {
            "generated_at": generated_at,
            "project_id": project.id,
            "report_id": report.id,
            "commands": [
                {
                    "id": item.command.id,
                    "proposal_id": item.proposal.id,
                    "patch_id": item.link.patch_id,
                    "section_key": item.patch.section_key if item.patch else None,
                    "command": item.command.command,
                    "output": item.command.output,
                    "output_preview": item.command.output_preview,
                    "exit_code": item.command.exit_code,
                    "cwd": item.command.cwd,
                    "duration_ms": item.command.duration_ms,
                    "source": item.command.source,
                    "session_id": item.command.session_id,
                    "created_at": item.command.created_at,
                }
                for item in accepted_commands
            ],
        }

    def _read_bundle_snapshot(self, artifact: ReportArtifactDB) -> BundleArchiveSnapshot:
        with zipfile.ZipFile(BytesIO(artifact.content)) as archive:
            report_markdown = archive.read("report.md").decode()
            graph = json.loads(archive.read("attack-graph.json"))
            command_payload = json.loads(archive.read("accepted-evidence-commands.json"))

        graph_nodes = graph.get("nodes") if isinstance(graph, dict) else []
        graph_edges = graph.get("edges") if isinstance(graph, dict) else []
        commands = command_payload.get("commands") if isinstance(command_payload, dict) else []
        graph_node_items = [
            node
            for node in graph_nodes
            if isinstance(node, dict) and node.get("id") is not None
        ]
        graph_edge_items = [
            edge
            for edge in graph_edges
            if isinstance(edge, dict) and edge.get("id") is not None
        ]
        return BundleArchiveSnapshot(
            report_markdown=report_markdown,
            graph_nodes=graph_node_items,
            graph_edges=graph_edge_items,
            graph_node_ids=[str(node["id"]) for node in graph_node_items],
            graph_edge_ids=[str(edge["id"]) for edge in graph_edge_items],
            accepted_command_ids=[
                str(command["id"])
                for command in commands
                if isinstance(command, dict) and command.get("id") is not None
            ],
        )

    def _append_attack_graph_visual(self, report_markdown: str) -> str:
        if "attack-graph.svg" in report_markdown or "attack-graph.png" in report_markdown:
            return report_markdown.rstrip() + "\n"
        return (
            report_markdown.rstrip()
            + "\n\n## Attack Graph\n\n![Attack Graph](attack-graph.png)\n"
        )

    def _render_notes_markdown(
        self,
        report_markdown: str,
        *,
        project_id: str,
        report_id: str,
    ) -> str:
        frontmatter = "\n".join(
            [
                "---",
                "title: Write-up",
                "tags:",
                "  - report",
                "  - writeup",
                f"project_id: {project_id}",
                f"report_id: {report_id}",
                "generated_from: pwnpilot-report-sync",
                "---",
                "",
            ]
        )
        return frontmatter + report_markdown.lstrip()

    def _render_command_appendix_markdown(
        self,
        *,
        project: Project,
        generated_at: str,
        accepted_commands: list[AcceptedCommandEvidence],
    ) -> str:
        lines = [
            "# Accepted Evidence Commands",
            "",
            f"- Project: {project.name}",
            f"- Generated: {generated_at}",
            f"- Commands: {len(accepted_commands)}",
            "",
        ]
        if not accepted_commands:
            lines.append("No accepted command evidence is linked to this report yet.")
            return "\n".join(lines).rstrip() + "\n"

        for index, item in enumerate(accepted_commands, start=1):
            command = item.command
            section = item.patch.section_key if item.patch else "n/a"
            lines.extend(
                [
                    f"## {index}. `{command.command}`",
                    "",
                    f"- Command ID: `{command.id}`",
                    f"- Proposal ID: `{item.proposal.id}`",
                    f"- Section: `{section}`",
                    f"- Session ID: `{command.session_id}`",
                    f"- CWD: `{command.cwd}`",
                    f"- Exit Code: `{command.exit_code}`",
                    f"- Duration: `{command.duration_ms}ms`",
                    f"- Source: `{command.source}`",
                    f"- Created: `{command.created_at.isoformat()}`",
                    "",
                    "### Output",
                    "",
                    "```text",
                    _fenced_text(command.output),
                    "```",
                    "",
                ]
            )
        return "\n".join(lines).rstrip() + "\n"
