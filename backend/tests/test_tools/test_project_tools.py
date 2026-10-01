import pytest
from app.tools.registry import _TOOLS


@pytest.fixture(autouse=True)
def _load():
    saved = dict(_TOOLS)
    import importlib
    import app.tools.project_tools
    _TOOLS.clear()
    importlib.reload(app.tools.project_tools)
    yield
    _TOOLS.clear()
    _TOOLS.update(saved)


def test_project_tools_registered():
    names = {t.name for t in _TOOLS.values() if t.category == "project"}
    assert names == {"project_get", "project_update_variables", "command_history"}


def test_project_update_variables_params():
    td = _TOOLS["project_update_variables"]
    fields = td.params_model.model_fields
    assert "variables" in fields
    assert fields["variables"].is_required()


def test_command_history_params():
    td = _TOOLS["command_history"]
    fields = td.params_model.model_fields
    assert "limit" in fields
    assert "search" in fields
    assert not fields["limit"].is_required()


def test_project_tools_json_schemas():
    for name in ["project_get", "project_update_variables", "command_history"]:
        schema = _TOOLS[name].params_model.model_json_schema()
        assert schema["type"] == "object"
