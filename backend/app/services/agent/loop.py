"""Agent loop — iterates LLM calls with tool execution until done or max_iterations."""
from __future__ import annotations

import json
import time
from collections.abc import AsyncGenerator
from typing import Any

from app.core.logging import get_logger
from app.services.agent.adapters import AgentResponse, ProviderAdapter
from app.tools.registry import ToolContext, ToolDef, execute_tool

log = get_logger("agent.loop")


class AgentLoop:
    """Provider-agnostic agent loop with tool calling."""

    def __init__(
        self,
        provider: Any,
        adapter: ProviderAdapter,
        ctx: ToolContext,
        max_iterations: int = 20,
    ):
        self.provider = provider
        self.adapter = adapter
        self.ctx = ctx
        self.max_iterations = max_iterations
        self.cancelled = False
        self._seq = 0

    def cancel(self) -> None:
        self.cancelled = True

    async def run(
        self,
        messages: list[dict],
        tools: list[ToolDef],
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncGenerator[dict, None]:
        """Run the agent loop, yielding events."""
        formatted_tools = self.adapter.format_tools(tools)

        for iteration in range(self.max_iterations):
            if self.cancelled:
                yield {"type": "done", "reason": "cancelled"}
                return

            try:
                raw_response = await self.provider.chat_with_tools(
                    messages=messages,
                    tools=formatted_tools,
                    model=model,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
            except Exception as e:
                log.error("LLM call failed", iteration=iteration, error=str(e))
                yield {"type": "error", "error": str(e)}
                return

            response = self.adapter.parse_response(raw_response)

            if response.text:
                yield {"type": "text", "content": response.text}

            if response.done or not response.tool_calls:
                yield {"type": "done", "reason": "complete"}
                return

            # Append assistant message to conversation
            messages.append(self._build_assistant_message(response))

            for tc in response.tool_calls:
                if self.cancelled:
                    yield {
                        "type": "tool_call_error",
                        "call_id": tc.call_id,
                        "seq": self._seq,
                        "name": tc.name,
                        "error": "cancelled",
                    }
                    self._seq += 1
                    continue

                seq = self._seq
                self._seq += 1

                yield {
                    "type": "tool_call_start",
                    "call_id": tc.call_id,
                    "seq": seq,
                    "name": tc.name,
                    "args": tc.arguments,
                }

                start = time.monotonic()
                try:
                    result = await execute_tool(tc.name, tc.arguments, self.ctx)
                    duration_ms = int((time.monotonic() - start) * 1000)

                    yield {
                        "type": "tool_call_result",
                        "call_id": tc.call_id,
                        "seq": seq,
                        "name": tc.name,
                        "result": result,
                        "duration_ms": duration_ms,
                        "success": True,
                    }

                    result_str = json.dumps(result, default=str)
                    messages.append(
                        self.adapter.format_tool_result(
                            tc.call_id, tc.name, result_str
                        )
                    )
                except Exception as e:
                    duration_ms = int((time.monotonic() - start) * 1000)
                    log.error("Tool error", tool=tc.name, error=str(e))

                    yield {
                        "type": "tool_call_error",
                        "call_id": tc.call_id,
                        "seq": seq,
                        "name": tc.name,
                        "error": str(e),
                    }

                    error_str = json.dumps({"error": str(e)})
                    messages.append(
                        self.adapter.format_tool_result(
                            tc.call_id, tc.name, error_str
                        )
                    )

        yield {"type": "max_iterations_reached", "iterations": self.max_iterations}
        yield {"type": "done", "reason": "max_iterations"}

    def _build_assistant_message(self, response: AgentResponse) -> dict:
        msg: dict = {"role": "assistant", "content": response.text or None}
        if response.tool_calls:
            msg["tool_calls"] = [
                {
                    "id": tc.call_id,
                    "type": "function",
                    "function": {
                        "name": tc.name,
                        "arguments": json.dumps(tc.arguments),
                    },
                }
                for tc in response.tool_calls
            ]
        return msg
