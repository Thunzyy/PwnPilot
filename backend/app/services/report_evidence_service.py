from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.command_history import CommandHistory
from app.models.graph import GraphEdgeDB, GraphNodeDB
from app.models.report import ReportEvidenceLinkDB
from app.models.timeline import Timeline


@dataclass(slots=True)
class ResolvedReportEvidenceLink:
    id: str
    patch_id: str | None
    source_type: str
    source_id: str
    label: str | None
    preview: str | None
    href: str | None
    created_at: datetime


class ReportEvidenceService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def resolve_for_project(
        self,
        *,
        project_id: str,
        evidence_links: list[ReportEvidenceLinkDB],
    ) -> list[ResolvedReportEvidenceLink]:
        command_ids = [link.source_id for link in evidence_links if link.source_type == "command_history"]
        timeline_ids = [link.source_id for link in evidence_links if link.source_type == "timeline"]
        graph_node_ids = [link.source_id for link in evidence_links if link.source_type == "graph_node"]
        graph_edge_ids = [link.source_id for link in evidence_links if link.source_type == "graph_edge"]

        commands = await self._load_commands(project_id=project_id, ids=command_ids)
        timelines = await self._load_timelines(project_id=project_id, ids=timeline_ids)
        graph_nodes = await self._load_graph_nodes(project_id=project_id, ids=graph_node_ids)
        graph_edges = await self._load_graph_edges(project_id=project_id, ids=graph_edge_ids)

        return [
            self._resolve_link(
                project_id=project_id,
                link=link,
                commands=commands,
                timelines=timelines,
                graph_nodes=graph_nodes,
                graph_edges=graph_edges,
            )
            for link in evidence_links
        ]

    async def _load_commands(
        self,
        *,
        project_id: str,
        ids: list[str],
    ) -> dict[str, CommandHistory]:
        if not ids:
            return {}
        result = await self.db.execute(
            select(CommandHistory).where(
                CommandHistory.project_id == project_id,
                CommandHistory.id.in_(ids),
            )
        )
        return {item.id: item for item in result.scalars().all()}

    async def _load_timelines(
        self,
        *,
        project_id: str,
        ids: list[str],
    ) -> dict[str, Timeline]:
        if not ids:
            return {}
        result = await self.db.execute(
            select(Timeline).where(
                Timeline.project_id == project_id,
                Timeline.id.in_(ids),
            )
        )
        return {item.id: item for item in result.scalars().all()}

    async def _load_graph_nodes(
        self,
        *,
        project_id: str,
        ids: list[str],
    ) -> dict[str, GraphNodeDB]:
        if not ids:
            return {}
        result = await self.db.execute(
            select(GraphNodeDB).where(
                GraphNodeDB.project_id == project_id,
                GraphNodeDB.id.in_(ids),
            )
        )
        return {item.id: item for item in result.scalars().all()}

    async def _load_graph_edges(
        self,
        *,
        project_id: str,
        ids: list[str],
    ) -> dict[str, GraphEdgeDB]:
        if not ids:
            return {}
        result = await self.db.execute(
            select(GraphEdgeDB).where(
                GraphEdgeDB.project_id == project_id,
                GraphEdgeDB.id.in_(ids),
            )
        )
        return {item.id: item for item in result.scalars().all()}

    def _resolve_link(
        self,
        *,
        project_id: str,
        link: ReportEvidenceLinkDB,
        commands: dict[str, CommandHistory],
        timelines: dict[str, Timeline],
        graph_nodes: dict[str, GraphNodeDB],
        graph_edges: dict[str, GraphEdgeDB],
    ) -> ResolvedReportEvidenceLink:
        label: str | None = None
        preview: str | None = None
        href: str | None = None

        if link.source_type == "command_history":
            command = commands.get(link.source_id)
            label = "Command"
            preview = self._compact_preview(
                command.command if command is not None else link.source_id,
            )
            href = f"/projects/{project_id}/timeline?commandId={link.source_id}"
        elif link.source_type == "timeline":
            timeline = timelines.get(link.source_id)
            label = (
                timeline.type.replace("_", " ").title()
                if timeline is not None and timeline.type
                else "Timeline"
            )
            preview = self._compact_preview(
                timeline.content if timeline is not None else link.source_id,
            )
            href = f"/projects/{project_id}/timeline?entryId={link.source_id}"
        elif link.source_type == "graph_node":
            node = graph_nodes.get(link.source_id)
            label = "Graph Node"
            preview = self._compact_preview(node.label if node is not None else link.source_id)
            href = f"/projects/{project_id}/graph?nodeId={link.source_id}"
        elif link.source_type == "graph_edge":
            edge = graph_edges.get(link.source_id)
            label = "Graph Edge"
            preview = self._compact_preview(
                (edge.label or edge.command or edge.kind) if edge is not None else link.source_id
            )
            href = f"/projects/{project_id}/graph?edgeId={link.source_id}"
        else:
            label = link.source_type.replace("_", " ").title()
            preview = self._compact_preview(link.source_id)
            href = f"/projects/{project_id}/report"

        return ResolvedReportEvidenceLink(
            id=link.id,
            patch_id=link.patch_id,
            source_type=link.source_type,
            source_id=link.source_id,
            label=label,
            preview=preview,
            href=href,
            created_at=link.created_at,
        )

    @staticmethod
    def _compact_preview(value: str | None, limit: int = 160) -> str | None:
        if value is None:
            return None
        compact = " ".join(value.split())
        if len(compact) <= limit:
            return compact
        return compact[: limit - 1].rstrip() + "…"
