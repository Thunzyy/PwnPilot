import asyncio
import sys
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

if sys.platform == "win32":
    pytest.skip("tmux+ttyd provider tests require POSIX", allow_module_level=True)

from app.services.console_provider import ConsoleSession
from app.services.providers.tmux_ttyd import TmuxTtydProvider
from app.services.providers.tmux_ttyd import TmuxSessionData


@pytest.fixture
def mock_dependencies():
    """Mock tmux and ttyd system calls"""
    with patch("shutil.which") as mock_which:
        mock_which.return_value = "/usr/bin/tmux"
        yield mock_which


@pytest.fixture
def provider(mock_dependencies):
    with patch("app.services.providers.tmux_ttyd.shutil.which", return_value="/usr/bin/tmux"):
        return TmuxTtydProvider(host="localhost", use_ssl=False)


def test_provider_initialization(provider):
    assert provider.host == "localhost"
    assert provider.ws_scheme == "ws"
    assert provider.port_pool.available_count == 100  # 7680-7780


def test_provider_check_dependencies_missing():
    with patch("app.services.providers.tmux_ttyd.shutil.which", return_value=None):
        with pytest.raises(RuntimeError, match="tmux not found"):
            TmuxTtydProvider()


@pytest.mark.anyio
async def test_create_session_generates_tokens(provider):
    with patch.object(provider, "_run_tmux", new_callable=AsyncMock) as mock_tmux:
        with patch.object(
            provider,
            "_wait_for_ttyd",
            new_callable=AsyncMock,
            return_value=True,
        ):
            with patch.object(provider, "_watch_ttyd", new_callable=AsyncMock):
                with patch("app.services.providers.tmux_ttyd.subprocess.Popen") as mock_popen:
                    mock_process = MagicMock(pid=12345)
                    mock_process.poll.return_value = None
                    mock_popen.return_value = mock_process
                    mock_tmux.return_value = ""

                    session = await provider.create_session("Test", project_id="proj-1")

                    assert session.name == "Test"
                    assert session.project_id == "proj-1"
                    assert len(session.master_token) > 20
                    assert len(session.viewer_token) > 20
                    assert session.master_token != session.viewer_token
                    assert session.is_alive is True


@pytest.mark.anyio
async def test_list_sessions_empty(provider):
    sessions = provider.list_sessions()
    assert sessions == []


@pytest.mark.anyio
async def test_list_sessions_filtered(provider):
    with patch.object(provider, "_run_tmux", new_callable=AsyncMock):
        with patch.object(
            provider,
            "_wait_for_ttyd",
            new_callable=AsyncMock,
            return_value=True,
        ):
            with patch.object(provider, "_watch_ttyd", new_callable=AsyncMock):
                with patch("app.services.providers.tmux_ttyd.subprocess.Popen") as mock_popen:
                    mock_process = MagicMock(pid=12345)
                    mock_process.poll.return_value = None
                    mock_popen.return_value = mock_process

                    await provider.create_session("S1", project_id="proj-1")
                    await provider.create_session("S2", project_id="proj-2")

                    all_sessions = provider.list_sessions()
                    proj1_sessions = provider.list_sessions(project_id="proj-1")

                    assert len(all_sessions) == 2
                    assert len(proj1_sessions) == 1
                    assert proj1_sessions[0].project_id == "proj-1"


@pytest.mark.anyio
async def test_create_session_skips_unavailable_port(provider):
    with patch.object(provider, "_run_tmux", new_callable=AsyncMock):
        with patch("app.services.providers.tmux_ttyd.subprocess.Popen") as mock_popen:
            with patch.object(provider, "_watch_ttyd", new_callable=AsyncMock):
                with patch.object(provider.port_pool, "acquire", side_effect=[7680, 7681]):
                    with patch.object(
                        provider,
                        "_is_port_free",
                        side_effect=[False, True],
                        create=True,
                    ):
                        with patch.object(
                            provider,
                            "_wait_for_ttyd",
                            new_callable=AsyncMock,
                            return_value=True,
                            create=True,
                        ):
                            mock_process = MagicMock(pid=12345)
                            mock_process.poll.return_value = None
                            mock_popen.return_value = mock_process

                            session = await provider.create_session("Test", project_id="proj-1")

                            assert session.websocket_url.endswith(":7681/ws")
                            popen_args = mock_popen.call_args[0][0]
                            port_index = popen_args.index("--port") + 1
                            assert popen_args[port_index] == "7681"


@pytest.mark.anyio
async def test_send_input_waits_for_idle_state_before_submitting_command(provider, tmp_path):
    session = ConsoleSession(
        id="session-1",
        project_id="proj-1",
        name="Test",
        websocket_url="ws://localhost:7680/ws",
        master_token="master",
        viewer_token="viewer",
        is_alive=True,
        created_at=datetime.now(UTC),
    )
    state_file = tmp_path / "session-1.state"
    state_file.write_text("busy", encoding="utf-8")
    provider._sessions[session.id] = TmuxSessionData(
        session=session,
        ttyd_port=7680,
        ttyd_process=MagicMock(),
        command_state_file=state_file,
    )

    async def fake_run_tmux(*args):
        assert state_file.read_text(encoding="utf-8") == "idle"
        return ""

    async def flip_state():
        await asyncio.sleep(0.05)
        state_file.write_text("idle", encoding="utf-8")

    with patch.object(provider, "_run_tmux", side_effect=fake_run_tmux):
        flipper = asyncio.create_task(flip_state())
        try:
            assert await provider.send_input(session.id, "whoami\n") is True
        finally:
            await flipper


