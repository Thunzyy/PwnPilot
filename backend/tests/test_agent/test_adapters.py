import pytest
from pydantic import BaseModel

from app.tools.registry import ToolDef
from app.services.agent.adapters import (
    AnthropicAdapter,
    OpenAIAdapter,
    OllamaAdapter,
    AgentResponse,
    get_adapter,
)


class FakeParams(BaseModel):
    query: str
    limit: int = 10


TOOL = ToolDef(
    name="test_search",
    description="Search things",
    fn=lambda: None,
    params_model=FakeParams,
    category="test",
)


class TestOpenAIAdapter:
    def test_format_tools(self):
        adapter = OpenAIAdapter()
        tools = adapter.format_tools([TOOL])
        assert len(tools) == 1
        assert tools[0]["type"] == "function"
        assert tools[0]["function"]["name"] == "test_search"
        assert "parameters" in tools[0]["function"]

    def test_parse_text_response(self):
        adapter = OpenAIAdapter()
        raw = {
            "choices": [
                {
                    "message": {"role": "assistant", "content": "hello"},
                    "finish_reason": "stop",
                }
            ]
        }
        resp = adapter.parse_response(raw)
        assert resp.text == "hello"
        assert resp.tool_calls == []
        assert resp.done is True

    def test_parse_tool_call_response(self):
        adapter = OpenAIAdapter()
        raw = {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": "call_1",
                                "type": "function",
                                "function": {
                                    "name": "test_search",
                                    "arguments": '{"query": "nmap"}',
                                },
                            }
                        ],
                    },
                    "finish_reason": "tool_calls",
                }
            ],
        }
        resp = adapter.parse_response(raw)
        assert len(resp.tool_calls) == 1
        assert resp.tool_calls[0].name == "test_search"
        assert resp.tool_calls[0].arguments == {"query": "nmap"}
        assert resp.done is False

    def test_format_tool_result(self):
        adapter = OpenAIAdapter()
        result = adapter.format_tool_result("c1", "test", '{"ok": true}')
        assert result["role"] == "tool"
        assert result["tool_call_id"] == "c1"


class TestAnthropicAdapter:
    def test_format_tools(self):
        adapter = AnthropicAdapter()
        tools = adapter.format_tools([TOOL])
        assert len(tools) == 1
        assert tools[0]["name"] == "test_search"
        assert "input_schema" in tools[0]

    def test_parse_text_response(self):
        adapter = AnthropicAdapter()
        raw = {
            "content": [{"type": "text", "text": "hello"}],
            "stop_reason": "end_turn",
        }
        resp = adapter.parse_response(raw)
        assert resp.text == "hello"
        assert resp.tool_calls == []
        assert resp.done is True

    def test_parse_tool_use_response(self):
        adapter = AnthropicAdapter()
        raw = {
            "content": [
                {"type": "text", "text": "Let me search"},
                {
                    "type": "tool_use",
                    "id": "tu_1",
                    "name": "test_search",
                    "input": {"query": "nmap"},
                },
            ],
            "stop_reason": "tool_use",
        }
        resp = adapter.parse_response(raw)
        assert resp.text == "Let me search"
        assert len(resp.tool_calls) == 1
        assert resp.tool_calls[0].call_id == "tu_1"
        assert resp.done is False

    def test_format_tool_result(self):
        adapter = AnthropicAdapter()
        result = adapter.format_tool_result("tu_1", "test", '{"ok": true}')
        assert result["role"] == "user"
        assert result["content"][0]["type"] == "tool_result"
        assert result["content"][0]["tool_use_id"] == "tu_1"


class TestGetAdapter:
    def test_get_openai(self):
        assert isinstance(get_adapter("openai"), OpenAIAdapter)

    def test_get_anthropic(self):
        assert isinstance(get_adapter("anthropic"), AnthropicAdapter)

    def test_get_ollama(self):
        assert isinstance(get_adapter("ollama"), OllamaAdapter)

    def test_get_unknown_raises(self):
        with pytest.raises(ValueError):
            get_adapter("unknown")
