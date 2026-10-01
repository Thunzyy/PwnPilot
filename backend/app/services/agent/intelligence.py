"""Agent Intelligence Service -- MCP logging, auto-timeline, auto-KB scan notes.

Encapsulates three intelligence capabilities:
- EXT-02: Persist every MCP tool call to agent_mcp_logs
- INT-03: Auto-create timeline entries for significant tool calls
- INT-04: Auto-create KB notes for scan command outputs

All operations are fire-and-forget: exceptions are logged but never
propagate to block tool execution.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger

log = get_logger("agent.intelligence")


class AgentIntelligenceService:
    """Process agent MCP tool calls and extract intelligence."""

    # Pentest scan tools that trigger auto-KB note creation
    SCAN_TOOLS: frozenset[str] = frozenset({
        "nmap", "gobuster", "nikto", "ffuf", "dirb",
        "feroxbuster", "sqlmap", "wpscan", "nuclei",
        "masscan", "enum4linux", "smbclient", "rpcclient",
        "ldapsearch", "crackmapexec",
    })

    # Tool calls that create timeline entries (tool_name -> entry type)
    _SIGNIFICANT_TOOLS: dict[str, str] = {
        "terminal_run_command": "command",
        "kb_create_doc": "note",
        "graph_add_node": "note",
        "project_update_variables": "note",
    }

    # Tool calls that already manage their own timeline entries
    _SKIP_TOOLS: frozenset[str] = frozenset({
        "timeline_add", "timeline_update", "timeline_delete",
    })

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------

    async def process_tool_call(
        self,
        tool_name: str,
        args: dict[str, Any],
        result: Any,
        duration_ms: int,
        success: bool,
        project_id: str,
        user_id: str,
        mcp_session_id: str,
        agent_process_id: str | None = None,
    ) -> None:
        """Process a completed MCP tool call through all intelligence paths.

        All three paths are wrapped in individual try/except blocks
        so failures in one path never affect the others or the caller.
        """
        # EXT-02: Always log the MCP call
        try:
            await self._log_mcp_call(
                tool_name=tool_name,
                args=args,
                result=result,
                duration_ms=duration_ms,
                success=success,
                project_id=project_id,
                mcp_session_id=mcp_session_id,
                agent_process_id=agent_process_id,
            )
        except Exception:
            log.warning(
                "Failed to log MCP call",
                tool_name=tool_name,
                project_id=project_id,
            )

        # INT-03: Auto-create timeline entry for significant tools
        if (
            tool_name not in self._SKIP_TOOLS
            and success
            and tool_name in self._SIGNIFICANT_TOOLS
        ):
            try:
                await self._create_timeline_entry(
                    project_id=project_id,
                    entry_type=self._SIGNIFICANT_TOOLS[tool_name],
                    tool_name=tool_name,
                    args=args,
                    result=result,
                    agent_process_id=agent_process_id,
                )
            except Exception:
                log.warning(
                    "Failed to create timeline entry",
                    tool_name=tool_name,
                    project_id=project_id,
                )

        # INT-04: Auto-create KB note for scan outputs
        if tool_name == "terminal_run_command" and success:
            command = args.get("command", "")
            output = self._extract_output(result)
            if (
                self._is_scan_command(command)
                and output
                and len(output.strip()) >= 50
            ):
                try:
                    await self._create_scan_note(
                        command=command,
                        output=output,
                        project_id=project_id,
                        user_id=user_id,
                    )
                except Exception:
                    log.warning(
                        "Failed to create scan note",
                        command=command[:80],
                        project_id=project_id,
                    )

    # ------------------------------------------------------------------
    # EXT-02: MCP call logging
    # ------------------------------------------------------------------

    async def _log_mcp_call(
        self,
        tool_name: str,
        args: dict[str, Any],
        result: Any,
        duration_ms: int,
        success: bool,
        project_id: str,
        mcp_session_id: str,
        agent_process_id: str | None,
    ) -> None:
        """Persist a single MCP tool call to the database."""
        from app.mcp.hooks import truncate_result
        from app.models.agent_mcp_log import AgentMCPLog

        record = AgentMCPLog(
            project_id=project_id,
            agent_process_id=agent_process_id,
            session_id=mcp_session_id,
            tool_name=tool_name,
            tool_args=args,
            tool_result=truncate_result(result, 10000),
            success=success,
            error=str(result) if not success and result else None,
            duration_ms=duration_ms,
        )
        self.db.add(record)
        await self.db.flush()

    # ------------------------------------------------------------------
    # INT-03: Auto-timeline entries
    # ------------------------------------------------------------------

    async def _create_timeline_entry(
        self,
        project_id: str,
        entry_type: str,
        tool_name: str,
        args: dict[str, Any],
        result: Any,
        agent_process_id: str | None = None,
    ) -> None:
        """Create a timeline entry for a significant tool call."""
        from app.models.timeline import Timeline

        content = self._format_timeline_content(tool_name, args, result)
        entry = Timeline(
            project_id=project_id,
            type=entry_type,
            content=content,
            entry_data={
                "source": "agent",
                "agent_process_id": agent_process_id,
                "tool_name": tool_name,
            },
        )
        self.db.add(entry)
        await self.db.flush()

    @staticmethod
    def _format_timeline_content(
        tool_name: str, args: dict[str, Any], result: Any
    ) -> str:
        """Format a human-readable timeline content string."""
        if tool_name == "terminal_run_command":
            cmd = args.get("command", "unknown")
            if len(cmd) > 200:
                cmd = cmd[:200] + "..."
            return f"[Agent] {cmd}"

        if tool_name == "kb_create_doc":
            title = args.get("title", "Untitled")
            return f"[Agent] Created KB note: {title}"

        if tool_name == "graph_add_node":
            title = args.get("title", "Unknown")
            return f"[Agent] Added attack graph node: {title}"

        if tool_name == "project_update_variables":
            variables = args.get("variables", {})
            if isinstance(variables, dict):
                pairs = ", ".join(
                    f"{k}={v}" for k, v in list(variables.items())[:5]
                )
                return f"[Agent] Updated variables: {pairs}"
            return "[Agent] Updated project variables"

        return f"[Agent] {tool_name}"

    # ------------------------------------------------------------------
    # INT-04: Scan detection + auto-KB notes
    # ------------------------------------------------------------------

    @classmethod
    def _is_scan_command(cls, command: str) -> bool:
        """Check if the command invokes a known pentest scan tool."""
        parts = command.strip().split()
        if not parts:
            return False
        first_word = parts[0]
        # Handle sudo prefix
        if first_word == "sudo" and len(parts) > 1:
            first_word = parts[1]
        return first_word in cls.SCAN_TOOLS

    @staticmethod
    def _extract_output(result: Any) -> str | None:
        """Extract text output from a tool result."""
        if result is None:
            return None
        if isinstance(result, dict):
            return result.get("output") or result.get("stdout")
        if isinstance(result, str):
            return result
        return None

    @staticmethod
    def _extract_scan_metadata(command: str) -> dict[str, str]:
        """Extract tool name and full command from a scan command."""
        parts = command.strip().split()
        if not parts:
            return {"tool": "unknown", "command": command}
        tool = parts[0]
        if tool == "sudo" and len(parts) > 1:
            tool = parts[1]
        return {"tool": tool, "command": command}

    async def _create_scan_note(
        self,
        command: str,
        output: str,
        project_id: str,
        user_id: str,
    ) -> str | None:
        """Create a KB note with the full scan output.

        Returns the created doc ID, or None if no writable source found.
        """
        from sqlalchemy import select

        from app.models.knowledge import KnowledgeSource
        from app.services.kb_service import KBService

        meta = self._extract_scan_metadata(command)
        tool = meta["tool"]
        timestamp = datetime.now(UTC).strftime("%Y%m%d-%H%M")
        title = f"{tool}-scan-{timestamp}"

        # Find a writable KB source for this project
        result = await self.db.execute(
            select(KnowledgeSource)
            .where(
                KnowledgeSource.project_id == project_id,
                KnowledgeSource.read_only.is_(False),
            )
            .order_by(KnowledgeSource.created_at)
            .limit(1)
        )
        source = result.scalar_one_or_none()
        if not source:
            log.warning(
                "No writable KB source found for scan note",
                project_id=project_id,
                tool=tool,
            )
            return None

        # Build markdown body with frontmatter
        body = (
            f"---\n"
            f"title: {title}\n"
            f"tags:\n"
            f"  - {tool}\n"
            f"  - agent-scan\n"
            f"  - auto-generated\n"
            f"---\n\n"
            f"## Command\n\n"
            f"```bash\n{command}\n```\n\n"
            f"## Output\n\n"
            f"```\n{output}\n```\n"
        )

        kb = KBService(self.db)
        doc = await kb.create_doc(source.id, "agent-scans", f"{title}.md")
        doc = await kb.save_doc(doc.id, body)
        return doc.id

    # ------------------------------------------------------------------
    # Maintenance
    # ------------------------------------------------------------------

    @classmethod
    async def cleanup_old_logs(
        cls, db: AsyncSession, retention_days: int = 90
    ) -> int:
        """Delete MCP log entries older than retention_days.

        Returns the number of rows deleted.
        """
        from app.models.agent_mcp_log import AgentMCPLog

        cutoff = datetime.now(UTC) - timedelta(days=retention_days)
        result = await db.execute(
            sa_delete(AgentMCPLog).where(AgentMCPLog.created_at < cutoff)
        )
        count = result.rowcount
        await db.flush()
        log.info("Cleaned up old MCP logs", deleted=count, retention_days=retention_days)
        return count
