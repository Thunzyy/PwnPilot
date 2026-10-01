import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.tools.registry import _TOOLS
from app.tools.registry import ToolContext


@pytest.fixture(autouse=True)
def _load():
    saved = dict(_TOOLS)
    import importlib
    import app.tools.terminal_tools
    _TOOLS.clear()
    importlib.reload(app.tools.terminal_tools)
    yield
    _TOOLS.clear()
    _TOOLS.update(saved)


def test_terminal_tools_registered():
    names = {t.name for t in _TOOLS.values() if t.category == "terminal"}
    assert names == {"terminal_create_session", "terminal_run_command", "terminal_get_output", "terminal_cancel", "terminal_kill_session"}


def test_terminal_run_command_requires_session_id():
    td = _TOOLS["terminal_run_command"]
    fields = td.params_model.model_fields
    assert "command" in fields
    assert "session_id" in fields
    assert fields["session_id"].is_required()


def test_terminal_create_session_params():
    td = _TOOLS["terminal_create_session"]
    fields = td.params_model.model_fields
    assert "name" in fields
    assert not fields["name"].is_required()  # has default


def test_terminal_tools_json_schemas():
    for name in ["terminal_create_session", "terminal_run_command", "terminal_get_output", "terminal_cancel", "terminal_kill_session"]:
        schema = _TOOLS[name].params_model.model_json_schema()
        assert schema["type"] == "object"


@pytest.mark.anyio
async def test_terminal_create_session_passes_user_id():
    from app.tools.terminal_tools import terminal_create_session

    provider = MagicMock()
    provider.list_sessions.return_value = []
    session = MagicMock()
    session.id = "s1"
    session.name = "agent"
    provider.create_session = AsyncMock(return_value=session)

    with patch("app.tools.terminal_tools.get_provider", return_value=provider):
        result = await terminal_create_session(
            ToolContext(db=None, user_id="u1", project_id="p1"),
            name=None,
        )

    provider.create_session.assert_awaited_once_with(
        name="agent",
        project_id="p1",
        user_id="u1",
    )
    assert result == {"session_id": "s1", "name": "agent", "reused": False}


@pytest.mark.anyio
async def test_terminal_run_command_uses_provider_send_input_and_hook_tracking():
    from app.tools.terminal_tools import terminal_run_command

    provider = MagicMock()
    provider.send_input = AsyncMock(return_value=True)
    provider.wait_for_command_completion = AsyncMock(return_value=True)
    provider.has_shell_state_tracking = MagicMock(return_value=True)

    with (
        patch("app.tools.terminal_tools.get_provider", return_value=provider),
        patch("app.tools.terminal_tools._capture_pane", new=AsyncMock(return_value="output")),
    ):
        result = await terminal_run_command(
            ToolContext(db=None, user_id="u1", project_id="p1"),
            command="whoami",
            session_id="s1",
        )

    provider.send_input.assert_awaited_once_with("s1", "whoami\n")
    provider.wait_for_command_completion.assert_awaited_once_with("s1")
    assert result == {
        "session_id": "s1",
        "command": "whoami",
        "output": "output",
        "_history_recorded_by_shell_hook": True,
    }
