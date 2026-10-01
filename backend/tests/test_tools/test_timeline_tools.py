import pytest
from app.tools.registry import _TOOLS


@pytest.fixture(autouse=True)
def _load():
    import importlib

    import app.tools.timeline_tools

    _TOOLS.clear()
    importlib.reload(app.tools.timeline_tools)
    yield
    _TOOLS.clear()


def test_timeline_tools_registered():
    names = {t.name for t in _TOOLS.values() if t.category == "timeline"}
    assert names == {"timeline_list", "timeline_add", "timeline_update", "timeline_delete"}


def test_timeline_add_params():
    td = _TOOLS["timeline_add"]
    fields = td.params_model.model_fields
    assert "entry_type" in fields
    assert "content" in fields
    assert "output" in fields
    assert "entry_data" in fields
    assert "ctx" not in fields


def test_timeline_update_params():
    td = _TOOLS["timeline_update"]
    fields = td.params_model.model_fields
    assert "entry_id" in fields
    assert "content" in fields


def test_timeline_tools_json_schemas():
    for name in ["timeline_list", "timeline_add", "timeline_update", "timeline_delete"]:
        schema = _TOOLS[name].params_model.model_json_schema()
        assert schema["type"] == "object"
