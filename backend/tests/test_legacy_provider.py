import pytest
from unittest.mock import patch

from app.services.providers.legacy_pty import LegacyPtyProvider
from app.services.console_provider import ConsoleProvider, TerminalCapabilities


def test_legacy_provider_is_console_provider():
    """Verify LegacyPtyProvider implements ConsoleProvider interface"""
    provider = LegacyPtyProvider()
    assert isinstance(provider, ConsoleProvider)


@pytest.mark.anyio
async def test_legacy_create_session():
    """Test creating a new terminal session with legacy provider"""
    provider = LegacyPtyProvider()
    session = await provider.create_session("Test", project_id="proj-1")

    assert session.name == "Test"
    assert session.project_id == "proj-1"
    assert session.is_alive is True
    assert "ws://" in session.websocket_url
    assert len(session.master_token) > 20
    assert len(session.viewer_token) > 20

    # Cleanup
    await provider.destroy_session(session.id)


@pytest.mark.anyio
async def test_legacy_create_session_accepts_workspace_and_user_context():
    provider = LegacyPtyProvider()

    with patch("app.services.providers.legacy_pty.settings.api_base_url", "http://127.0.0.1:8002/api/v1"):
        session = await provider.create_session(
            "ContextTest",
            project_id="proj-ctx",
            workspace_path="C:/tmp/project",
            user_id="user-1",
        )

    assert session.websocket_url.startswith("ws://127.0.0.1:8002/api/v1/terminal/ws/")

    await provider.destroy_session(session.id)


@pytest.mark.anyio
async def test_legacy_get_session():
    """Test retrieving an existing session"""
    provider = LegacyPtyProvider()
    created = await provider.create_session("GetTest", project_id="proj-2")

    retrieved = await provider.get_session(created.id)

    assert retrieved is not None
    assert retrieved.id == created.id
    assert retrieved.name == "GetTest"
    assert retrieved.master_token == created.master_token

    # Cleanup
    await provider.destroy_session(created.id)


@pytest.mark.anyio
async def test_legacy_get_nonexistent_session():
    """Test getting a session that doesn't exist returns None"""
    provider = LegacyPtyProvider()
    result = await provider.get_session("nonexistent-id")
    assert result is None


@pytest.mark.anyio
async def test_legacy_destroy_session():
    """Test destroying a session"""
    provider = LegacyPtyProvider()
    session = await provider.create_session("DestroyTest")

    success = await provider.destroy_session(session.id)
    assert success is True

    # Verify session is gone
    retrieved = await provider.get_session(session.id)
    assert retrieved is None


@pytest.mark.anyio
async def test_legacy_resize():
    """Test resizing a terminal session"""
    provider = LegacyPtyProvider()
    session = await provider.create_session("ResizeTest")

    success = await provider.resize(session.id, cols=100, rows=40)
    assert success is True

    # Cleanup
    await provider.destroy_session(session.id)


def test_legacy_list_sessions():
    """Test listing sessions with project filter"""
    provider = LegacyPtyProvider()

    # List all sessions (should work even if empty)
    all_sessions = provider.list_sessions()
    assert isinstance(all_sessions, list)


@pytest.mark.anyio
async def test_legacy_list_sessions_with_project():
    """Test listing sessions filtered by project"""
    provider = LegacyPtyProvider()

    # Create sessions with different project IDs
    s1 = await provider.create_session("P1-Session", project_id="proj-1")
    s2 = await provider.create_session("P2-Session", project_id="proj-2")
    s3 = await provider.create_session("P1-Session2", project_id="proj-1")

    # List sessions for proj-1
    proj1_sessions = provider.list_sessions(project_id="proj-1")
    assert len(proj1_sessions) == 2
    assert all(s.project_id == "proj-1" for s in proj1_sessions)

    # List sessions for proj-2
    proj2_sessions = provider.list_sessions(project_id="proj-2")
    assert len(proj2_sessions) == 1
    assert proj2_sessions[0].project_id == "proj-2"

    # Cleanup
    await provider.destroy_session(s1.id)
    await provider.destroy_session(s2.id)
    await provider.destroy_session(s3.id)


@pytest.mark.anyio
async def test_legacy_attach_session():
    """Test attaching to an existing session"""
    provider = LegacyPtyProvider()
    session = await provider.create_session("AttachTest")

    attached = await provider.attach_session(session.id)

    assert attached is not None
    assert attached.id == session.id
    assert attached.name == "AttachTest"

    # Cleanup
    await provider.destroy_session(session.id)


def test_legacy_capabilities():
    provider = LegacyPtyProvider()

    capabilities = provider.get_capabilities()

    assert isinstance(capabilities, TerminalCapabilities)
    assert capabilities.provider == "legacy"
    assert capabilities.can_create_session is True
    assert capabilities.can_detach is False
    assert capabilities.websocket_mode == "legacy"