@pytest.mark.anyio
async def test_send_input_serializes_concurrent_command_submissions(provider, tmp_path):
    session = ConsoleSession(
        id="session-2",
        project_id="proj-1",
        name="Test",
        websocket_url="ws://localhost:7680/ws",
        master_token="master",
        viewer_token="viewer",
        is_alive=True,
        created_at=datetime.now(UTC),
    )
    state_file = tmp_path / "session-2.state"
    state_file.write_text("idle", encoding="utf-8")
    provider._sessions[session.id] = TmuxSessionData(
        session=session,
        ttyd_port=7680,
        ttyd_process=MagicMock(),
        command_state_file=state_file,
    )

    calls: list[tuple[str, ...]] = []
    first_chunk_started = asyncio.Event()
    allow_first_chunk_to_finish = asyncio.Event()

    async def fake_run_tmux(*args):
        calls.append(args)
        if args[-1] == "first":
            first_chunk_started.set()
            await allow_first_chunk_to_finish.wait()
            state_file.write_text("busy", encoding="utf-8")
            asyncio.get_running_loop().call_later(
                0.05,
                state_file.write_text,
                "idle",
                "utf-8",
            )
        return ""

    with patch.object(provider, "_run_tmux", side_effect=fake_run_tmux):
        first = asyncio.create_task(provider.send_input(session.id, "first\n"))
        await first_chunk_started.wait()
        second = asyncio.create_task(provider.send_input(session.id, "second\n"))
        await asyncio.sleep(0.05)
        assert calls == [("send-keys", "-t", session.id, "-l", "first")]

        allow_first_chunk_to_finish.set()

        assert await first is True
        assert await second is True

    assert calls == [
        ("send-keys", "-t", session.id, "-l", "first"),
        ("send-keys", "-t", session.id, "Enter"),
        ("send-keys", "-t", session.id, "-l", "second"),
        ("send-keys", "-t", session.id, "Enter"),
    ]


@pytest.mark.anyio
async def test_send_input_does_not_block_different_sessions(provider, tmp_path):
    session_one = ConsoleSession(
        id="session-a",
        project_id="proj-1",
        name="A",
        websocket_url="ws://localhost:7680/ws",
        master_token="master-a",
        viewer_token="viewer-a",
        is_alive=True,
        created_at=datetime.now(UTC),
    )
    session_two = ConsoleSession(
        id="session-b",
        project_id="proj-1",
        name="B",
        websocket_url="ws://localhost:7681/ws",
        master_token="master-b",
        viewer_token="viewer-b",
        is_alive=True,
        created_at=datetime.now(UTC),
    )
    state_file_one = tmp_path / "session-a.state"
    state_file_two = tmp_path / "session-b.state"
    state_file_one.write_text("idle", encoding="utf-8")
    state_file_two.write_text("idle", encoding="utf-8")
    provider._sessions[session_one.id] = TmuxSessionData(
        session=session_one,
        ttyd_port=7680,
        ttyd_process=MagicMock(),
        command_state_file=state_file_one,
    )
    provider._sessions[session_two.id] = TmuxSessionData(
        session=session_two,
        ttyd_port=7681,
        ttyd_process=MagicMock(),
        command_state_file=state_file_two,
    )

    calls: list[tuple[str, ...]] = []
    first_chunk_started = asyncio.Event()
    second_session_finished = asyncio.Event()
    allow_first_chunk_to_finish = asyncio.Event()

    async def fake_run_tmux(*args):
        calls.append(args)
        target = args[2]
        if target == session_one.id and args[-1] == "first":
            first_chunk_started.set()
            await allow_first_chunk_to_finish.wait()
        if target == session_two.id and args[-1] == "Enter":
            second_session_finished.set()
        return ""

    with patch.object(provider, "_run_tmux", side_effect=fake_run_tmux):
        first = asyncio.create_task(provider.send_input(session_one.id, "first\n"))
        await first_chunk_started.wait()

        second = asyncio.create_task(provider.send_input(session_two.id, "second\n"))
        await asyncio.wait_for(second_session_finished.wait(), timeout=0.2)

        assert second.done() is True
        assert await second is True
        assert first.done() is False

        allow_first_chunk_to_finish.set()
        assert await first is True

    assert calls[:3] == [
        ("send-keys", "-t", session_one.id, "-l", "first"),
        ("send-keys", "-t", session_two.id, "-l", "second"),
        ("send-keys", "-t", session_two.id, "Enter"),
    ]
