import pytest
from unittest.mock import AsyncMock

from app.tools.registry import (
    ToolContext,
    ToolDef,
    _TOOLS,
    execute_tool,
    get_all_tools,
    get_tool,
    tool,
)


@pytest.fixture(autouse=True)
def clear_registry():
    _TOOLS.clear()
    yield
    _TOOLS.clear()


def test_tool_decorator_registers():
    @tool(name="test_tool", description="A test tool", category="test")
    async def my_tool(ctx: ToolContext, query: str) -> str:
        return query

    assert "test_tool" in _TOOLS
    td = _TOOLS["test_tool"]
    assert td.name == "test_tool"
    assert td.description == "A test tool"
    assert td.category == "test"


def test_tool_duplicate_raises():
    @tool(name="dup", description="first", category="test")
    async def first(ctx: ToolContext) -> str:
        return "first"

    with pytest.raises(ValueError, match="Duplicate tool name"):
        @tool(name="dup", description="second", category="test")
        async def second(ctx: ToolContext) -> str:
            return "second"


def test_tool_params_model_excludes_context():
    @tool(name="paramtest", description="test", category="test")
    async def my_tool(ctx: ToolContext, name: str, count: int = 5) -> dict:
        return {}

    td = _TOOLS["paramtest"]
    assert "ctx" not in td.params_model.model_fields
    assert "name" in td.params_model.model_fields
    assert "count" in td.params_model.model_fields


def test_get_all_tools():
    @tool(name="t1", description="t1", category="test")
    async def t1(ctx: ToolContext) -> str:
        return ""

    @tool(name="t2", description="t2", category="test")
    async def t2(ctx: ToolContext) -> str:
        return ""

    tools = get_all_tools()
    assert len(tools) == 2
    assert tools[0].name == "t1"
    assert tools[1].name == "t2"


def test_get_tool():
    @tool(name="findme", description="find", category="test")
    async def findme(ctx: ToolContext) -> str:
        return ""

    assert get_tool("findme") is not None
    assert get_tool("nope") is None


@pytest.mark.asyncio
async def test_execute_tool_validates_and_calls():
    @tool(name="exec_test", description="test", category="test")
    async def exec_test(ctx: ToolContext, message: str) -> str:
        return f"hello {message}"

    ctx = ToolContext(db=AsyncMock(), user_id="u1", project_id="p1")
    result = await execute_tool("exec_test", {"message": "world"}, ctx)
    assert result == "hello world"


@pytest.mark.asyncio
async def test_execute_tool_validation_error():
    @tool(name="val_test", description="test", category="test")
    async def val_test(ctx: ToolContext, count: int) -> int:
        return count

    ctx = ToolContext(db=AsyncMock(), user_id="u1", project_id="p1")
    with pytest.raises(Exception):
        await execute_tool("val_test", {}, ctx)


@pytest.mark.asyncio
async def test_execute_tool_unknown_tool():
    ctx = ToolContext(db=AsyncMock(), user_id="u1", project_id="p1")
    with pytest.raises(KeyError):
        await execute_tool("nonexistent", {}, ctx)
