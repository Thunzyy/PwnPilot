from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai import AIChatMessage, AIConversation, AIMemory
from app.models.command_history import CommandHistory
from app.models.knowledge import KnowledgeDoc
from app.models.project import Project
from app.models.timeline import Timeline
from app.models.timeline_kb_link import TimelineKBLink
from app.schemas.graph import (
    GraphEdge,
    GraphExportPathRequest,
    GraphExportResponse,
    GraphNode,
)
from app.services.graph_service import GraphService
from app.services.llm_service import LLMService

_TEMPLATE_ENV = Environment(
    loader=FileSystemLoader(str(Path(__file__).resolve().parent.parent / "templates")),
    autoescape=select_autoescape(default_for_string=False, disabled_extensions=("j2",)),
    trim_blocks=True,
    lstrip_blocks=True,
)

_SENSITIVE_META_KEYS = {
    "password",
    "password_masked",
    "secret",
    "secret_masked",
    "value",
    "value_masked",
}


@dataclass(frozen=True)
class ExportItem:
    title: str
    content: str


@dataclass(frozen=True)
class TerminalEvidence:
    command: str
    output: str


class GraphExportService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.graph_service = GraphService(db)

    async def export_path(
        self,
        *,
        project: Project,
        user_id: str,
        request: GraphExportPathRequest,
    ) -> GraphExportResponse:
        if len(request.node_ids) > 50:
            raise OverflowError("Attack path export is limited to 50 nodes")
        if not request.node_ids:
            raise ValueError("At least one node_id is required")

        graph = await self.graph_service.get_graph(project.id)
        node_map = {node.id: node for node in graph.nodes}
        edge_map = {edge.id: edge for edge in graph.edges}

        try:
            ordered_nodes = [node_map[node_id] for node_id in request.node_ids]
        except KeyError as exc:
            raise LookupError(f"Graph node not found: {exc.args[0]}") from exc

        ordered_edges = self._resolve_edges(
            edge_ids=request.edge_ids,
            node_ids=request.node_ids,
            edge_map=edge_map,
            edges=graph.edges,
        )

        source_ids = {
            source_id
            for node in ordered_nodes
            for source_id in node.source_step_ids
        }
        source_ids.update(
            edge.source_step_id for edge in ordered_edges if edge.source_step_id
        )

        commands = await self._load_commands(project.id, source_ids)
        timelines = await self._load_timelines(project.id, source_ids)
        direct_docs = await self._load_docs_by_id(source_ids)
        linked_docs = await self._load_linked_docs(timelines.keys())
        ai_messages = await self._load_ai_messages(project.id, source_ids)
        ai_memories = await self._load_ai_memories(project.id, source_ids)
        replacements = self._build_secret_replacements(ordered_nodes)

        sections: list[dict] = []
        for index, node in enumerate(ordered_nodes):
            incoming_edge = ordered_edges[index - 1] if index > 0 and index - 1 < len(ordered_edges) else None
            step_ids = list(node.source_step_ids)
            if incoming_edge and incoming_edge.source_step_id:
                step_ids.append(incoming_edge.source_step_id)

            terminal_entries = (
                self._build_terminal_entries(step_ids, commands, replacements)
                if request.include_terminal_output
                else []
            )
            notes = (
                self._build_notes(step_ids, timelines, direct_docs, linked_docs, replacements)
                if request.include_notes
                else []
            )
            ai_context = (
                self._build_ai_context(step_ids, ai_messages, ai_memories, replacements)
                if request.include_notes
                else []
            )
            sections.append(
                {
                    "node": node,
                    "transition_label": incoming_edge.kind.replace("_", " ") if incoming_edge else None,
                    "summary_items": self._build_summary_items(node, replacements),
                    "terminal_entries": terminal_entries,
                    "notes": notes,
                    "ai_context": ai_context,
                }
            )

        ai_summary = None
        if request.include_ai_summary:
            ai_summary = await self._generate_ai_summary(
                project_name=project.name,
                user_id=user_id,
                project_id=project.id,
                ordered_nodes=ordered_nodes,
                replacements=replacements,
            )

        content = _TEMPLATE_ENV.get_template("graph_export.md.j2").render(
            project_name=project.name,
            node_path=" -> ".join(node.label for node in ordered_nodes),
            sections=sections,
            ai_summary=ai_summary,
        )

        return GraphExportResponse(format=request.format, content=content.strip())

    def _resolve_edges(
        self,
        *,
        edge_ids: list[str] | None,
        node_ids: list[str],
        edge_map: dict[str, GraphEdge],
        edges: list[GraphEdge],
    ) -> list[GraphEdge]:
        if edge_ids:
            try:
                return [edge_map[edge_id] for edge_id in edge_ids]
            except KeyError as exc:
                raise LookupError(f"Graph edge not found: {exc.args[0]}") from exc

        ordered_edges: list[GraphEdge] = []
        edge_lookup = {(edge.source_id, edge.target_id): edge for edge in edges}
        for source_id, target_id in zip(node_ids, node_ids[1:], strict=False):
            edge = edge_lookup.get((source_id, target_id))
            if edge:
                ordered_edges.append(edge)
        return ordered_edges

    async def _load_commands(
        self, project_id: str, source_ids: set[str]
    ) -> dict[str, CommandHistory]:
        if not source_ids:
            return {}
        result = await self.db.execute(
            select(CommandHistory).where(
                CommandHistory.project_id == project_id,
                CommandHistory.id.in_(source_ids),
            )
        )
        return {entry.id: entry for entry in result.scalars().all()}

    async def _load_timelines(self, project_id: str, source_ids: set[str]) -> dict[str, Timeline]:
        if not source_ids:
            return {}
        result = await self.db.execute(
            select(Timeline).where(
                Timeline.project_id == project_id,
                Timeline.id.in_(source_ids),
            )
        )
        return {entry.id: entry for entry in result.scalars().all()}

    async def _load_docs_by_id(self, source_ids: set[str]) -> dict[str, KnowledgeDoc]:
        if not source_ids:
            return {}
        result = await self.db.execute(
            select(KnowledgeDoc).where(KnowledgeDoc.id.in_(source_ids))
        )
        return {doc.id: doc for doc in result.scalars().all()}

    async def _load_linked_docs(
        self, timeline_ids: set[str] | list[str] | dict[str, Timeline].keys
    ) -> dict[str, list[KnowledgeDoc]]:
        timeline_id_list = list(timeline_ids)
        if not timeline_id_list:
            return {}
        result = await self.db.execute(
            select(TimelineKBLink.timeline_entry_id, KnowledgeDoc)
            .join(KnowledgeDoc, TimelineKBLink.doc_id == KnowledgeDoc.id)
            .where(TimelineKBLink.timeline_entry_id.in_(timeline_id_list))
        )
        linked: dict[str, list[KnowledgeDoc]] = {}
        for timeline_entry_id, doc in result.all():
            linked.setdefault(timeline_entry_id, []).append(doc)
        return linked

    async def _load_ai_messages(
        self, project_id: str, source_ids: set[str]
    ) -> dict[str, AIChatMessage]:
        if not source_ids:
            return {}
        result = await self.db.execute(
            select(AIChatMessage)
            .join(AIConversation, AIChatMessage.conversation_id == AIConversation.id)
            .where(
                AIConversation.project_id == project_id,
                AIChatMessage.id.in_(source_ids),
            )
        )
        return {message.id: message for message in result.scalars().all()}

    async def _load_ai_memories(
        self, project_id: str, source_ids: set[str]
    ) -> dict[str, AIMemory]:
        if not source_ids:
            return {}
        result = await self.db.execute(
            select(AIMemory).where(
                AIMemory.project_id == project_id,
                AIMemory.id.in_(source_ids),
            )
        )
        return {memory.id: memory for memory in result.scalars().all()}

    def _build_terminal_entries(
        self,
        step_ids: list[str],
        commands: dict[str, CommandHistory],
        replacements: dict[str, str],
    ) -> list[TerminalEvidence]:
        entries: list[TerminalEvidence] = []
        seen: set[str] = set()
        for step_id in step_ids:
            command = commands.get(step_id)
            if not command or command.id in seen:
                continue
            seen.add(command.id)
            output = (command.output or command.output_preview or "").strip()
            if not output:
                continue
            entries.append(
                TerminalEvidence(
                    command=self._sanitize_text(command.command, replacements),
                    output=self._truncate(self._sanitize_text(output, replacements)),
                )
            )
        return entries

    def _build_notes(
        self,
        step_ids: list[str],
        timelines: dict[str, Timeline],
        direct_docs: dict[str, KnowledgeDoc],
        linked_docs: dict[str, list[KnowledgeDoc]],
        replacements: dict[str, str],
    ) -> list[ExportItem]:
        notes: list[ExportItem] = []
        seen: set[tuple[str, str]] = set()
        for step_id in step_ids:
            timeline = timelines.get(step_id)
            if timeline:
                title = f"Timeline: {timeline.type}"
                content = self._sanitize_text(
                    " — ".join(
                        part for part in [timeline.content, timeline.output] if part
                    ),
                    replacements,
                )
                key = ("timeline", timeline.id)
                if content and key not in seen:
                    notes.append(ExportItem(title=title, content=content))
                    seen.add(key)
                for doc in linked_docs.get(timeline.id, []):
                    key = ("doc", doc.id)
                    if key in seen:
                        continue
                    notes.append(
                        ExportItem(
                            title=f"Knowledge: {doc.title}",
                            content=self._sanitize_text(
                                self._truncate(doc.body or doc.relative_path),
                                replacements,
                            ),
                        )
                    )
                    seen.add(key)
            doc = direct_docs.get(step_id)
            if doc:
                key = ("doc", doc.id)
                if key not in seen:
                    notes.append(
                        ExportItem(
                            title=f"Knowledge: {doc.title}",
                            content=self._sanitize_text(
                                self._truncate(doc.body or doc.relative_path),
                                replacements,
                            ),
                        )
                    )
                    seen.add(key)
        return notes

    def _build_ai_context(
        self,
        step_ids: list[str],
        ai_messages: dict[str, AIChatMessage],
        ai_memories: dict[str, AIMemory],
        replacements: dict[str, str],
    ) -> list[ExportItem]:
        items: list[ExportItem] = []
        seen: set[tuple[str, str]] = set()
        for step_id in step_ids:
            message = ai_messages.get(step_id)
            if message and ("message", message.id) not in seen:
                items.append(
                    ExportItem(
                        title=f"AI {message.role}",
                        content=self._sanitize_text(self._truncate(message.content), replacements),
                    )
                )
                seen.add(("message", message.id))
            memory = ai_memories.get(step_id)
            if memory and ("memory", memory.id) not in seen:
                items.append(
                    ExportItem(
                        title=f"AI memory: {memory.key}",
                        content=self._sanitize_text(self._truncate(memory.value), replacements),
                    )
                )
                seen.add(("memory", memory.id))
        return items

    def _build_summary_items(
        self, node: GraphNode, replacements: dict[str, str]
    ) -> list[dict[str, str]]:
        meta = node.meta or {}
        items: list[tuple[str, str | None]] = []
        if node.type == "host":
            items.extend(
                [
                    ("IP", self._string(meta.get("ip"))),
                    ("Hostname", self._string(meta.get("hostname"))),
                    ("OS", self._string(meta.get("os"))),
                ]
            )
        elif node.type == "service":
            items.extend(
                [
                    ("Service", self._string(meta.get("service_name"))),
                    ("Port", self._string(meta.get("port"))),
                    ("Product", self._string(meta.get("product"))),
                ]
            )
        elif node.type == "credential":
            items.extend(
                [
                    ("Username", self._string(meta.get("username"))),
                    ("Domain", self._string(meta.get("domain"))),
                    ("Secret", self._string(meta.get("password_masked"))),
                ]
            )
        elif node.type == "session":
            items.extend(
                [
                    ("User", self._string(meta.get("user"))),
                    ("Privilege", self._string(meta.get("privilege"))),
                    ("Shell", self._string(meta.get("shell_type"))),
                ]
            )
        elif node.type == "finding":
            items.extend(
                [
                    ("Severity", self._string(meta.get("severity"))),
                    ("Description", self._string(meta.get("description"))),
                ]
            )
        elif node.type == "loot":
            items.extend(
                [
                    ("Kind", self._string(meta.get("kind"))),
                    ("Value", self._string(meta.get("value_masked"))),
                    ("Location", self._string(meta.get("location"))),
                ]
            )
        elif node.type == "user":
            items.extend(
                [
                    ("Username", self._string(meta.get("username"))),
                    ("Domain", self._string(meta.get("domain"))),
                    ("Group", self._string(meta.get("group"))),
                ]
            )
        elif node.type == "action":
            items.extend(
                [
                    ("Tool", self._string(meta.get("tool"))),
                    ("Phase", self._string(meta.get("phase"))),
                    ("Command", self._string(meta.get("command"))),
                ]
            )
        elif node.type == "artifact":
            items.extend(
                [
                    ("Kind", self._string(meta.get("kind"))),
                    ("Path", self._string(meta.get("path"))),
                ]
            )
        rendered = []
        for label, value in items:
            if not value:
                continue
            rendered.append(
                {
                    "label": label,
                    "value": self._sanitize_text(value, replacements),
                }
            )
        return rendered

    async def _generate_ai_summary(
        self,
        *,
        project_name: str,
        user_id: str,
        project_id: str,
        ordered_nodes: list[GraphNode],
        replacements: dict[str, str],
    ) -> str | None:
        provider = await LLMService(self.db).get_provider_for_context(
            user_id=user_id,
            context_type="graph",
            project_id=project_id,
        )
        if provider is None:
            return None

        user_prompt = self._sanitize_text(
            (
                f"Project: {project_name}\n"
                f"Attack path: {' -> '.join(node.label for node in ordered_nodes)}\n"
                "Summarize this attack path in two short paragraphs for a penetration test write-up."
            ),
            replacements,
        )
        chunks: list[str] = []
        try:
            async for chunk in provider.chat_stream(
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You summarize attack paths for offensive security reports. "
                            "Keep the summary concrete and concise."
                        ),
                    },
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.2,
                max_tokens=250,
            ):
                if chunk.content:
                    chunks.append(chunk.content)
        except Exception:
            return None
        summary = "".join(chunks).strip()
        return summary or None

    def _build_secret_replacements(self, nodes: list[GraphNode]) -> dict[str, str]:
        replacements: dict[str, str] = {}
        for node in nodes:
            for key, value in (node.meta or {}).items():
                if key not in _SENSITIVE_META_KEYS or not isinstance(value, str):
                    continue
                sanitized = value if "*" in value else self._mask_secret(value)
                replacements[value] = sanitized
        return dict(sorted(replacements.items(), key=lambda item: len(item[0]), reverse=True))

    def _sanitize_text(self, text: str, replacements: dict[str, str]) -> str:
        cleaned = text
        for raw_value, masked_value in replacements.items():
            if raw_value:
                cleaned = cleaned.replace(raw_value, masked_value)
        return cleaned

    def _mask_secret(self, value: str) -> str:
        if len(value) <= 4:
            return "*" * len(value)
        if len(value) <= 8:
            return f"{value[:2]}{'*' * max(len(value) - 2, 2)}"
        return f"{value[:4]}{'*' * 8}{value[-2:]}"

    def _truncate(self, text: str, limit: int = 900) -> str:
        if len(text) <= limit:
            return text
        return f"{text[:limit].rstrip()}\n...[truncated]"

    def _string(self, value: object) -> str | None:
        if value is None:
            return None
        return str(value)
