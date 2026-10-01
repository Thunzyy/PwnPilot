"""Engagement state data providers.

These abstractions isolate data access from derivation logic so the current
local implementation can be swapped with a future MCP-backed source.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

import httpx
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai import AIChatMessage, AIConversation, AIMemory
from app.models.command_history import CommandHistory
from app.models.graph import GraphNodeDB
from app.models.knowledge import KnowledgeDoc
from app.models.project import Project
from app.models.timeline import Timeline
from app.models.timeline_kb_link import TimelineKBLink
from app.schemas.engagement import EngagementStateBase
from app.services.mitre_catalog import (
    build_mitre_search_context,
    extract_mitre_technique_ids,
    format_mitre_summary,
    infer_section_id_from_mitre,
)


@dataclass(frozen=True)
class EngagementHistoryEvent:
    id: str
    command: str
    exit_code: int
    created_at: datetime
    kind: str = "command"
    title: str | None = None
    subtitle: str | None = None
    icon: str | None = None
    tool_hint: str | None = None
    section_hint: str | None = None
    mitre_techniques: tuple[str, ...] = ()


class EngagementEventProvider(Protocol):
    async def list_events(
        self,
        *,
        db: AsyncSession,
        project_id: str,
    ) -> list[EngagementHistoryEvent]:
        """Return ordered engagement events for a project."""


class EngagementStateStore(Protocol):
    async def read(self, project: Project) -> EngagementStateBase | None:
        """Read persisted engagement state if present."""

    async def write(self, project: Project, state: EngagementStateBase) -> None:
        """Persist engagement state on the project."""


class CommandHistoryEventProvider:
    """Local provider backed by `command_history` table."""

    async def list_events(
        self,
        *,
        db: AsyncSession,
        project_id: str,
    ) -> list[EngagementHistoryEvent]:
        result = await db.execute(
            select(CommandHistory)
            .where(CommandHistory.project_id == project_id)
            .order_by(CommandHistory.created_at.asc())
        )
        events: list[EngagementHistoryEvent] = []
        for row in result.scalars().all():
            created_at = getattr(row, "created_at", None)
            if not isinstance(created_at, datetime):
                created_at = datetime.now(UTC)
            command = getattr(row, "command", "") or ""
            exit_code = int(getattr(row, "exit_code", 0) or 0)
            events.append(
                EngagementHistoryEvent(
                    id=str(getattr(row, "id", "")),
                    command=command,
                    exit_code=exit_code,
                    created_at=created_at,
                    kind="command",
                )
            )
        return events


class GraphEventProvider:
    """Local provider backed by accepted attack graph nodes.

    The attack graph is a higher-confidence state signal than raw terminal
    history: it may contain validated findings, loot, and sessions even when
    the originating command was not captured or was imported later.
    """

    _TYPE_ICONS: dict[str, str] = {
        "host": "dns",
        "service": "lan",
        "credential": "key",
        "session": "terminal",
        "finding": "flag",
        "loot": "inventory_2",
        "user": "person",
        "action": "travel_explore",
        "artifact": "description",
    }

    async def list_events(
        self,
        *,
        db: AsyncSession,
        project_id: str,
    ) -> list[EngagementHistoryEvent]:
        result = await db.execute(
            select(GraphNodeDB)
            .where(
                GraphNodeDB.project_id == project_id,
                GraphNodeDB.is_deleted.is_(False),
            )
            .order_by(GraphNodeDB.sequence_index.asc(), GraphNodeDB.created_at.asc())
        )

        events: list[EngagementHistoryEvent] = []
        for node in result.scalars().all():
            label = (getattr(node, "label", "") or "").strip()
            node_type = (getattr(node, "type", "") or "").strip().lower()
            notes = (getattr(node, "notes", "") or "").strip()
            tags = [str(tag) for tag in (getattr(node, "tags", []) or []) if tag]
            meta_json = getattr(node, "meta_json", {}) or {}
            meta_values = [
                str(value)
                for value in meta_json.values()
                if isinstance(value, str) and value.strip()
            ]

            search_text = " ".join(
                part
                for part in (
                    node_type,
                    label,
                    notes,
                    " ".join(tags),
                    " ".join(meta_values),
                )
                if part
            ).strip()
            if not search_text:
                continue

            created_at = getattr(node, "created_at", None)
            if not isinstance(created_at, datetime):
                created_at = datetime.now(UTC)

            events.append(
                EngagementHistoryEvent(
                    id=f"graph-node:{getattr(node, 'id', '')}",
                    command=search_text,
                    exit_code=0,
                    created_at=created_at,
                    kind="graph_node",
                    title=label or "Attack graph node",
                    subtitle=f"Attack graph node: {node_type or 'entity'}",
                    icon=self._TYPE_ICONS.get(node_type, "hub"),
                    tool_hint="attack_graph",
                    section_hint=self._infer_section_hint(
                        node_type=node_type,
                        search_text=search_text,
                    ),
                )
            )

        return events

    @staticmethod
    def _infer_section_hint(*, node_type: str, search_text: str) -> str | None:
        lowered = search_text.lower()
        if any(
            marker in lowered
            for marker in ("loot", "flag", "user.txt", "root.txt", "cat /home/", "cat /root/")
        ):
            return "postexp"
        if any(
            marker in lowered
            for marker in ("privesc", "cap_setuid", "root session", "setuid", "getcap", "suid")
        ):
            return "privesc"
        if node_type in {"host", "service"}:
            return "recon"
        if node_type in {"credential", "session", "action"}:
            return "exploitation"
        return None


class TimelineEventProvider:
    """Local provider backed by `timeline` plus optional linked KB metadata."""

    _TYPE_LABELS: dict[str, str] = {
        "note": "Timeline note",
        "finding": "Timeline finding",
        "credential": "Timeline credential",
        "loot": "Timeline loot",
        "command": "Timeline command",
    }

    _TYPE_ICONS: dict[str, str] = {
        "note": "sticky_note_2",
        "finding": "flag",
        "credential": "key",
        "loot": "inventory_2",
        "command": "terminal",
    }

    async def list_events(
        self,
        *,
        db: AsyncSession,
        project_id: str,
    ) -> list[EngagementHistoryEvent]:
        result = await db.execute(
            select(Timeline)
            .where(Timeline.project_id == project_id)
            .order_by(Timeline.created_at.asc())
        )
        entries = result.scalars().all()
        if not entries:
            return []

        entry_ids = [entry.id for entry in entries]
        docs_result = await db.execute(
            select(
                TimelineKBLink.timeline_entry_id,
                KnowledgeDoc.title,
                KnowledgeDoc.relative_path,
                KnowledgeDoc.tags,
            )
            .join(KnowledgeDoc, TimelineKBLink.doc_id == KnowledgeDoc.id)
            .where(TimelineKBLink.timeline_entry_id.in_(entry_ids))
        )

        linked_docs_by_entry: dict[str, list[tuple[str, str, str | None]]] = {}
        for timeline_entry_id, title, relative_path, tags in docs_result.all():
            linked_docs_by_entry.setdefault(timeline_entry_id, []).append(
                (title, relative_path, tags)
            )

        events: list[EngagementHistoryEvent] = []
        for entry in entries:
            created_at = getattr(entry, "created_at", None)
            if not isinstance(created_at, datetime):
                created_at = datetime.now(UTC)

            content = (getattr(entry, "content", "") or "").strip()
            output = (getattr(entry, "output", "") or "").strip()
            entry_type = (getattr(entry, "type", "") or "note").strip().lower() or "note"
            linked_docs = linked_docs_by_entry.get(entry.id, [])
            linked_doc_tags = [tags for _, _, tags in linked_docs if tags]
            mitre_techniques = extract_mitre_technique_ids(
                content,
                output,
                *linked_doc_tags,
            )
            mitre_search_context = build_mitre_search_context(mitre_techniques)

            search_parts = [content, output]
            for title, relative_path, tags in linked_docs:
                search_parts.extend([title, relative_path, tags or ""])
            if mitre_search_context:
                search_parts.append(mitre_search_context)

            search_text = " ".join(part for part in search_parts if part).strip()
            if not search_text:
                continue

            base_label = self._TYPE_LABELS.get(entry_type, "Timeline event")
            subtitle_parts = [base_label]
            if len(linked_docs) == 1:
                subtitle_parts.append(f"Linked KB: {linked_docs[0][0]}")
            elif len(linked_docs) > 1:
                subtitle_parts.append(f"Linked KB: {len(linked_docs)} docs")

            mitre_summary = format_mitre_summary(mitre_techniques)
            if mitre_summary:
                subtitle_parts.append(mitre_summary)

            events.append(
                EngagementHistoryEvent(
                    id=entry.id,
                    command=search_text,
                    exit_code=0,
                    created_at=created_at,
                    kind="timeline",
                    title=content or base_label,
                    subtitle=" • ".join(subtitle_parts),
                    icon=self._TYPE_ICONS.get(entry_type, "sticky_note_2"),
                    tool_hint=None,
                    section_hint=infer_section_id_from_mitre(mitre_techniques),
                    mitre_techniques=mitre_techniques,
                )
            )

        return events


class AISignalEventProvider:
    """Local provider backed by persisted AI chat messages and memories."""

    async def list_events(
        self,
        *,
        db: AsyncSession,
        project_id: str,
    ) -> list[EngagementHistoryEvent]:
        events = [
            *await self._list_conversation_events(db=db, project_id=project_id),
            *await self._list_memory_events(db=db, project_id=project_id),
        ]
        events.sort(key=lambda event: (event.created_at, event.id))
        return events

    async def _list_conversation_events(
        self,
        *,
        db: AsyncSession,
        project_id: str,
    ) -> list[EngagementHistoryEvent]:
        result = await db.execute(
            select(AIChatMessage, AIConversation.title)
            .join(AIConversation, AIChatMessage.conversation_id == AIConversation.id)
            .where(AIConversation.project_id == project_id)
            .order_by(AIChatMessage.created_at.asc())
        )

        events: list[EngagementHistoryEvent] = []
        for message, conversation_title in result.all():
            role = (getattr(message, "role", "") or "").strip().lower()
            if role not in {"user", "assistant"}:
                continue

            content = (getattr(message, "content", "") or "").strip()
            if not content:
                continue

            created_at = getattr(message, "created_at", None)
            if not isinstance(created_at, datetime):
                created_at = datetime.now(UTC)

            title = conversation_title.strip() if isinstance(conversation_title, str) else ""
            mitre_techniques = extract_mitre_technique_ids(content, title)
            mitre_search_context = build_mitre_search_context(mitre_techniques)

            search_parts = [content, title, mitre_search_context]
            subtitle_parts = [
                "AI assistant" if role == "assistant" else "AI operator prompt"
            ]
            if title and title != "New Chat":
                subtitle_parts.append(title)
            mitre_summary = format_mitre_summary(mitre_techniques)
            if mitre_summary:
                subtitle_parts.append(mitre_summary)

            error = getattr(message, "error", None)
            events.append(
                EngagementHistoryEvent(
                    id=str(getattr(message, "id", "")),
                    command=" ".join(part for part in search_parts if part).strip(),
                    exit_code=1 if isinstance(error, str) and error.strip() else 0,
                    created_at=created_at,
                    kind="ai",
                    title=content,
                    subtitle=" • ".join(subtitle_parts),
                    icon="smart_toy" if role == "assistant" else "forum",
                    tool_hint=None,
                    section_hint=infer_section_id_from_mitre(mitre_techniques),
                    mitre_techniques=mitre_techniques,
                )
            )

        return events

    async def _list_memory_events(
        self,
        *,
        db: AsyncSession,
        project_id: str,
    ) -> list[EngagementHistoryEvent]:
        result = await db.execute(
            select(AIMemory)
            .where(AIMemory.project_id == project_id)
            .order_by(AIMemory.created_at.asc())
        )

        events: list[EngagementHistoryEvent] = []
        for memory in result.scalars().all():
            value = (getattr(memory, "value", "") or "").strip()
            key = (getattr(memory, "key", "") or "").strip()
            if not value and not key:
                continue

            created_at = getattr(memory, "created_at", None)
            if not isinstance(created_at, datetime):
                created_at = datetime.now(UTC)

            mitre_techniques = extract_mitre_technique_ids(key, value)
            mitre_search_context = build_mitre_search_context(mitre_techniques)

            subtitle_parts = ["AI memory"]
            if key:
                subtitle_parts.append(key)
            mitre_summary = format_mitre_summary(mitre_techniques)
            if mitre_summary:
                subtitle_parts.append(mitre_summary)

            title = value or key
            events.append(
                EngagementHistoryEvent(
                    id=str(getattr(memory, "id", "")),
                    command=" ".join(
                        part for part in (key, value, mitre_search_context) if part
                    ).strip(),
                    exit_code=0,
                    created_at=created_at,
                    kind="ai-memory",
                    title=title,
                    subtitle=" • ".join(subtitle_parts),
                    icon="psychology",
                    tool_hint=None,
                    section_hint=infer_section_id_from_mitre(mitre_techniques),
                    mitre_techniques=mitre_techniques,
                )
            )

        return events


class MergedEngagementEventProvider:
    """Merge multiple local engagement event providers into a single stream."""

    def __init__(self, *providers: EngagementEventProvider):
        self.providers = providers

    async def list_events(
        self,
        *,
        db: AsyncSession,
        project_id: str,
    ) -> list[EngagementHistoryEvent]:
        events: list[EngagementHistoryEvent] = []
        for provider in self.providers:
            events.extend(await provider.list_events(db=db, project_id=project_id))
        events.sort(key=lambda event: (event.created_at, event.id))
        return events


class McpEngagementEventProvider:
    """Remote provider backed by an MCP event service endpoint.

    Expected payload formats:
    - {"events": [{id, command, exit_code, created_at}, ...]}
    - [{id, command, exit_code, created_at}, ...]
    """

    def __init__(
        self,
        *,
        base_url: str,
        timeout_seconds: float = 5.0,
        api_key: str | None = None,
        fallback_provider: EngagementEventProvider | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.api_key = api_key
        self.fallback_provider = fallback_provider

    async def list_events(
        self,
        *,
        db: AsyncSession,
        project_id: str,
    ) -> list[EngagementHistoryEvent]:
        if not self.base_url:
            return await self._fallback(db=db, project_id=project_id)

        url = f"{self.base_url}/projects/{project_id}/engagement-events"
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else None

        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                payload = response.json()
        except Exception:
            return await self._fallback(db=db, project_id=project_id)

        decoded = self._decode_events(payload)
        if decoded is None:
            return await self._fallback(db=db, project_id=project_id)
        return decoded

    async def _fallback(
        self,
        *,
        db: AsyncSession,
        project_id: str,
    ) -> list[EngagementHistoryEvent]:
        if self.fallback_provider is None:
            return []
        return await self.fallback_provider.list_events(db=db, project_id=project_id)

    def _decode_events(self, payload: object) -> list[EngagementHistoryEvent] | None:
        raw_events: object
        if isinstance(payload, dict):
            raw_events = payload.get("events")
        else:
            raw_events = payload

        if not isinstance(raw_events, list):
            return None

        parsed: list[EngagementHistoryEvent] = []
        for raw in raw_events:
            event = self._parse_event(raw)
            if event is not None:
                parsed.append(event)

        parsed.sort(key=lambda event: event.created_at)
        return parsed

    def _parse_event(self, raw: object) -> EngagementHistoryEvent | None:
        if not isinstance(raw, dict):
            return None

        raw_id = raw.get("id")
        raw_command = raw.get("command")
        raw_exit_code = raw.get("exit_code")
        raw_created_at = raw.get("created_at")

        if not isinstance(raw_id, str) or not raw_id.strip():
            return None
        if not isinstance(raw_command, str):
            return None
        if not isinstance(raw_created_at, str) or not raw_created_at.strip():
            return None

        try:
            exit_code = int(raw_exit_code)
        except (TypeError, ValueError):
            return None

        try:
            created_at = datetime.fromisoformat(raw_created_at.replace("Z", "+00:00"))
        except ValueError:
            return None

        return EngagementHistoryEvent(
            id=raw_id,
            command=raw_command,
            exit_code=exit_code,
            created_at=created_at,
            kind=str(raw.get("kind", "command") or "command"),
            title=raw.get("title") if isinstance(raw.get("title"), str) else None,
            subtitle=raw.get("subtitle")
            if isinstance(raw.get("subtitle"), str)
            else None,
            icon=raw.get("icon") if isinstance(raw.get("icon"), str) else None,
            tool_hint=raw.get("tool_hint")
            if isinstance(raw.get("tool_hint"), str)
            else None,
            section_hint=raw.get("section_hint")
            if isinstance(raw.get("section_hint"), str)
            else None,
            mitre_techniques=tuple(
                technique_id
                for technique_id in raw.get("mitre_techniques", [])
                if isinstance(technique_id, str)
            )
            if isinstance(raw.get("mitre_techniques"), list)
            else (),
        )


class McpEngagementStateStore:
    """Remote state store backed by an MCP state service endpoint."""

    def __init__(
        self,
        *,
        base_url: str,
        timeout_seconds: float = 5.0,
        api_key: str | None = None,
        fallback_store: EngagementStateStore | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.api_key = api_key
        self.fallback_store = fallback_store

    async def read(self, project: Project) -> EngagementStateBase | None:
        project_id = self._project_id(project)
        if not self.base_url or project_id is None:
            return await self._fallback_read(project)

        url = f"{self.base_url}/projects/{project_id}/engagement-state"
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else None

        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                payload = response.json()
            return EngagementStateBase.model_validate(payload)
        except httpx.HTTPStatusError as exc:
            # `404` means "no persisted state in MCP store yet", so callers can
            # derive state from events instead of using a stale local snapshot.
            if exc.response is not None and exc.response.status_code == 404:
                return None
            return await self._fallback_read(project)
        except Exception:
            return await self._fallback_read(project)

    async def write(self, project: Project, state: EngagementStateBase) -> None:
        project_id = self._project_id(project)
        if not self.base_url or project_id is None:
            await self._fallback_write(project, state)
            return

        url = f"{self.base_url}/projects/{project_id}/engagement-state"
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else None

        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.put(url, json=state.model_dump(), headers=headers)
                response.raise_for_status()
        except Exception:
            await self._fallback_write(project, state)

    def _project_id(self, project: Project) -> str | None:
        raw_project_id = getattr(project, "id", None)
        if raw_project_id is None:
            return None
        project_id = str(raw_project_id).strip()
        return project_id or None

    async def _fallback_read(self, project: Project) -> EngagementStateBase | None:
        if self.fallback_store is None:
            return None
        return await self.fallback_store.read(project)

    async def _fallback_write(self, project: Project, state: EngagementStateBase) -> None:
        if self.fallback_store is None:
            return
        await self.fallback_store.write(project, state)


class ProjectVariableEngagementStateStore:
    """Local store backed by serialized state in `project.variables`."""

    def __init__(self, *, storage_key: str = "__engagement_state_v1"):
        self.storage_key = storage_key

    async def read(self, project: Project) -> EngagementStateBase | None:
        if not isinstance(project.variables, dict):
            return None
        raw = project.variables.get(self.storage_key)
        if not isinstance(raw, str) or not raw:
            return None
        try:
            payload = json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            return None
        try:
            return EngagementStateBase.model_validate(payload)
        except ValidationError:
            return None

    async def write(self, project: Project, state: EngagementStateBase) -> None:
        variables = dict(project.variables or {})
        variables[self.storage_key] = state.model_dump_json()
        project.variables = variables
