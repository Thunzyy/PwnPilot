import pytest
from pydantic import BaseModel

from app.tools.schema_builder import build_params_model


class FakeContext:
    pass


async def sample_tool(ctx: FakeContext, query: str, limit: int = 10, tags: list[str] | None = None) -> dict:
    return {}


def test_build_params_model_creates_pydantic_model():
    model = build_params_model(sample_tool, exclude={FakeContext})
    assert issubclass(model, BaseModel)


def test_build_params_model_excludes_context():
    model = build_params_model(sample_tool, exclude={FakeContext})
    assert "ctx" not in model.model_fields
    assert "query" in model.model_fields
    assert "limit" in model.model_fields
    assert "tags" in model.model_fields


def test_build_params_model_preserves_defaults():
    model = build_params_model(sample_tool, exclude={FakeContext})
    instance = model(query="test")
    assert instance.limit == 10
    assert instance.tags is None


def test_build_params_model_validates():
    model = build_params_model(sample_tool, exclude={FakeContext})
    with pytest.raises(Exception):
        model()  # missing required 'query'


def test_build_params_model_json_schema():
    model = build_params_model(sample_tool, exclude={FakeContext})
    schema = model.model_json_schema()
    assert schema["type"] == "object"
    assert "query" in schema["properties"]
    assert "limit" in schema["properties"]
