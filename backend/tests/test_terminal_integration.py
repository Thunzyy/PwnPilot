"""
Integration test for terminal sync flow
Requires tmux and ttyd installed

Note: These tests use anyio with asyncio backend only since TmuxTtydProvider
uses asyncio.subprocess which is not compatible with trio.
"""

import pytest
import asyncio
import shutil
import subprocess


# Skip if dependencies not available
pytestmark = pytest.mark.skipif(
    shutil.which("tmux") is None or shutil.which("ttyd") is None,
    reason="tmux and ttyd required for integration tests",
)


@pytest.fixture(autouse=True)
async def cleanup_tmux():
    """Ensure clean tmux state before and after each test"""
    # Cleanup before
    subprocess.run(["tmux", "kill-server"], capture_output=True, check=False)
    await asyncio.sleep(0.1)
    yield
    # Cleanup after
    subprocess.run(["tmux", "kill-server"], capture_output=True, check=False)
    await asyncio.sleep(0.1)


@pytest.mark.anyio
async def test_full_terminal_flow():
    """Test complete terminal flow: create -> join -> view -> destroy"""
    from app.services.providers.tmux_ttyd import TmuxTtydProvider

    provider = TmuxTtydProvider(port_start=17680, port_end=17690)

    try:
        # 1. Create session
        session = await provider.create_session("Integration Test", project_id="test-proj")
        assert session.is_alive
        assert session.id.startswith("pwnpilot-test-proj-")
        assert "17" in session.websocket_url  # Port in range

        # 2. Verify session exists
        retrieved = await provider.get_session(session.id)
        assert retrieved is not None
        assert retrieved.id == session.id

        # 3. List sessions
        sessions = provider.list_sessions()
        assert len(sessions) == 1
        assert sessions[0].id == session.id

        # 4. Filter by project
        filtered = provider.list_sessions(project_id="test-proj")
        assert len(filtered) == 1

        empty = provider.list_sessions(project_id="other-proj")
        assert len(empty) == 0

        # 5. Destroy session
        destroyed = await provider.destroy_session(session.id)
        assert destroyed

        # 6. Verify cleanup
        retrieved_after = await provider.get_session(session.id)
        assert retrieved_after is None

    finally:
        # Cleanup any remaining sessions
        for s in provider.list_sessions():
            await provider.destroy_session(s.id)


@pytest.mark.anyio
async def test_multiple_sessions():
    """Test multiple concurrent sessions"""
    from app.services.providers.tmux_ttyd import TmuxTtydProvider

    provider = TmuxTtydProvider(port_start=17680, port_end=17690)

    sessions = []
    try:
        for i in range(3):
            s = await provider.create_session(f"Session {i}", project_id=f"proj-{i}")
            sessions.append(s)
            # Small delay to let tmux stabilize
            await asyncio.sleep(0.1)

        assert len(provider.list_sessions()) == 3

        # Ports should all be different
        ports = {s.websocket_url.split(":")[-1].split("/")[0] for s in sessions}
        assert len(ports) == 3

    finally:
        # Cleanup
        for s in sessions:
            await provider.destroy_session(s.id)


@pytest.mark.anyio
async def test_session_tokens_are_unique():
    """Test that each session has unique tokens"""
    from app.services.providers.tmux_ttyd import TmuxTtydProvider

    provider = TmuxTtydProvider(port_start=17680, port_end=17690)

    try:
        s1 = await provider.create_session("Session 1", project_id="proj-1")
        s2 = await provider.create_session("Session 2", project_id="proj-2")

        # Tokens should be unique across sessions
        assert s1.master_token != s2.master_token
        assert s1.viewer_token != s2.viewer_token
        assert s1.master_token != s1.viewer_token
        assert s2.master_token != s2.viewer_token

    finally:
        for s in provider.list_sessions():
            await provider.destroy_session(s.id)


@pytest.mark.anyio
async def test_resize_session():
    """Test session resizing"""
    from app.services.providers.tmux_ttyd import TmuxTtydProvider

    provider = TmuxTtydProvider(port_start=17680, port_end=17690)

    try:
        session = await provider.create_session("Resize Test", cols=80, rows=24)
        assert session.is_alive

        # Resize should succeed
        result = await provider.resize(session.id, 120, 40)
        assert result is True

        # Resize non-existent should fail
        result = await provider.resize("nonexistent-id", 100, 30)
        assert result is False

    finally:
        for s in provider.list_sessions():
            await provider.destroy_session(s.id)
