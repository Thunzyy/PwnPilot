import pytest
from app.tools.registry import _TOOLS


@pytest.fixture(autouse=True)
def _load():
    saved = dict(_TOOLS)
    import importlib
    import app.tools.graph_tools
    _TOOLS.clear()
    importlib.reload(app.tools.graph_tools)
    yield
    _TOOLS.clear()
    _TOOLS.update(saved)


def test_graph_tools_registered():
    names = {t.name for t in _TOOLS.values() if t.category == "graph"}
    assert names == {
        "graph_get_state",
        "graph_update_state",
        "graph_add_node",
        "graph_add_edge",
        "graph_v2_get",
        "graph_v2_seed_demo_ctf",
        "graph_v2_paths",
    }


def test_graph_add_node_params():
    td = _TOOLS["graph_add_node"]
    fields = td.params_model.model_fields
    assert "title" in fields
    assert "subtitle" in fields
    assert "icon" in fields
    assert "kind" in fields
    assert "position" in fields
    assert "ctx" not in fields


def test_graph_add_edge_params():
    td = _TOOLS["graph_add_edge"]
    fields = td.params_model.model_fields
    assert "source_id" in fields
    assert "target_id" in fields


def test_graph_v2_paths_params():
    td = _TOOLS["graph_v2_paths"]
    fields = td.params_model.model_fields
    assert "from_id" in fields
    assert "to_id" in fields


def test_graph_tools_json_schemas():
    for name in [
        "graph_get_state",
        "graph_update_state",
        "graph_add_node",
        "graph_add_edge",
        "graph_v2_get",
        "graph_v2_seed_demo_ctf",
        "graph_v2_paths",
    ]:
        td = _TOOLS[name]
        schema = td.params_model.model_json_schema()
        assert schema["type"] == "object"
