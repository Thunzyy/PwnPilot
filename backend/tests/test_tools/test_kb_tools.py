"""Tests for KB tools -- registration and param schema tests."""
import pytest

from app.tools.registry import _TOOLS


@pytest.fixture(autouse=True)
def _load_kb_tools():
    import importlib

    import app.tools.kb_tools

    _TOOLS.clear()
    importlib.reload(app.tools.kb_tools)
    yield
    _TOOLS.clear()


def test_kb_tools_registered():
    names = {t.name for t in _TOOLS.values() if t.category == "kb"}
    assert names == {
        "kb_search",
        "kb_get_doc",
        "kb_create_doc",
        "kb_update_doc",
        "kb_delete_doc",
        "kb_list_tags",
    }


def test_kb_search_params():
    td = _TOOLS["kb_search"]
    fields = td.params_model.model_fields
    assert "query" in fields
    assert "limit" in fields
    assert "source_id" in fields
    assert "ctx" not in fields


def test_kb_create_doc_params():
    td = _TOOLS["kb_create_doc"]
    fields = td.params_model.model_fields
    assert "title" in fields
    assert "body" in fields
    assert "source_id" in fields
    assert "parent_id" in fields
    assert "tags" in fields


def test_kb_update_doc_params():
    td = _TOOLS["kb_update_doc"]
    fields = td.params_model.model_fields
    assert "doc_id" in fields
    assert "body" in fields


def test_kb_tools_generate_valid_json_schema():
    for name in [
        "kb_search",
        "kb_get_doc",
        "kb_create_doc",
        "kb_update_doc",
        "kb_delete_doc",
        "kb_list_tags",
    ]:
        td = _TOOLS[name]
        schema = td.params_model.model_json_schema()
        assert schema["type"] == "object"
