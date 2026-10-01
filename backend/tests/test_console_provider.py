import pytest
from app.services.console_provider import (
    ConsoleProvider,
    ConsoleSession,
    ViewerRole,
)


def test_viewer_role_enum_values():
    assert ViewerRole.MASTER.value == "master"
    assert ViewerRole.CONTROLLER.value == "controller"
    assert ViewerRole.VIEWER.value == "viewer"


def test_console_session_dataclass():
    from datetime import UTC, datetime

    session = ConsoleSession(
        id="test-123",
        project_id="proj-1",
        name="Test Terminal",
        websocket_url="ws://localhost:7680/ws",
        master_token="master-token",
        viewer_token="viewer-token",
        is_alive=True,
        created_at=datetime.now(UTC),
    )
    assert session.id == "test-123"
    assert session.is_alive is True


def test_console_provider_is_abstract():
    with pytest.raises(TypeError):
        ConsoleProvider()  # Cannot instantiate abstract class
