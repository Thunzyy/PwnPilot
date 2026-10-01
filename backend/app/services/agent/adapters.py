"""Provider adapters — format tools and parse responses for each LLM provider."""
from __future__ import annotations

import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from app.tools.registry import ToolDef


@dataclass
class ToolCall:
    """A parsed tool call from an LLM response."""
    call_id: str
    name: str
    arguments: dict


@dataclass
class AgentResponse:
    """Parsed response from an LLM that may contain text and/or tool calls."""
    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    done: bool = True
    usage: dict | None = None


class ProviderAdapter(ABC):
    @abstractmethod
    def format_tools(self, tools: list[ToolDef]) -> list[dict]: ...

    @abstractmethod
    def parse_response(self, raw: dict) -> AgentResponse: ...

    @abstractmethod
    def format_tool_result(self, call_id: str, name: str, result: str) -> dict: ...


class OpenAIAdapter(ProviderAdapter):
    def format_tools(self, tools: list[ToolDef]) -> list[dict]:
        return [
            {
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.params_model.model_json_schema(),
                },
            }
            for t in tools
        ]

    def parse_response(self, raw: dict) -> AgentResponse:
        choice = raw["choices"][0]
        message = choice["message"]
        text = message.get("content") or ""
        tool_calls = []
        for tc in message.get("tool_calls", []):
            fn = tc["function"]
            args = (
                json.loads(fn["arguments"])
                if isinstance(fn["arguments"], str)
                else fn["arguments"]
            )
            tool_calls.append(
                ToolCall(call_id=tc["id"], name=fn["name"], arguments=args)
            )
        done = len(tool_calls) == 0
        usage = raw.get("usage")
        return AgentResponse(
            text=text, tool_calls=tool_calls, done=done, usage=usage
        )

    def format_tool_result(self, call_id: str, name: str, result: str) -> dict:
        return {"role": "tool", "tool_call_id": call_id, "content": result}


class AnthropicAdapter(ProviderAdapter):
    def format_tools(self, tools: list[ToolDef]) -> list[dict]:
        return [
            {
                "name": t.name,
                "description": t.description,
                "input_schema": t.params_model.model_json_schema(),
            }
            for t in tools
        ]

    def parse_response(self, raw: dict) -> AgentResponse:
        content_blocks = raw.get("content", [])
        stop_reason = raw.get("stop_reason", "end_turn")
        text_parts: list[str] = []
        tool_calls: list[ToolCall] = []
        for block in content_blocks:
            if block["type"] == "text":
                text_parts.append(block["text"])
            elif block["type"] == "tool_use":
                tool_calls.append(
                    ToolCall(
                        call_id=block["id"],
                        name=block["name"],
                        arguments=block.get("input", {}),
                    )
                )
        done = stop_reason != "tool_use"
        usage = raw.get("usage")
        return AgentResponse(
            text=" ".join(text_parts),
            tool_calls=tool_calls,
            done=done,
            usage=usage,
        )

    def format_tool_result(self, call_id: str, name: str, result: str) -> dict:
        return {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": call_id,
                    "content": result,
                }
            ],
        }


class OllamaAdapter(OpenAIAdapter):
    """Ollama uses OpenAI-compatible format."""
    pass


def get_adapter(provider_type: str) -> ProviderAdapter:
    adapters: dict[str, type[ProviderAdapter]] = {
        "anthropic": AnthropicAdapter,
        "openai": OpenAIAdapter,
        "openai_compat": OpenAIAdapter,
        "ollama": OllamaAdapter,
    }
    cls = adapters.get(provider_type)
    if not cls:
        raise ValueError(f"No adapter for provider type: {provider_type}")
    return cls()
