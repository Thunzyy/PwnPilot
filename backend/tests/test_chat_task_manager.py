from __future__ import annotations

import asyncio

import pytest

from app.services.chat_task_manager import _STREAM_END, ChatTaskManager
from app.services.llm.types import StreamChunk


class _FailingStreamingProvider:
    def __init__(self, release_error: asyncio.Event):
        self.default_model = "gpt-5.4"
        self.provider_config_id = 2
        self._release_error = release_error

    def get_provider_label(self) -> str:
        return "Codex"

    def get_source_mode(self) -> str:
        return "cli_orchestrated"

    async def chat_stream(self, **kwargs):
        del kwargs
        yield StreamChunk(content="partial answer", done=False)
        await self._release_error.wait()
        raise RuntimeError("Usage limit reached")


@pytest.mark.anyio
async def test_chat_task_manager_broadcasts_done_result_when_stream_errors():
    release_error = asyncio.Event()
    provider = _FailingStreamingProvider(release_error)
    manager = ChatTaskManager()

    await manager.submit(
        message_id="msg-1",
        provider=provider,
        messages=[{"role": "user", "content": "hello"}],
    )
    queue = manager.subscribe("msg-1")

    first = await asyncio.wait_for(queue.get(), timeout=2)
    assert first == {"content": "partial answer", "done": False}

    release_error.set()

    second = await asyncio.wait_for(queue.get(), timeout=2)
    assert second["done"] is True
    assert second["content"] == ""
    assert second["result"].error == "Usage limit reached"
    assert second["result"].content == "partial answer"

    end = await asyncio.wait_for(queue.get(), timeout=2)
    assert end is _STREAM_END
