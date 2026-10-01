"""Context builder for AI chat messages.

Assembles project data (variables, timeline, credentials, findings, commands,
attack graph, engagement phase) into a structured markdown context block
that gets sent alongside user messages to the LLM.
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.command_history import CommandHistory
from app.models.credential import Credential, Flag
from app.models.project import Project
from app.models.timeline import Timeline
from app.services.base import BaseService

if TYPE_CHECKING:
    from app.schemas.engagement import EngagementStateBase

# Preset configurations
_PRESETS: dict[str, dict] = {
    "minimal": {
        "include_project": True,
        "include_variables": True,
        "include_timeline": False,
        "include_findings": False,
        "include_credentials": False,
        "include_commands": False,
        "timeline_limit": 0,
        "commands_limit": 0,
        "commands_output_max_lines": 0,
    },
    "standard": {
        "include_project": True,
        "include_variables": True,
        "include_timeline": True,
        "include_findings": True,
        "include_credentials": False,
        "include_commands": True,
        "timeline_limit": 20,
        "commands_limit": 10,
        "commands_output_max_lines": 50,
    },
    "full": {
        "include_project": True,
        "include_variables": True,
        "include_timeline": True,
        "include_findings": True,
        "include_credentials": True,
        "include_commands": True,
        "timeline_limit": 100,
        "commands_limit": 50,
        "commands_output_max_lines": 100,
    },
    "agent": {
        "include_project": True,
        "include_variables": True,
        "include_timeline": True,
        "include_findings": True,
        "include_credentials": True,
        "include_commands": True,
        "include_attack_graph": True,
        "include_engagement_phase": True,
        "timeline_limit": 30,
        "commands_limit": 20,
        "commands_output_max_lines": 30,
    },
    "reporting": {
        "include_project": True,
        "include_variables": True,
        "include_timeline": True,
        "include_findings": True,
        "include_credentials": True,
        "include_commands": True,
        "include_attack_graph": True,
        "include_engagement_phase": True,
        "timeline_limit": 20,
        "commands_limit": 12,
        "commands_output_max_lines": 20,
    },
}

_CONTEXT_VARIABLE_LABELS: tuple[tuple[str, str], ...] = (
    ("engagement_kind", "Engagement Type"),
    ("platform_name", "Platform"),
    ("platform_url", "Platform URL"),
    ("platform_content_type", "Content Type"),
    ("platform_target_name", "Target Name"),
    ("platform_target_slug", "Target Slug"),
    ("platform_difficulty", "Difficulty"),
    ("target_ip", "Target IP"),
    ("target_domain", "Target Domain"),
    ("os", "OS"),
    ("scope", "Scope"),
    ("objective", "Objective"),
    ("constraints", "Constraints"),
    ("notes", "Notes"),
)
_SPECIAL_VARIABLE_KEYS = {key for key, _label in _CONTEXT_VARIABLE_LABELS} | {
    "ai_briefing"
}


class ContextBuilder(BaseService):
    """Builds structured context from project data for AI prompts."""

    def __init__(self, db: AsyncSession):
        super().__init__("service.context_builder")
        self.db = db

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def build(
        self,
        project_id: str,
        preset: str = "standard",
        overrides: dict | None = None,
    ) -> str:
        """Build context string from project data.

        Args:
            project_id: The project to build context for.
            preset: One of "minimal", "standard", "full".
            overrides: Optional dict to override preset settings.

        Returns:
            Markdown-formatted context string, or "" if project not found.
        """
        project = await self._get_project(project_id)
        if project is None:
            return ""

        cfg = self._get_preset_config(preset)
        if overrides:
            cfg.update(overrides)

        sections: list[str] = []

        if cfg.get("include_project"):
            sections.append(self._format_project(project))

        if cfg.get("include_variables") and project.variables:
            variables_str = self._format_variables(project.variables)
            if variables_str:
                sections.append(variables_str)

        if cfg.get("include_timeline"):
            limit = cfg.get("timeline_limit", 20)
            entries = await self._get_timeline(project_id, limit)
            timeline_str = self._format_timeline(entries)
            if timeline_str:
                sections.append(timeline_str)

        if cfg.get("include_findings"):
            findings = await self._get_findings(project_id)
            findings_str = self._format_findings(findings)
            if findings_str:
                sections.append(findings_str)

        if cfg.get("include_credentials"):
            creds = await self._get_credentials(project_id)
            creds_str = self._format_credentials(creds)
            if creds_str:
                sections.append(creds_str)

            flags = await self._get_flags(project_id)
            flags_str = self._format_flags(flags)
            if flags_str:
                sections.append(flags_str)

        if cfg.get("include_commands"):
            limit = cfg.get("commands_limit", 10)
            max_lines = cfg.get("commands_output_max_lines", 50)
            commands = await self._get_commands(project_id, limit)
            commands_str = self._format_commands(commands, max_lines)
            if commands_str:
                sections.append(commands_str)

        if cfg.get("include_attack_graph") or cfg.get("include_engagement_phase"):
            engagement_state = await self._get_engagement_state(project_id)
            if cfg.get("include_attack_graph"):
                graph_str = self._format_attack_graph(engagement_state)
                if graph_str:
                    sections.append(graph_str)
            if cfg.get("include_engagement_phase"):
                phase_str = self._format_engagement_phase(engagement_state)
                if phase_str:
                    sections.append(phase_str)

        return "\n\n".join(sections)

    # ------------------------------------------------------------------
    # Preset helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _get_preset_config(preset: str) -> dict:
        """Return a mutable copy of preset config."""
        base = _PRESETS.get(preset, _PRESETS["standard"])
        return dict(base)

    # ------------------------------------------------------------------
    # Data fetching
    # ------------------------------------------------------------------

    async def _get_project(self, project_id: str) -> Project | None:
        stmt = select(Project).where(Project.id == project_id)
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def _get_timeline(self, project_id: str, limit: int) -> list[Timeline]:
        stmt = (
            select(Timeline)
            .where(Timeline.project_id == project_id)
            .order_by(Timeline.created_at.desc())
            .limit(limit)
        )
        result = await self.db.execute(stmt)
        # Return chronological order (oldest first)
        return list(reversed(result.scalars().all()))

    async def _get_findings(self, project_id: str) -> list[Timeline]:
        """Get timeline entries of type 'finding'."""
        stmt = (
            select(Timeline)
            .where(Timeline.project_id == project_id, Timeline.type == "finding")
            .order_by(Timeline.created_at.desc())
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def _get_credentials(self, project_id: str) -> list[Credential]:
        stmt = (
            select(Credential)
            .where(Credential.project_id == project_id)
            .order_by(Credential.created_at.desc())
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def _get_flags(self, project_id: str) -> list[Flag]:
        stmt = (
            select(Flag)
            .where(Flag.project_id == project_id)
            .order_by(Flag.created_at.desc())
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def _get_commands(self, project_id: str, limit: int) -> list[CommandHistory]:
        """Get recent commands for the project."""
        stmt = (
            select(CommandHistory)
            .where(CommandHistory.project_id == project_id)
            .order_by(CommandHistory.created_at.desc())
            .limit(limit)
        )
        result = await self.db.execute(stmt)
        # Return chronological order (oldest first)
        return list(reversed(result.scalars().all()))

    async def _get_engagement_state(
        self, project_id: str
    ) -> EngagementStateBase | None:
        """Load engagement state for attack graph / phase context."""
        try:
            project = await self._get_project(project_id)
            if project is None:
                return None
            from app.services.engagement_provider_factory import (
                get_engagement_state_store,
            )

            store = get_engagement_state_store()
            return await store.read(project)
        except Exception:
            return None

    # ------------------------------------------------------------------
    # Formatters
    # ------------------------------------------------------------------

    @staticmethod
    def _format_project(project: Project) -> str:
        lines = [
            "## Current Project",
            f"- Name: {project.name}",
            f"- Type: {project.type}",
            f"- Status: {project.status}",
        ]
        return "\n".join(lines)

    @staticmethod
    def _format_variables(variables: dict) -> str:
        if not variables:
            return ""
        sections: list[str] = []

        context_str = ContextBuilder._format_engagement_context(variables)
        if context_str:
            sections.append(context_str)

        briefing_str = ContextBuilder._format_ai_briefing(variables)
        if briefing_str:
            sections.append(briefing_str)

        generic_lines = ["## Variables"]
        for key, value in variables.items():
            if key in _SPECIAL_VARIABLE_KEYS:
                continue
            generic_lines.append(f"- ${key} = {value}")

        if len(generic_lines) > 1:
            sections.append("\n".join(generic_lines))

        return "\n\n".join(sections)

    @staticmethod
    def _format_engagement_context(variables: dict) -> str:
        lines = ["## Engagement Context"]
        for key, label in _CONTEXT_VARIABLE_LABELS:
            value = variables.get(key)
            if value is None:
                continue
            if isinstance(value, str) and not value.strip():
                continue
            lines.append(f"- {label}: {value}")

        return "\n".join(lines) if len(lines) > 1 else ""

    @staticmethod
    def _format_ai_briefing(variables: dict) -> str:
        briefing = variables.get("ai_briefing")
        if not isinstance(briefing, str) or not briefing.strip():
            return ""
        return "\n".join(["## AI Briefing", briefing.strip()])

    @staticmethod
    def _format_timeline(entries: list[Timeline]) -> str:
        if not entries:
            return ""
        lines = [f"## Recent Timeline (last {len(entries)})"]
        for entry in entries:
            ts = entry.created_at.strftime("%Y-%m-%d %H:%M")
            lines.append(f"[{ts}] {entry.type.upper()}: {entry.content}")
            if entry.output:
                # Truncate long outputs
                output = entry.output
                if len(output) > 500:
                    output = output[:500] + "... (truncated)"
                lines.append(f"→ Output: {output}")
        return "\n".join(lines)

    @staticmethod
    def _format_findings(findings: list[Timeline]) -> str:
        if not findings:
            return ""
        lines = ["## Findings"]
        for f in findings:
            severity = f.entry_data.get("severity", "info") if f.entry_data else "info"
            lines.append(f"- [{severity.upper()}] {f.content}")
        return "\n".join(lines)

    @staticmethod
    def _format_credentials(credentials: list[Credential]) -> str:
        if not credentials:
            return ""
        lines = ["## Credentials"]
        for c in credentials:
            parts = []
            if c.username:
                parts.append(f"user={c.username}")
            if c.password:
                parts.append(f"pass={c.password}")
            if c.hash:
                parts.append(f"hash={c.hash}")
            if c.service:
                parts.append(f"service={c.service}")
            lines.append(f"- {' | '.join(parts)}")
        return "\n".join(lines)

    @staticmethod
    def _format_flags(flags: list[Flag]) -> str:
        if not flags:
            return ""
        lines = ["## Flags"]
        for f in flags:
            lines.append(f"- [{f.type}] {f.value}")
        return "\n".join(lines)

    @staticmethod
    def _format_attack_graph(state: EngagementStateBase | None) -> str:
        """Format attack graph summary (top 20 nodes max)."""
        if state is None or not state.graph.nodes:
            return ""
        nodes, edges = state.graph.nodes, state.graph.edges
        lines = [
            "## Attack Graph Summary",
            f"- Progress: {state.progress}%",
            f"- Nodes: {len(nodes)}, Edges: {len(edges)}",
        ]
        for node in nodes[:20]:
            status = f" [{node.status}]" if node.status else ""
            lines.append(f"  - {node.title}{status}: {node.subtitle}")
        return "\n".join(lines)

    @staticmethod
    def _format_engagement_phase(state: EngagementStateBase | None) -> str:
        """Format section completion with ACTIVE marker."""
        if state is None or not state.sections:
            return ""
        lines = ["## Current Engagement Phase"]
        for section in state.sections:
            total = len(section.items)
            done = sum(1 for i in section.items if i.status == "done")
            active = any(i.status == "active" for i in section.items)
            if active:
                lines.append(f"- **{section.label}** (ACTIVE): {done}/{total} complete")
            elif done == total and total > 0:
                lines.append(f"- {section.label}: COMPLETE ({total}/{total})")
            else:
                lines.append(f"- {section.label}: {done}/{total}")
        return "\n".join(lines)

    @staticmethod
    def _format_relative_time(dt: datetime) -> str:
        """Format a datetime as a relative time string."""
        now = datetime.now(UTC)
        # Ensure dt is timezone-aware
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        delta = now - dt
        seconds = int(delta.total_seconds())

        if seconds < 60:
            return "just now"
        if seconds < 3600:
            mins = seconds // 60
            return f"{mins}m ago"
        if seconds < 86400:
            hours = seconds // 3600
            return f"{hours}h ago"
        days = seconds // 86400
        return f"{days}d ago"

    @classmethod
    def _format_commands(cls, commands: list[CommandHistory], max_output_lines: int) -> str:
        """Format recent commands for AI context."""
        if not commands:
            return ""

        lines = [f"## Recent Commands (last {len(commands)})"]

        for cmd in commands:
            age = cls._format_relative_time(cmd.created_at)
            status = "\u2713" if cmd.exit_code == 0 else f"\u2717 exit {cmd.exit_code}"

            lines.append("```bash")
            lines.append(f"$ {cmd.command}    # [{status}, {age}]")

            # Add output preview (truncated)
            if cmd.output_preview and max_output_lines > 0:
                output_lines = cmd.output_preview.split("\n")[:max_output_lines]
                lines.extend(output_lines)
                if len(cmd.output_preview.split("\n")) > max_output_lines:
                    lines.append("... (output truncated)")

            lines.append("```")

        return "\n".join(lines)
