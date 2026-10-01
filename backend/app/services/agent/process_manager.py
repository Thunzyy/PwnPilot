"""Agent process manager -- lifecycle control for CLI agent subprocesses.

Manages launching CLI agents (Claude Code, Codex CLI) in isolated tmux
sessions, monitoring their status, gracefully stopping with signal
escalation, and recovering stale processes after backend restarts.

This is a pure service layer -- no router dependencies.  The module
exports a singleton ``agent_process_manager`` following the same pattern
as ``mcp_session_manager``.
"""

from __future__ import annotations

import asyncio
import os
import shlex
import shutil
import signal
import socket
import subprocess
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth import create_mcp_token
from app.core.crypto import decrypt_api_key, decrypt_env_vars, get_or_create_key
from app.core.errors import ErrorCode
from app.core.exceptions import AppException
from app.core.logging import get_logger
from app.database import async_session_maker
from app.models.agent_config import AgentConfig
from app.models.agent_process import AgentProcessRecord
from app.models.project import Project
from app.services.agent.config_gen import (
    cleanup_config,
    generate_claude_code_config,
    generate_codex_config,
)
from app.services.context_builder import ContextBuilder
from app.services.port_pool import shared_port_pool
from app.services.provider_factory import get_provider

log = get_logger("agent.process")

_SUPPORTED_TYPES = {"claude_code", "codex", "custom"}


@dataclass
class AgentProcess:
    """Runtime tracking for a spawned agent process."""

    id: str
    agent_type: str
    project_id: str
    user_id: str
    tmux_session: str
    pid: int
    status: str  # starting | running | stopping | stopped | error
    mcp_config_path: str | None
    mcp_token: str | None
    created_at: datetime = field(
        default_factory=lambda: datetime.now(UTC)
    )
    stopped_at: datetime | None = None
    exit_code: int | None = None
    ttyd_port: int | None = None
    ttyd_process: Any = None
    websocket_url: str | None = None
    output_mode: str = "terminal"
    chat_log_path: str | None = None
    launch_script_path: str | None = None
    launch_command: str | None = None
    provider_kind: str = "tmux_ttyd"


