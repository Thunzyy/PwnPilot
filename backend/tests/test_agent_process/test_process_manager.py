"""Unit tests for AgentProcessManager with mocked tmux/subprocess."""

from __future__ import annotations

import os
from dataclasses import replace
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.console_provider import ConsoleSession, TerminalCapabilities
from app.services.agent.process_manager import AgentProcess, AgentProcessManager


@pytest.fixture
def manager():
    """Fresh AgentProcessManager for each test."""
    return AgentProcessManager()


@pytest.fixture
def mock_agent():
    """Pre-built AgentProcess for stop/get tests."""
    return AgentProcess(
        id="proj1-abc12345",
        agent_type="claude_code",
        project_id="proj1",
        user_id="user1",
        tmux_session="ppagent-proj1-abc12345",
        pid=12345,
        status="running",
        mcp_config_path="/tmp/ppagent-mcp-test.json",
        mcp_token="mock-token",
        created_at=datetime.now(UTC),
    )


class TestLaunchAgent:
    """Tests for launch_agent method."""

    @pytest.mark.anyio
    @patch("app.services.agent.process_manager.create_mcp_token", return_value="tok")
    @patch("app.services.agent.process_manager.generate_claude_code_config", return_value="/tmp/cfg.json")
    @patch("shutil.which", return_value="/usr/bin/claude")
    async def test_creates_tmux_session(
        self, mock_which, mock_cfg, mock_token, manager
    ):
        """launch_agent calls tmux new-session with ppagent- prefix."""
        tmux_calls: list[tuple] = []

        async def fake_run_tmux(*args):
            tmux_calls.append(args)
            # Second call is display-message for PID
            if "display-message" in args:
                return "12345\n"
            return ""

        manager._run_tmux = fake_run_tmux

        await manager.launch_agent(
            agent_type="claude_code",
            project_id="proj1",
            user_id="user1",
            prompt="test prompt",
        )

        # First call should be new-session
        assert len(tmux_calls) >= 2
        assert "new-session" in tmux_calls[0]
        # Session name has ppagent- prefix
        session_idx = list(tmux_calls[0]).index("-s") + 1
        assert tmux_calls[0][session_idx].startswith("ppagent-")

    @pytest.mark.anyio
    @patch("app.services.agent.process_manager.create_mcp_token", return_value="tok")
    @patch("app.services.agent.process_manager.generate_claude_code_config", return_value="/tmp/cfg.json")
    @patch("shutil.which", return_value="/usr/bin/claude")
    async def test_returns_agent_process(
        self, mock_which, mock_cfg, mock_token, manager
    ):
        """launch_agent returns an AgentProcess with correct fields."""
        async def fake_run_tmux(*args):
            if "display-message" in args:
                return "12345\n"
            return ""

        manager._run_tmux = fake_run_tmux

        agent = await manager.launch_agent(
            agent_type="claude_code",
            project_id="proj1",
            user_id="user1",
            prompt="test prompt",
        )

        assert isinstance(agent, AgentProcess)
        assert agent.agent_type == "claude_code"
        assert agent.project_id == "proj1"
        assert agent.pid == 12345
        assert agent.status == "running"
        assert agent.tmux_session.startswith("ppagent-")
        assert agent.id.startswith("proj1-")

    @pytest.mark.anyio
    async def test_invalid_type_raises(self, manager):
        """launch_agent with unsupported type raises AGENT_INVALID_TYPE."""
        from app.core.exceptions import AppException

        with pytest.raises(AppException, match="Unsupported agent type"):
            await manager.launch_agent(
                agent_type="unsupported",
                project_id="proj1",
                user_id="user1",
                prompt="test",
            )

    @pytest.mark.anyio
    @patch("shutil.which", return_value=None)
    async def test_missing_binary_raises(self, mock_which, manager):
        """launch_agent raises AGENT_BINARY_NOT_FOUND when binary is missing."""
        from app.core.exceptions import AppException

        with pytest.raises(AppException, match="binary not found"):
            await manager.launch_agent(
                agent_type="claude_code",
                project_id="proj1",
                user_id="user1",
                prompt="test",
            )

    @pytest.mark.anyio
    @patch("app.services.agent.process_manager.create_mcp_token", return_value="tok")
    @patch(
        "app.services.agent.process_manager.generate_codex_config",
        return_value="C:/tmp/codex/config.toml",
    )
    async def test_launch_from_config_uses_legacy_console_provider_when_available(
        self, mock_cfg, mock_token, manager, monkeypatch
    ):
        """launch_agent_from_config falls back to the console provider when tmux is unavailable."""
        config = SimpleNamespace(
            id=7,
            user_id="user1",
            agent_type="codex",
            max_turns=20,
            env_vars_encrypted=None,
            api_key_encrypted=None,
            system_prompt=None,
        )
        db = AsyncMock()
        db.get = AsyncMock(return_value=config)

        session = ConsoleSession(
            id="term-1",
            project_id="proj1",
            name="Agent Session",
            websocket_url="ws://localhost/api/v1/terminal/ws/term-1",
            master_token="master",
            viewer_token="viewer",
            is_alive=True,
            created_at=datetime.now(UTC),
        )
        provider = SimpleNamespace(
            get_capabilities=lambda: TerminalCapabilities(
                provider="legacy",
                platform="windows",
                can_create_session=True,
                can_detach=False,
                websocket_mode="legacy",
            ),
            create_session=AsyncMock(return_value=session),
        )

        persisted = SimpleNamespace(add=MagicMock(), commit=AsyncMock())

        class FakeFactory:
            def __call__(self):
                return self

            async def __aenter__(self):
                return persisted

            async def __aexit__(self, *args):
                return False

        monkeypatch.setattr(
            "app.services.agent.process_manager.get_provider",
            lambda: provider,
        )
        monkeypatch.setattr(
            "app.services.agent.process_manager.async_session_maker",
            FakeFactory(),
        )

        agent = await manager.launch_agent_from_config(
            config_id=7,
            project_id="proj1",
            user_id="user1",
            prompt="",
            db=db,
        )

        assert agent.tmux_session == "term-1"
        assert agent.websocket_url == session.websocket_url
        assert agent.status == "starting"
        provider.create_session.assert_awaited_once()


