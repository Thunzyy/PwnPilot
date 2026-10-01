import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.agent.loop import AgentLoop
from app.services.agent.adapters import AgentResponse, ToolCall, OpenAIAdapter
from app.tools.registry import ToolContext, ToolDef


@pytest.fixture
def mock_ctx():
    return ToolContext(db=AsyncMock(), user_id="u1", project_id="p1")


@pytest.mark.asyncio
async def test_text_only_response(mock_ctx):
    """When LLM returns text with no tool calls, loop completes in 1 iteration."""
    provider = AsyncMock()
    adapter = MagicMock(spec=OpenAIAdapter)
    adapter.format_tools.return_value = []
    adapter.parse_response.return_value = AgentResponse(text="Hello!", done=True)
    provider.chat_with_tools = AsyncMock(return_value={})

    loop = AgentLoop(provider=provider, adapter=adapter, ctx=mock_ctx)

    events = []
    async for event in loop.run(messages=[{"role": "user", "content": "hi"}], tools=[]):
        events.append(event)

    text_events = [e for e in events if e["type"] == "text"]
    done_events = [e for e in events if e["type"] == "done"]
    assert len(text_events) == 1
    assert text_events[0]["content"] == "Hello!"
    assert len(done_events) == 1
    assert done_events[0]["reason"] == "complete"


@pytest.mark.asyncio
async def test_max_iterations(mock_ctx):
    """Loop stops after max_iterations."""
    provider = AsyncMock()
    adapter = MagicMock(spec=OpenAIAdapter)
    adapter.format_tools.return_value = []
    adapter.parse_response.return_value = AgentResponse(
        text="",
        tool_calls=[ToolCall(call_id="c1", name="fake", arguments={})],
        done=False,
    )
    adapter.format_tool_result.return_value = {"role": "tool", "content": "ok"}
    provider.chat_with_tools = AsyncMock(return_value={})

    loop = AgentLoop(
        provider=provider, adapter=adapter, ctx=mock_ctx, max_iterations=2
    )

    events = []
    with patch(
        "app.services.agent.loop.execute_tool",
        new_callable=AsyncMock,
        return_value={"ok": True},
    ):
        async for event in loop.run(
            messages=[{"role": "user", "content": "go"}], tools=[]
        ):
            events.append(event)

    tool_starts = [e for e in events if e["type"] == "tool_call_start"]
    assert len(tool_starts) == 2  # 2 iterations
    done = [e for e in events if e["type"] == "done"]
    assert done[-1]["reason"] == "max_iterations"


@pytest.mark.asyncio
async def test_cancel(mock_ctx):
    """Cancelling the loop stops iteration."""
    provider = AsyncMock()
    adapter = MagicMock(spec=OpenAIAdapter)
    adapter.format_tools.return_value = []
    adapter.parse_response.return_value = AgentResponse(
        text="Starting...", done=True
    )
    provider.chat_with_tools = AsyncMock(return_value={})

    loop = AgentLoop(provider=provider, adapter=adapter, ctx=mock_ctx)
    loop.cancel()

    events = []
    async for event in loop.run(messages=[], tools=[]):
        events.append(event)

    assert events[0]["type"] == "done"
    assert events[0]["reason"] == "cancelled"


@pytest.mark.asyncio
async def test_llm_error(mock_ctx):
    """LLM call failure yields error event."""
    provider = AsyncMock()
    adapter = MagicMock(spec=OpenAIAdapter)
    adapter.format_tools.return_value = []
    provider.chat_with_tools = AsyncMock(side_effect=RuntimeError("API down"))

    loop = AgentLoop(provider=provider, adapter=adapter, ctx=mock_ctx)

    events = []
    async for event in loop.run(messages=[], tools=[]):
        events.append(event)

    assert events[0]["type"] == "error"
    assert "API down" in events[0]["error"]