class AgentProcessManager:
    """Manages CLI agent process lifecycle: launch, monitor, stop, recover."""

    def __init__(self) -> None:
        self._agents: dict[str, AgentProcess] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def launch_agent(
        self,
        agent_type: str,
        project_id: str,
        user_id: str,
        prompt: str,
        max_turns: int = 50,
        db_factory: Any = None,
        env_vars: dict[str, str] | None = None,
    ) -> AgentProcess:
        """Launch a CLI agent in an isolated tmux session.

        Args:
            agent_type: ``"claude_code"`` or ``"codex"``.
            project_id: Project to scope the agent to.
            user_id: User who owns the agent.
            prompt: Prompt text to pass to the agent CLI.
            max_turns: Maximum agent iterations (Claude Code only).
            db_factory: Async session maker for DB persistence.
            env_vars: Optional environment variables to inject into
                the tmux session.

        Returns:
            The ``AgentProcess`` runtime object.

        Raises:
            AppException: On invalid type, missing binary, or launch failure.
        """
        if agent_type not in _SUPPORTED_TYPES:
            raise AppException(
                ErrorCode.AGENT_INVALID_TYPE,
                f"Unsupported agent type: {agent_type}",
                {"agent_type": agent_type},
            )

        if agent_type == "custom":
            raise AppException(
                ErrorCode.AGENT_INVALID_TYPE,
                "Custom agents must be launched via launch_agent_from_config",
                {"agent_type": agent_type},
            )

        binary = "claude" if agent_type == "claude_code" else "codex"
        if shutil.which(binary) is None:
            raise AppException(
                ErrorCode.AGENT_BINARY_NOT_FOUND,
                f"Agent binary not found in PATH: {binary}",
                {"binary": binary},
            )

        short_id = uuid4().hex[:8]
        agent_id = f"{project_id}-{short_id}"
        tmux_session = f"ppagent-{project_id}-{short_id}"

        # Generate MCP auth token (60-min TTL) with agent process ID
        token = create_mcp_token(
            user_id, project_id, ttl_minutes=60, agent_process_id=agent_id
        )

        # Compute MCP URL: strip /api/v1 suffix and append /mcp
        base = settings.api_base_url
        if base.endswith("/api/v1"):
            base = base[: -len("/api/v1")]
        mcp_url = f"{base}/mcp"

        # Generate config file and build command
        config_path: str | None = None
        try:
            if agent_type == "claude_code":
                config_path = generate_claude_code_config(mcp_url, token)
                cmd = self._build_claude_command(
                    prompt, config_path, max_turns
                )
            else:
                config_path = generate_codex_config(mcp_url)
                cmd = self._build_codex_command(prompt)

            # Create tmux session running the agent command
            tmux_args = [
                "new-session",
                "-d",
                "-s",
                tmux_session,
                "-x",
                "200",
                "-y",
                "50",
            ]

            if agent_type == "codex":
                tmux_args.extend(["-e", f"PP_MCP_TOKEN={token}"])
                # Codex uses CODEX_HOME for config location
                codex_home = str(Path(config_path).parent)
                tmux_args.extend(["-e", f"CODEX_HOME={codex_home}"])

            # Inject caller-provided environment variables
            if env_vars:
                for key, value in env_vars.items():
                    tmux_args.extend(["-e", f"{key}={value}"])

            tmux_args.extend(cmd)
            await self._run_tmux(*tmux_args)

            # Keep pane visible after agent exits so ttyd can still
            # show the full output (session survives process exit).
            await self._run_tmux(
                "set-option", "-t", tmux_session, "remain-on-exit", "on"
            )

            # Retrieve PID of the process inside the tmux pane
            pid_str = await self._run_tmux(
                "display-message",
                "-p",
                "-t",
                tmux_session,
                "#{pane_pid}",
            )
            pid = int(pid_str.strip())

        except AppException:
            # Re-raise validation errors without wrapping
            if config_path:
                cleanup_config(config_path)
            raise
        except Exception as exc:
            # Cleanup on any launch failure
            if config_path:
                cleanup_config(config_path)
            try:
                await self._run_tmux("kill-session", "-t", tmux_session)
            except Exception:
                pass
            log.error(
                "Agent launch failed",
                agent_type=agent_type,
                project_id=project_id,
                error=str(exc),
            )
            raise AppException(
                ErrorCode.AGENT_LAUNCH_FAILED,
                f"Failed to launch {agent_type} agent: {exc}",
                {"agent_type": agent_type, "project_id": project_id},
            ) from exc

        agent = AgentProcess(
            id=agent_id,
            agent_type=agent_type,
            project_id=project_id,
            user_id=user_id,
            tmux_session=tmux_session,
            pid=pid,
            status="running",
            mcp_config_path=config_path,
            mcp_token=token,
        )
        self._agents[agent_id] = agent

        # Persist to DB for crash recovery
        if db_factory is not None:
            try:
                async with db_factory() as db:
                    record = AgentProcessRecord(
                        id=agent_id,
                        project_id=project_id,
                        user_id=user_id,
                        agent_type=agent_type,
                        tmux_session=tmux_session,
                        pid=pid,
                        status="running",
                        mcp_config_path=config_path,
                        prompt=prompt,
                    )
                    db.add(record)
                    await db.commit()
            except Exception:
                log.warning(
                    "Failed to persist agent record",
                    agent_id=agent_id,
                )

        log.info(
            "Agent launched",
            agent_id=agent_id,
            agent_type=agent_type,
            tmux_session=tmux_session,
            pid=pid,
        )
        return agent

    async def stop_agent(
        self,
        agent_id: str,
        db_factory: Any = None,
        timeout: float = 5.0,
    ) -> None:
        """Stop an agent with SIGINT -> SIGTERM -> SIGKILL escalation.

        Args:
            agent_id: Agent identifier.
            db_factory: Async session maker for DB updates.
            timeout: Seconds to wait between escalation steps.

        Raises:
            AppException: If the agent is not found.
        """
        agent = self._agents.get(agent_id)
        if agent is None:
            raise AppException(
                ErrorCode.AGENT_NOT_FOUND,
                f"Agent not found: {agent_id}",
                {"agent_id": agent_id},
            )

        agent.status = "stopping"
        await self._update_db_status(agent_id, "stopping", db_factory)

        if agent.provider_kind != "tmux_ttyd":
            try:
                await get_provider().destroy_session(agent.tmux_session)
            except Exception:
                pass

            if agent.mcp_config_path:
                cleanup_config(agent.mcp_config_path)

            agent.status = "stopped"
            agent.stopped_at = datetime.now(UTC)

            if db_factory is not None:
                try:
                    async with db_factory() as db:
                        await db.execute(
                            update(AgentProcessRecord)
                            .where(AgentProcessRecord.id == agent_id)
                            .values(
                                status="stopped",
                                stopped_at=agent.stopped_at,
                            )
                        )
                        await db.commit()
                except Exception:
                    log.warning(
                        "Failed to update agent record on stop",
                        agent_id=agent_id,
                    )

            self._agents.pop(agent_id, None)
            log.info(
                "Agent stopped",
                agent_id=agent_id,
                provider=agent.provider_kind,
                session=agent.tmux_session,
            )
            return

        # Step 1: Send Ctrl-C via tmux (SIGINT to foreground process)
        try:
            await self._run_tmux(
                "send-keys", "-t", agent.tmux_session, "C-c", ""
            )
        except Exception:
            pass  # Session may already be dead

        # Step 2: Wait for graceful shutdown
        alive = await self._wait_for_exit(agent.pid, timeout)

        # Step 3: SIGTERM to process group
        if alive:
            alive = self._signal_process(agent.pid, signal.SIGTERM)

            if alive:
                alive = await self._wait_for_exit(agent.pid, timeout)

        # Step 4: SIGKILL to process group
        if alive:
            self._signal_process(agent.pid, self._force_kill_signal())

        # Step 5: Kill ttyd process and release port
        self._stop_ttyd(agent)

        # Step 6: Kill tmux session
        try:
            await self._run_tmux(
                "kill-session", "-t", agent.tmux_session
            )
        except Exception:
            pass  # Session already dead

        # Step 7: Delete MCP config temp file
        if agent.mcp_config_path:
            cleanup_config(agent.mcp_config_path)

        agent.status = "stopped"
        agent.stopped_at = datetime.now(UTC)

        # Update DB record
        if db_factory is not None:
            try:
                async with db_factory() as db:
                    await db.execute(
                        update(AgentProcessRecord)
                        .where(AgentProcessRecord.id == agent_id)
                        .values(
                            status="stopped",
                            stopped_at=agent.stopped_at,
                        )
                    )
                    await db.commit()
            except Exception:
                log.warning(
                    "Failed to update agent record on stop",
                    agent_id=agent_id,
                )

        # Remove from in-memory dict
        self._agents.pop(agent_id, None)

        log.info(
            "Agent stopped",
            agent_id=agent_id,
            tmux_session=agent.tmux_session,
        )

    async def get_agent(self, agent_id: str) -> AgentProcess | None:
        """Return an agent by ID, or None if not found."""
        return self._agents.get(agent_id)

    def list_agents(
        self, project_id: str | None = None
    ) -> list[AgentProcess]:
        """List all tracked agents, optionally filtered by project."""
        agents = list(self._agents.values())
        if project_id is not None:
            agents = [a for a in agents if a.project_id == project_id]
        return agents

    async def launch_agent_from_config(
        self,
        config_id: int,
        project_id: str,
        user_id: str,
        prompt: str,
        db: AsyncSession,
        output_mode: str = "terminal",
    ) -> AgentProcess:
        """Launch an agent using a saved AgentConfig.

        Creates an empty tmux shell first, starts ttyd so the browser
        can connect immediately, then runs the agent command via
        send-keys.  This guarantees terminal output is visible from
        the very first byte.

        Args:
            config_id: ID of the saved AgentConfig.
            project_id: Project to scope the agent to.
            user_id: User who owns the agent (must match config owner).
            prompt: User-provided prompt text.
            db: Active async database session.
            output_mode: ``"terminal"`` for interactive xterm view,
                ``"chat"`` for parsed stream-json view.

        Returns:
            The ``AgentProcess`` with ``websocket_url`` set.

        Raises:
            AppException: If config not found, not owned by user,
                or launch fails.
        """
        # Load and validate config
        config = await db.get(AgentConfig, config_id)
        if config is None or config.user_id != user_id:
            raise AppException(
                ErrorCode.AGENT_CONFIG_NOT_FOUND,
                f"Agent config not found: {config_id}",
                {"config_id": config_id},
            )

        # When no user prompt is provided, launch in interactive mode
        # (no -p flag) so the CLI opens as a REPL.  Context and system
        # prompt are only injected when the user provides actual input.
        interactive = not prompt.strip()

        if interactive:
            full_prompt = ""
        else:
            # Build project context with full pentest awareness
            context = await ContextBuilder(db).build(
                project_id, preset="agent"
            )

            # Compose full prompt with context
            parts = [context] if context else []
            if parts:
                full_prompt = "\n\n".join(parts) + f"\n\n---\n\n{prompt}"
            else:
                full_prompt = prompt

            # Prepend system prompt from config if set
            if config.system_prompt:
                full_prompt = f"{config.system_prompt}\n\n---\n\n{full_prompt}"

        # Decrypt secrets
        enc_key = get_or_create_key()
        env_dict: dict[str, str] = {}

        decrypted_env = decrypt_env_vars(
            config.env_vars_encrypted, enc_key
        )
        if decrypted_env:
            env_dict.update(decrypted_env)

        decrypted_api_key = decrypt_api_key(
            config.api_key_encrypted, enc_key
        )
        if decrypted_api_key and config.agent_type == "claude_code":
            env_dict["ANTHROPIC_API_KEY"] = decrypted_api_key

        # Custom agents bypass the shell+send-keys flow
        if config.agent_type == "custom":
            agent = await self._launch_custom_agent(
                config=config,
                project_id=project_id,
                user_id=user_id,
                full_prompt=full_prompt,
                env_vars=env_dict if env_dict else None,
            )
            port, ttyd_proc = await self._start_ttyd(agent.tmux_session)
            agent.ttyd_port = port
            agent.ttyd_process = ttyd_proc
            agent.websocket_url = f"ws://localhost:{port}/ws"
            return agent

        provider = get_provider()
        if provider.get_capabilities().provider != "tmux_ttyd":
            return await self._launch_standard_agent_via_console_provider(
                config=config,
                project_id=project_id,
                user_id=user_id,
                prompt=prompt,
                interactive=interactive,
                full_prompt=full_prompt,
                env_dict=env_dict,
                provider=provider,
            )

        # ---------------------------------------------------------
        # Standard agents: shell-first flow so ttyd captures output
        # ---------------------------------------------------------
        short_id = uuid4().hex[:8]
        agent_id = f"{project_id}-{short_id}"
        tmux_session = f"ppagent-{project_id}-{short_id}"

        # Generate MCP auth token
        token = create_mcp_token(
            user_id, project_id, ttl_minutes=60,
            agent_process_id=agent_id,
        )

        # Compute MCP URL
        base = settings.api_base_url
        if base.endswith("/api/v1"):
            base = base[: -len("/api/v1")]
        mcp_url = f"{base}/mcp"

        config_path: str | None = None

        try:
            # Generate MCP config
            if config.agent_type == "claude_code":
                config_path = generate_claude_code_config(mcp_url, token)
            else:
                config_path = generate_codex_config(mcp_url)

            # 1) Create empty tmux session (shell only)
            tmux_args = [
                "new-session", "-d", "-s", tmux_session,
                "-x", "200", "-y", "50",
            ]
            if config.agent_type == "codex":
                tmux_args.extend(["-e", f"PP_MCP_TOKEN={token}"])
                codex_home = str(Path(config_path).parent)
                tmux_args.extend(["-e", f"CODEX_HOME={codex_home}"])
            if env_dict:
                for key, value in env_dict.items():
                    tmux_args.extend(["-e", f"{key}={value}"])
            await self._run_tmux(*tmux_args)

            # 2) Keep pane alive after process exits
            await self._run_tmux(
                "set-option", "-t", tmux_session, "remain-on-exit", "on"
            )

            # 3) Start ttyd BEFORE running the command
            port, ttyd_proc = await self._start_ttyd(tmux_session)

            # 4) Write prompt to temp file (if provided)
            prompt_path: str | None = None
            if full_prompt.strip():
                prompt_path = f"/tmp/ppagent-{agent_id}-prompt.txt"
                Path(prompt_path).write_text(full_prompt)

            # 5) Build launch script (always terminal mode)
            script = self._build_launch_script(
                agent_type=config.agent_type,
                prompt_path=prompt_path,
                config_path=config_path,
                max_turns=config.max_turns,
            )

            script_path = f"/tmp/ppagent-{agent_id}-launch.sh"
            Path(script_path).write_text(script)
            os.chmod(script_path, 0o700)

            # NOTE: Do NOT send the command yet.  The frontend must
            # connect its xterm.js WebSocket first, then call the
            # /execute endpoint so every byte of output is visible.

            # 6) Get shell PID
            pid_str = await self._run_tmux(
                "display-message", "-p", "-t", tmux_session,
                "#{pane_pid}",
            )
            pid = int(pid_str.strip())

        except AppException:
            if config_path:
                cleanup_config(config_path)
            raise
        except Exception as exc:
            if config_path:
                cleanup_config(config_path)
            try:
                await self._run_tmux("kill-session", "-t", tmux_session)
            except Exception:
                pass
            log.error(
                "Agent launch failed",
                agent_type=config.agent_type,
                project_id=project_id,
                error=str(exc),
            )
            raise AppException(
                ErrorCode.AGENT_LAUNCH_FAILED,
                f"Failed to launch {config.agent_type} agent: {exc}",
                {"agent_type": config.agent_type, "project_id": project_id},
            ) from exc

        agent = AgentProcess(
            id=agent_id,
            agent_type=config.agent_type,
            project_id=project_id,
            user_id=user_id,
            tmux_session=tmux_session,
            pid=pid,
            status="starting",
            mcp_config_path=config_path,
            mcp_token=token,
            ttyd_port=port,
            ttyd_process=ttyd_proc,
            websocket_url=f"ws://localhost:{port}/ws",
            output_mode="terminal",
            launch_script_path=script_path,
        )
        self._agents[agent_id] = agent

        # Persist to DB for crash recovery
        try:
            async with async_session_maker() as db_sess:
                record = AgentProcessRecord(
                    id=agent_id,
                    project_id=project_id,
                    user_id=user_id,
                    agent_type=config.agent_type,
                    tmux_session=tmux_session,
                    pid=pid,
                    status="starting",
                    mcp_config_path=config_path,
                    prompt=prompt,
                )
                db_sess.add(record)
                await db_sess.commit()
        except Exception:
            log.warning(
                "Failed to persist agent record",
                agent_id=agent_id,
            )

        log.info(
            "Agent launched from config (awaiting execute)",
            agent_id=agent_id,
            config_id=config_id,
            output_mode=output_mode,
            ttyd_port=port,
        )
        return agent

    async def execute_agent_command(self, agent_id: str) -> AgentProcess:
        """Send the launch command to an agent's tmux session.

        Called by the frontend after its xterm.js WebSocket has connected,
        ensuring all terminal output is visible from the first byte.

        Args:
            agent_id: Agent identifier (must be in ``"starting"`` state).

        Returns:
            The updated ``AgentProcess`` with ``status="running"``.

        Raises:
            AppException: If agent not found or not in starting state.
        """
        agent = self._agents.get(agent_id)
        if agent is None:
            raise AppException(
                ErrorCode.AGENT_NOT_FOUND,
                f"Agent not found: {agent_id}",
                {"agent_id": agent_id},
            )

        if agent.status != "starting":
            raise AppException(
                ErrorCode.AGENT_LAUNCH_FAILED,
                f"Agent {agent_id} is not in starting state (current: {agent.status})",
                {"agent_id": agent_id, "status": agent.status},
            )

        if agent.provider_kind != "tmux_ttyd":
            if not agent.launch_command:
                raise AppException(
                    ErrorCode.AGENT_LAUNCH_FAILED,
                    f"Agent {agent_id} has no launch command",
                    {"agent_id": agent_id},
                )

            sent = await get_provider().send_input(
                agent.tmux_session,
                f"{agent.launch_command}\n",
            )
            if not sent:
                raise AppException(
                    ErrorCode.AGENT_LAUNCH_FAILED,
                    f"Failed to write launch command to session {agent.tmux_session}",
                    {"agent_id": agent_id, "session_id": agent.tmux_session},
                )
        else:
            if not agent.launch_script_path:
                raise AppException(
                    ErrorCode.AGENT_LAUNCH_FAILED,
                    f"Agent {agent_id} has no launch script",
                    {"agent_id": agent_id},
                )

            # Send the command to the tmux session
            await self._run_tmux(
                "send-keys", "-t", agent.tmux_session,
                f"bash {shlex.quote(agent.launch_script_path)}", "Enter",
            )

        agent.status = "running"
        await self._update_db_status(
            agent_id, "running", async_session_maker
        )

        log.info(
            "Agent command executed",
            agent_id=agent_id,
            tmux_session=agent.tmux_session,
        )
        return agent

    async def recover_stale_agents(self, db_factory: Any) -> int:
        """Clean up stale agent records and orphaned tmux sessions.

        Called on backend startup to reconcile DB records with actual
        process state.  Kills any processes that are still alive, removes
        orphaned tmux sessions, and deletes leftover MCP config files.

        Args:
            db_factory: Async session maker.

        Returns:
            Number of records cleaned up.
        """
        cleaned = 0

        async with db_factory() as db:
            result = await db.execute(
                select(AgentProcessRecord).where(
                    AgentProcessRecord.status.in_(
                        ["starting", "running", "stopping"]
                    )
                )
            )
            records = result.scalars().all()
            known_sessions: set[str] = set()

            for record in records:
                known_sessions.add(record.tmux_session)
                pid_alive = self._is_pid_alive(record.pid)

                if pid_alive:
                    # Attempt graceful kill
                    self._signal_process(record.pid, signal.SIGTERM)

                    await asyncio.sleep(2)

                    # Force kill if still alive
                    if self._is_pid_alive(record.pid):
                        self._signal_process(
                            record.pid,
                            self._force_kill_signal(),
                        )

                # Kill tmux session
                try:
                    await self._run_tmux(
                        "kill-session", "-t", record.tmux_session
                    )
                except Exception:
                    pass

                # Clean up config file
                if record.mcp_config_path:
                    cleanup_config(record.mcp_config_path)

                # Mark as stopped in DB
                record.status = "stopped"
                record.stopped_at = datetime.now(UTC)
                cleaned += 1

            await db.commit()

        # Scan for orphaned ppagent-* tmux sessions not in DB
        try:
            output = await self._run_tmux(
                "list-sessions", "-F", "#{session_name}"
            )
            for line in output.strip().split("\n"):
                session_name = line.strip()
                if (
                    session_name.startswith("ppagent-")
                    and session_name not in known_sessions
                ):
                    try:
                        await self._run_tmux(
                            "kill-session", "-t", session_name
                        )
                        log.warning(
                            "Killed orphaned agent tmux session",
                            session=session_name,
                        )
                    except Exception:
                        pass
        except Exception:
            pass  # No tmux server running is fine

        # Kill orphaned ttyd processes attached to ppagent-* sessions.
        # These survive backend restarts and hold ports from the pool.
        self._kill_orphaned_ttyd()

        if cleaned > 0:
            log.info("Stale agent processes recovered", count=cleaned)
        return cleaned

    # ------------------------------------------------------------------
    # Private helpers -- ttyd lifecycle
    # ------------------------------------------------------------------

    async def _wait_for_ttyd(
        self,
        port: int,
        process: subprocess.Popen,
        timeout: float = 2.0,
    ) -> bool:
        """Wait until ttyd is listening on *port* or the process exits."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if process.poll() is not None:
                return False
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.settimeout(0.1)
                try:
                    sock.connect(("127.0.0.1", port))
                    return True
                except OSError:
                    await asyncio.sleep(0.05)
        return False

    @staticmethod
    def _is_port_free(port: int) -> bool:
        """Check whether *port* is available to bind."""
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.1)
            try:
                sock.bind(("127.0.0.1", port))
                return True
            except OSError:
                return False

    async def _start_ttyd(
        self, tmux_session: str
    ) -> tuple[int, subprocess.Popen]:
        """Start a ttyd process attached to *tmux_session*.

        Acquires a port from the shared pool, starts ttyd, waits
        for readiness.  Cleans up on failure.  If the first port is
        occupied by an orphaned process, tries up to 3 ports.

        Returns:
            ``(port, ttyd_process)`` tuple.

        Raises:
            RuntimeError: If ttyd fails to start or become ready.
        """
        port = shared_port_pool.acquire()

        # If the port is held by an orphan, release and try another
        attempts = 0
        while not self._is_port_free(port) and attempts < 3:
            log.warning(
                "Port occupied by orphan, trying next",
                port=port,
            )
            # Don't release back (it's unusable) — just grab the next
            attempts += 1
            port = shared_port_pool.acquire()
        try:
            ttyd_proc = subprocess.Popen(
                [
                    "ttyd",
                    "--port",
                    str(port),
                    "--writable",
                    "tmux",
                    "attach",
                    "-t",
                    tmux_session,
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception as exc:
            shared_port_pool.release(port)
            raise RuntimeError(f"Failed to start ttyd: {exc}") from exc

        ready = await self._wait_for_ttyd(port, ttyd_proc)
        if not ready:
            try:
                ttyd_proc.terminate()
                ttyd_proc.wait(timeout=5)
            except Exception:
                ttyd_proc.kill()
            shared_port_pool.release(port)
            raise RuntimeError(
                "Failed to start ttyd: port not responding"
            )

        return port, ttyd_proc

    def _stop_ttyd(self, agent: AgentProcess) -> None:
        """Terminate the ttyd process and release its port."""
        if agent.ttyd_process is not None:
            try:
                agent.ttyd_process.terminate()
                agent.ttyd_process.wait(timeout=5)
            except Exception:
                try:
                    agent.ttyd_process.kill()
                except Exception:
                    pass

        if agent.ttyd_port is not None:
            try:
                shared_port_pool.release(agent.ttyd_port)
            except ValueError:
                pass  # Already released

    async def _launch_custom_agent(
        self,
        config: AgentConfig,
        project_id: str,
        user_id: str,
        full_prompt: str,
        env_vars: dict[str, str] | None = None,
    ) -> AgentProcess:
        """Launch a custom agent using command_template (no MCP config).

        Custom agents define their own CLI command with a ``{prompt}``
        placeholder.  No MCP config is generated -- the user is
        responsible for supplying any tool integrations in the template.

        Args:
            config: The saved AgentConfig with ``command_template`` set.
            project_id: Project to scope the agent to.
            user_id: User who owns the agent.
            full_prompt: Fully composed prompt (system + context + user).
            env_vars: Optional environment variables to inject.

        Returns:
            The ``AgentProcess`` runtime object.

        Raises:
            AppException: If command_template is missing or launch fails.
        """
        if not config.command_template:
            raise AppException(
                ErrorCode.AGENT_CONFIG_INVALID,
                "Custom agent requires a command_template",
                {"config_id": config.id},
            )

        short_id = uuid4().hex[:8]
        agent_id = f"{project_id}-{short_id}"
        tmux_session = f"ppagent-{project_id}-{short_id}"

        cmd = self._build_custom_command(full_prompt, config.command_template)

        try:
            tmux_args = [
                "new-session",
                "-d",
                "-s",
                tmux_session,
                "-x",
                "200",
                "-y",
                "50",
            ]

            # Inject caller-provided environment variables
            if env_vars:
                for key, value in env_vars.items():
                    tmux_args.extend(["-e", f"{key}={value}"])

            tmux_args.extend(cmd)
            await self._run_tmux(*tmux_args)

            # Keep pane visible after agent exits so ttyd can still
            # show the full output (session survives process exit).
            await self._run_tmux(
                "set-option", "-t", tmux_session, "remain-on-exit", "on"
            )

            # Retrieve PID of the process inside the tmux pane
            pid_str = await self._run_tmux(
                "display-message",
                "-p",
                "-t",
                tmux_session,
                "#{pane_pid}",
            )
            pid = int(pid_str.strip())

        except Exception as exc:
            try:
                await self._run_tmux("kill-session", "-t", tmux_session)
            except Exception:
                pass
            log.error(
                "Custom agent launch failed",
                project_id=project_id,
                error=str(exc),
            )
            raise AppException(
                ErrorCode.AGENT_LAUNCH_FAILED,
                f"Failed to launch custom agent: {exc}",
                {"agent_type": "custom", "project_id": project_id},
            ) from exc

        agent = AgentProcess(
            id=agent_id,
            agent_type="custom",
            project_id=project_id,
            user_id=user_id,
            tmux_session=tmux_session,
            pid=pid,
            status="running",
            mcp_config_path=None,
            mcp_token=None,
        )
        self._agents[agent_id] = agent

        log.info(
            "Custom agent launched",
            agent_id=agent_id,
            tmux_session=tmux_session,
            pid=pid,
        )
        return agent

    async def _launch_standard_agent_via_console_provider(
        self,
        *,
        config: AgentConfig,
        project_id: str,
        user_id: str,
        prompt: str,
        interactive: bool,
        full_prompt: str,
        env_dict: dict[str, str],
        provider,
    ) -> AgentProcess:
        """Launch a standard agent inside the active console provider.

        Used when the active provider is the Windows-friendly legacy PTY
        backend rather than tmux+ttyd.
        """
        short_id = uuid4().hex[:8]
        agent_id = f"{project_id}-{short_id}"
        session_name = f"ppagent-{project_id}-{short_id}"

        token = create_mcp_token(
            user_id, project_id, ttl_minutes=60,
            agent_process_id=agent_id,
        )

        base = settings.api_base_url
        if base.endswith("/api/v1"):
            base = base[: -len("/api/v1")]
        mcp_url = f"{base}/mcp"

        config_path: str | None = None

        try:
            if config.agent_type == "claude_code":
                config_path = generate_claude_code_config(mcp_url, token)
            else:
                config_path = generate_codex_config(mcp_url)

            launch_command = self._build_console_launch_command(
                agent_type=config.agent_type,
                prompt=full_prompt,
                interactive=interactive,
                config_path=config_path,
                max_turns=config.max_turns,
                mcp_token=token,
                env_vars=env_dict,
            )

            session = await provider.create_session(
                name=session_name,
                project_id=project_id,
                cols=200,
                rows=50,
                user_id=user_id,
            )
        except AppException:
            if config_path:
                cleanup_config(config_path)
            raise
        except Exception as exc:
            if config_path:
                cleanup_config(config_path)
            log.error(
                "Agent launch failed",
                agent_type=config.agent_type,
                project_id=project_id,
                error=str(exc),
            )
            raise AppException(
                ErrorCode.AGENT_LAUNCH_FAILED,
                f"Failed to launch {config.agent_type} agent: {exc}",
                {"agent_type": config.agent_type, "project_id": project_id},
            ) from exc

        agent = AgentProcess(
            id=agent_id,
            agent_type=config.agent_type,
            project_id=project_id,
            user_id=user_id,
            tmux_session=session.id,
            pid=0,
            status="starting",
            mcp_config_path=config_path,
            mcp_token=token,
            websocket_url=session.websocket_url,
            output_mode="terminal",
            launch_command=launch_command,
            provider_kind=provider.get_capabilities().provider,
        )
        self._agents[agent_id] = agent

        try:
            async with async_session_maker() as db_sess:
                record = AgentProcessRecord(
                    id=agent_id,
                    project_id=project_id,
                    user_id=user_id,
                    agent_type=config.agent_type,
                    tmux_session=session.id,
                    pid=0,
                    status="starting",
                    mcp_config_path=config_path,
                    prompt=prompt,
                )
                db_sess.add(record)
                await db_sess.commit()
        except Exception:
            log.warning(
                "Failed to persist agent record",
                agent_id=agent_id,
            )

        log.info(
            "Agent launched from config via console provider (awaiting execute)",
            agent_id=agent_id,
            config_id=config.id,
            provider=agent.provider_kind,
        )
        return agent

    async def _build_checklist_context(
        self, project_id: str, db: AsyncSession
    ) -> str:
        """Build markdown context from active/pending checklist items.

        Reads the ``engagement_state`` from project variables and
        formats active and pending items as a markdown checklist.

        Note: checklist context is now included via ContextBuilder "agent"
        preset (engagement phase formatter).  This method is retained for
        backward compatibility.
        # TODO: remove if unused

        Returns:
            Formatted markdown string, or ``""`` if no items found.
        """
        result = await db.execute(
            select(Project).where(Project.id == project_id)
        )
        project = result.scalar_one_or_none()
        if project is None or not project.variables:
            return ""

        engagement_state = project.variables.get("engagement_state", {})
        if not engagement_state:
            return ""

        sections_data = engagement_state.get("sections", [])
        if not sections_data:
            return ""

        lines: list[str] = ["## Active Checklist Items"]
        has_items = False

        for section in sections_data:
            section_label = section.get("label", "Untitled")
            items = section.get("items", [])
            active_items = [
                item
                for item in items
                if item.get("status") in ("active", "pending")
            ]
            if not active_items:
                continue

            has_items = True
            lines.append(f"\n### {section_label}")
            for item in active_items:
                marker = "x" if item.get("status") == "active" else " "
                lines.append(f"- [{marker}] {item.get('label', '')}")

        return "\n".join(lines) if has_items else ""

    # ------------------------------------------------------------------
    # Private helpers -- tmux & process
    # ------------------------------------------------------------------

    def _kill_orphaned_ttyd(self) -> None:
        """Kill any ttyd processes attached to ppagent-* sessions.

        After a backend restart the in-memory agent dict is empty, so
        ``stop_agent`` can't clean these up.  They hold ports from the
        pool and cause new launches to fail or connect to the wrong
        session.
        """
        try:
            result = subprocess.run(
                ["pgrep", "-a", "-f", "ttyd.*ppagent-"],
                capture_output=True,
                timeout=5,
            )
            if result.returncode != 0:
                return  # No matching processes

            for line in result.stdout.decode().strip().split("\n"):
                if not line.strip():
                    continue
                pid_str = line.split()[0]
                try:
                    os.kill(int(pid_str), signal.SIGTERM)
                    log.warning(
                        "Killed orphaned ttyd process",
                        pid=pid_str,
                        cmdline=line.strip(),
                    )
                except (ProcessLookupError, OSError):
                    pass
        except Exception:
            pass  # Best-effort cleanup

    async def _run_tmux(self, *args: str) -> str:
        """Execute a tmux command asynchronously."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._run_tmux_sync, args)

    def _run_tmux_sync(self, args: tuple[str, ...]) -> str:
        """Execute a tmux command synchronously (runs in executor)."""
        result = subprocess.run(
            ["tmux", *args],
            capture_output=True,
            timeout=10,
        )
        if (
            result.returncode != 0
            and b"no server running" not in result.stderr
        ):
            raise RuntimeError(f"tmux error: {result.stderr.decode()}")
        return result.stdout.decode()

    @staticmethod
    def _signal_process(pid: int, sig: signal.Signals) -> bool:
        """Best-effort signal delivery across POSIX and Windows."""
        if hasattr(os, "getpgid") and hasattr(os, "killpg"):
            try:
                pgid = os.getpgid(pid)
                os.killpg(pgid, sig)
                return True
            except ProcessLookupError:
                return False
            except OSError:
                pass

        try:
            os.kill(pid, sig)
            return True
        except (ProcessLookupError, OSError):
            return False

    @staticmethod
    def _force_kill_signal() -> signal.Signals:
        """Return a force-kill signal that exists on the current OS."""
        return getattr(signal, "SIGKILL", signal.SIGTERM)

    async def _wait_for_exit(self, pid: int, timeout: float) -> bool:
        """Wait for a process to exit.

        Returns:
            ``True`` if the process is still alive after timeout,
            ``False`` if it exited.
        """
        deadline = asyncio.get_event_loop().time() + timeout
        while asyncio.get_event_loop().time() < deadline:
            if not self._is_pid_alive(pid):
                return False
            await asyncio.sleep(0.2)
        return True  # Still alive after timeout

    @staticmethod
    def _is_pid_alive(pid: int) -> bool:
        """Check whether a process is still running."""
        try:
            os.kill(pid, 0)
            return True
        except ProcessLookupError:
            return False
        except OSError:
            # PermissionError means process exists but we can't signal it
            return True

    def _build_launch_script(
        self,
        agent_type: str,
        prompt_path: str | None,
        config_path: str,
        max_turns: int = 50,
        stream_json: bool = False,
        log_path: str | None = None,
    ) -> str:
        """Build a bash launch script for the agent.

        Reads the prompt from *prompt_path* at runtime to avoid any
        shell escaping issues with the prompt content.  When
        *prompt_path* is ``None`` or points to an empty file the agent
        is launched in **interactive mode** (no ``-p`` flag).

        Args:
            agent_type: ``"claude_code"`` or ``"codex"``.
            prompt_path: Path to file containing the prompt text, or
                ``None`` for interactive mode.
            config_path: Path to the MCP config file.
            max_turns: Maximum agent iterations.
            stream_json: If True, add ``--output-format stream-json``.
            log_path: If set, pipe output through ``tee`` to this path.

        Returns:
            Shell script content as a string.
        """
        safe_config = shlex.quote(config_path)

        if agent_type == "claude_code":
            parts = ["claude"]
            # Only add -p when a non-empty prompt is provided
            if prompt_path:
                safe_prompt_path = shlex.quote(prompt_path)
                parts.extend(["-p", f'"$(cat {safe_prompt_path})"'])
            parts.extend([
                "--mcp-config",
                safe_config,
                "--dangerously-skip-permissions",
                "--allowedTools",
                "'mcp__pwnpilot__*'",
                "--max-turns",
                str(max_turns),
                "--verbose",
            ])
            if stream_json:
                parts.extend(["--output-format", "stream-json"])
        else:
            # codex — interactive when no prompt, exec when prompt given
            if prompt_path:
                safe_prompt_path = shlex.quote(prompt_path)
                parts = ["codex", "exec", f'"$(cat {safe_prompt_path})"',
                         "--json", "--full-auto"]
            else:
                parts = ["codex", "--full-auto"]

        cmd = " ".join(parts)
        if log_path:
            cmd += f" 2>&1 | tee {shlex.quote(log_path)}"

        # Unset CLAUDECODE so nested sessions are allowed (the env var
        # leaks into tmux when the backend runs inside a Claude Code
        # session, e.g. during development).
        return f"#!/bin/bash\nunset CLAUDECODE\n{cmd}\n"

    def _build_console_launch_command(
        self,
        *,
        agent_type: str,
        prompt: str,
        interactive: bool,
        config_path: str,
        max_turns: int,
        mcp_token: str,
        env_vars: dict[str, str],
    ) -> str:
        """Build a shell command for the active console provider session."""
        command_env = dict(env_vars)
        command_parts: list[str]

        if agent_type == "claude_code":
            command_parts = ["claude"]
            if not interactive:
                command_parts.extend(["-p", prompt])
            command_parts.extend([
                "--mcp-config",
                config_path,
                "--dangerously-skip-permissions",
                "--allowedTools",
                "mcp__pwnpilot__*",
                "--max-turns",
                str(max_turns),
                "--verbose",
            ])
        else:
            command_env["PP_MCP_TOKEN"] = mcp_token
            command_env["CODEX_HOME"] = str(Path(config_path).parent)
            if interactive:
                command_parts = ["codex", "--full-auto"]
            else:
                command_parts = ["codex", "exec", prompt, "--json", "--full-auto"]

        if os.name == "nt":
            prefix = ['set "CLAUDECODE="']
            prefix.extend(
                f'set "{key}={str(value).replace(chr(34), chr(34) * 2)}"'
                for key, value in command_env.items()
            )
            return " && ".join([*prefix, subprocess.list2cmdline(command_parts)])

        prefix = ["unset CLAUDECODE"]
        prefix.extend(
            f"export {key}={shlex.quote(str(value))}"
            for key, value in command_env.items()
        )
        return " && ".join([*prefix, shlex.join(command_parts)])

    def _build_claude_command(
        self, prompt: str, config_path: str, max_turns: int
    ) -> list[str]:
        """Build the Claude Code CLI command (direct launch, no ttyd)."""
        return [
            "claude",
            "-p",
            prompt,
            "--mcp-config",
            config_path,
            "--dangerously-skip-permissions",
            "--allowedTools",
            "mcp__pwnpilot__*",
            "--max-turns",
            str(max_turns),
            "--verbose",
        ]

    def _build_codex_command(self, prompt: str) -> list[str]:
        """Build the Codex CLI command."""
        return [
            "codex",
            "exec",
            prompt,
            "--json",
            "--full-auto",
        ]

    def _build_custom_command(
        self, prompt: str, command_template: str
    ) -> list[str]:
        """Build command from user-provided template with ``{prompt}`` placeholder.

        The prompt is shell-quoted via :func:`shlex.quote` to prevent
        injection attacks.

        Args:
            prompt: The full prompt text.
            command_template: Shell command with ``{prompt}`` placeholder.

        Returns:
            Parsed command list suitable for tmux ``new-session``.
        """
        safe_prompt = shlex.quote(prompt)
        resolved = command_template.replace("{prompt}", safe_prompt)
        return shlex.split(resolved)

    async def _update_db_status(
        self,
        agent_id: str,
        status: str,
        db_factory: Any,
    ) -> None:
        """Update agent status in the database."""
        if db_factory is None:
            return
        try:
            async with db_factory() as db:
                await db.execute(
                    update(AgentProcessRecord)
                    .where(AgentProcessRecord.id == agent_id)
                    .values(status=status)
                )
                await db.commit()
        except Exception:
            log.warning(
                "Failed to update agent status in DB",
                agent_id=agent_id,
                status=status,
            )


# Module-level singleton
agent_process_manager = AgentProcessManager()