class TestStopAgent:
    """Tests for stop_agent method."""

    @pytest.mark.anyio
    async def test_sends_ctrl_c_first(self, manager, mock_agent):
        """stop_agent sends Ctrl-C via tmux send-keys as first step."""
        manager._agents[mock_agent.id] = mock_agent
        tmux_calls: list[tuple] = []

        async def fake_run_tmux(*args):
            tmux_calls.append(args)
            return ""

        manager._run_tmux = fake_run_tmux

        async def fake_wait(pid, timeout):
            return False  # Process exited

        manager._wait_for_exit = fake_wait

        with patch("app.services.agent.process_manager.cleanup_config"):
            await manager.stop_agent(mock_agent.id)

        # First tmux call should be send-keys with C-c
        assert len(tmux_calls) >= 1
        first_call = tmux_calls[0]
        assert "send-keys" in first_call
        assert "C-c" in first_call

    @pytest.mark.anyio
    async def test_escalates_to_sigkill(self, manager, mock_agent):
        """stop_agent escalates to SIGKILL if process stays alive."""
        manager._agents[mock_agent.id] = mock_agent
        killpg_calls: list[tuple] = []

        async def fake_run_tmux(*args):
            return ""

        manager._run_tmux = fake_run_tmux

        async def fake_wait(pid, timeout):
            return True  # Process still alive after timeout

        manager._wait_for_exit = fake_wait

        import signal

        def fake_killpg(pgid, sig):
            killpg_calls.append((pgid, sig))

        with (
            patch("os.getpgid", return_value=mock_agent.pid, create=True),
            patch("os.killpg", side_effect=fake_killpg, create=True),
            patch("app.services.agent.process_manager.cleanup_config"),
        ):
            await manager.stop_agent(mock_agent.id)

        # Should have SIGTERM and SIGKILL calls
        sigs = [sig for _, sig in killpg_calls]
        assert signal.SIGTERM in sigs
        assert getattr(signal, "SIGKILL", signal.SIGTERM) in sigs

    @pytest.mark.anyio
    async def test_escalates_without_process_group_api(
        self, manager, mock_agent, monkeypatch
    ):
        """stop_agent falls back to pid-level signaling when needed."""
        manager._agents[mock_agent.id] = mock_agent
        import signal

        signals: list[signal.Signals] = []

        async def fake_run_tmux(*args):
            return ""

        manager._run_tmux = fake_run_tmux

        async def fake_wait(pid, timeout):
            return True

        manager._wait_for_exit = fake_wait

        if hasattr(os, "getpgid"):
            monkeypatch.delattr(os, "getpgid", raising=False)
        if hasattr(os, "killpg"):
            monkeypatch.delattr(os, "killpg", raising=False)

        def fake_kill(pid, sig):
            signals.append(sig)

        with (
            patch("os.kill", side_effect=fake_kill),
            patch("app.services.agent.process_manager.cleanup_config"),
        ):
            await manager.stop_agent(mock_agent.id)

        assert signal.SIGTERM in signals
        assert getattr(signal, "SIGKILL", signal.SIGTERM) in signals

    @pytest.mark.anyio
    async def test_cleans_up_tmux_session(self, manager, mock_agent):
        """stop_agent calls kill-session on the tmux session."""
        manager._agents[mock_agent.id] = mock_agent
        tmux_calls: list[tuple] = []

        async def fake_run_tmux(*args):
            tmux_calls.append(args)
            return ""

        manager._run_tmux = fake_run_tmux

        async def fake_wait(pid, timeout):
            return False

        manager._wait_for_exit = fake_wait

        with patch("app.services.agent.process_manager.cleanup_config"):
            await manager.stop_agent(mock_agent.id)

        kill_calls = [c for c in tmux_calls if "kill-session" in c]
        assert len(kill_calls) >= 1

    @pytest.mark.anyio
    async def test_cleans_up_config_file(self, manager, mock_agent):
        """stop_agent calls cleanup_config for the MCP config file."""
        manager._agents[mock_agent.id] = mock_agent

        async def fake_run_tmux(*args):
            return ""

        manager._run_tmux = fake_run_tmux

        async def fake_wait(pid, timeout):
            return False

        manager._wait_for_exit = fake_wait

        with patch(
            "app.services.agent.process_manager.cleanup_config"
        ) as mock_cleanup:
            await manager.stop_agent(mock_agent.id)

        mock_cleanup.assert_called_once_with(mock_agent.mcp_config_path)

    @pytest.mark.anyio
    async def test_not_found_raises(self, manager):
        """stop_agent raises AGENT_NOT_FOUND for unknown agent_id."""
        from app.core.exceptions import AppException

        with pytest.raises(AppException, match="Agent not found"):
            await manager.stop_agent("nonexistent")

    @pytest.mark.anyio
    async def test_execute_agent_command_uses_console_provider_for_legacy_agents(
        self, manager, mock_agent, monkeypatch
    ):
        """execute_agent_command sends the launch command through the active console provider."""
        legacy_agent = replace(mock_agent, status="starting", websocket_url="ws://localhost/api/v1/terminal/ws/term-1")
        legacy_agent.tmux_session = "term-1"
        legacy_agent.launch_script_path = None
        legacy_agent.launch_command = 'set "PP_MCP_TOKEN=tok" && codex --full-auto'
        legacy_agent.provider_kind = "legacy"
        manager._agents[legacy_agent.id] = legacy_agent

        provider = SimpleNamespace(send_input=AsyncMock(return_value=True))
        monkeypatch.setattr(
            "app.services.agent.process_manager.get_provider",
            lambda: provider,
        )

        agent = await manager.execute_agent_command(legacy_agent.id)

        provider.send_input.assert_awaited_once_with(
          "term-1",
          'set "PP_MCP_TOKEN=tok" && codex --full-auto\n',
        )
        assert agent.status == "running"


class TestRecoverStaleAgents:
    """Tests for recover_stale_agents method."""

    @pytest.mark.anyio
    async def test_cleans_dead_processes(self, manager):
        """recover_stale_agents marks dead-process records as stopped."""
        from unittest.mock import MagicMock

        # Build a mock DB factory that yields a mock session
        mock_record = MagicMock()
        mock_record.pid = 99999
        mock_record.tmux_session = "ppagent-proj1-dead"
        mock_record.status = "running"
        mock_record.mcp_config_path = None

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [mock_record]

        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.commit = AsyncMock()

        class FakeFactory:
            def __call__(self):
                return self

            async def __aenter__(self):
                return mock_session

            async def __aexit__(self, *args):
                pass

        async def fake_run_tmux(*args):
            if "list-sessions" in args:
                return ""
            return ""

        manager._run_tmux = fake_run_tmux

        with patch.object(
            manager, "_is_pid_alive", return_value=False
        ):
            cleaned = await manager.recover_stale_agents(FakeFactory())

        assert cleaned == 1
        assert mock_record.status == "stopped"
        assert mock_record.stopped_at is not None
