"""Chat task manager — decouples LLM streaming from client connections.

When a chat request arrives, the manager spawns an asyncio.Task that runs
to completion regardless of whether the client is still connected. Clients
subscribe to receive streaming chunks via asyncio.Queue.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from app.core.logging import get_logger

log = get_logger("chat_task_manager")


def utc_now() -> datetime:
    """Return the current UTC timestamp as a timezone-aware datetime."""
    return datetime.now(UTC)


@dataclass
class ChatTaskResult:
    """Result of a completed chat generation task."""

    message_id: str
    content: str
    model: str | None = None
    provider: str | None = None
    source_mode: str = "api"
    cli_command: str | None = None
    cli_exit_code: int | None = None
    cli_duration_ms: int | None = None
    assistant_message_id: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    error: str | None = None
    completed_at: datetime = field(default_factory=utc_now)


# Sentinel to signal end-of-stream to subscribers
_STREAM_END = object()


class ChatTaskManager:
    """Manages AI generation tasks independently of client connections.

    Tasks run to completion even if all subscribers disconnect.
    Clients subscribe to receive streaming chunks via asyncio.Queue.
    """

    def __init__(self) -> None:
        self._active_tasks: dict[str, asyncio.Task] = {}
        self._subscribers: dict[str, list[asyncio.Queue]] = {}
        self._results: dict[str, ChatTaskResult] = {}
        # TTL for completed results (prevent memory leak)
        self._result_ttl = timedelta(minutes=5)

    async def submit(
        self,
        *,
        message_id: str,
        provider: Any,  # LLMProvider instance
        messages: list[dict],
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        # Persistence params
        conversation_id: str | None = None,
        db_session_factory: Any = None,  # async_session_maker
    ) -> None:
        """Spawn a background generation task.

        The task streams from the LLM provider, pushes chunks to subscribers,
        and persists the result to the database when complete.
        """
        if message_id in self._active_tasks:
            return  # Already running

        self._subscribers[message_id] = []

        task = asyncio.create_task(
            self._run_generation(
                message_id=message_id,
                provider=provider,
                messages=messages,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
                conversation_id=conversation_id,
                db_session_factory=db_session_factory,
            )
        )
        self._active_tasks[message_id] = task
        task.add_done_callback(
            lambda t, mid=message_id: self._on_task_done(mid)
        )

    def subscribe(self, message_id: str) -> asyncio.Queue:
        """Subscribe to streaming chunks for a message.

        Returns an asyncio.Queue that receives:
        - dict chunks: {"content": str, "done": bool, "usage": ...}
        - _STREAM_END sentinel when stream is complete

        If the task already completed, returns a queue pre-loaded with
        the result.
        """
        queue: asyncio.Queue = asyncio.Queue()

        # If already completed, push result immediately
        if message_id in self._results:
            result = self._results[message_id]
            queue.put_nowait({
                "content": result.content,
                "done": True,
                "result": result,
            })
            queue.put_nowait(_STREAM_END)
            return queue

        if message_id in self._subscribers:
            self._subscribers[message_id].append(queue)

        return queue

    def unsubscribe(self, message_id: str, queue: asyncio.Queue) -> None:
        """Remove a subscriber queue."""
        subs = self._subscribers.get(message_id, [])
        if queue in subs:
            subs.remove(queue)

    async def cancel(self, message_id: str) -> bool:
        """Cancel a running generation. Returns True if cancelled."""
        task = self._active_tasks.get(message_id)
        if task and not task.done():
            task.cancel()
            return True
        return False

    def get_result(self, message_id: str) -> ChatTaskResult | None:
        """Get a completed result (from short TTL cache)."""
        self._cleanup_stale_results()
        return self._results.get(message_id)

    def is_running(self, message_id: str) -> bool:
        """Check if a task is currently running."""
        task = self._active_tasks.get(message_id)
        return task is not None and not task.done()

    async def _run_generation(
        self,
        *,
        message_id: str,
        provider: Any,
        messages: list[dict],
        model: str | None,
        temperature: float | None,
        max_tokens: int | None,
        conversation_id: str | None,
        db_session_factory: Any,
    ) -> None:
        """Background task: stream from LLM, push to subscribers, persist."""
        full_content = ""
        usage = None
        resolved_model = model or provider.default_model
        provider_name = provider.get_provider_label()
        source_mode = provider.get_source_mode()
        provider_config_id = getattr(provider, "provider_config_id", None)
        final_metadata: dict[str, Any] = {}

        try:
            async for chunk in provider.chat_stream(
                messages=messages,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
            ):
                if chunk.content:
                    full_content += chunk.content
                    self._broadcast(message_id, {
                        "content": chunk.content,
                        "done": False,
                    })
                if chunk.usage:
                    usage = chunk.usage
                if chunk.metadata:
                    final_metadata.update(chunk.metadata)

            # Stream complete — persist
            assistant_message_id = None
            if conversation_id and db_session_factory:
                assistant_message_id = await self._persist_result(
                    db_session_factory=db_session_factory,
                    conversation_id=conversation_id,
                    content=full_content,
                    model=resolved_model,
                    provider=provider_name,
                    provider_config_id=provider_config_id,
                    source_mode=str(final_metadata.get("source_mode", source_mode)),
                    prompt_tokens=(
                        usage.prompt_tokens if usage else None
                    ),
                    completion_tokens=(
                        usage.completion_tokens if usage else None
                    ),
                    cli_command=self._optional_str(final_metadata.get("cli_command")),
                    cli_exit_code=self._optional_int(final_metadata.get("cli_exit_code")),
                    cli_duration_ms=self._optional_int(final_metadata.get("cli_duration_ms")),
                )

            result = ChatTaskResult(
                message_id=message_id,
                content=full_content,
                model=resolved_model,
                provider=provider_name,
                source_mode=str(final_metadata.get("source_mode", source_mode)),
                cli_command=self._optional_str(final_metadata.get("cli_command")),
                cli_exit_code=self._optional_int(final_metadata.get("cli_exit_code")),
                cli_duration_ms=self._optional_int(final_metadata.get("cli_duration_ms")),
                assistant_message_id=assistant_message_id,
                prompt_tokens=(
                    usage.prompt_tokens if usage else None
                ),
                completion_tokens=(
                    usage.completion_tokens if usage else None
                ),
            )
            self._results[message_id] = result

            # Notify subscribers of completion
            self._broadcast(message_id, {
                "content": "",
                "done": True,
                "result": result,
            })

        except asyncio.CancelledError:
            log.info("Generation cancelled", message_id=message_id)
            # Persist partial content
            assistant_message_id = None
            if conversation_id and db_session_factory and full_content:
                try:
                    assistant_message_id = await asyncio.shield(
                        self._persist_result(
                            db_session_factory=db_session_factory,
                            conversation_id=conversation_id,
                            content=full_content,
                            model=resolved_model,
                            provider=provider_name,
                            provider_config_id=provider_config_id,
                            source_mode=str(final_metadata.get("source_mode", source_mode)),
                            prompt_tokens=None,
                            completion_tokens=None,
                            cli_command=self._optional_str(final_metadata.get("cli_command")),
                            cli_exit_code=self._optional_int(final_metadata.get("cli_exit_code")),
                            cli_duration_ms=self._optional_int(final_metadata.get("cli_duration_ms")),
                        )
                    )
                except (asyncio.CancelledError, Exception):
                    pass

            result = ChatTaskResult(
                message_id=message_id,
                content=full_content,
                model=resolved_model,
                provider=provider_name,
                source_mode=str(final_metadata.get("source_mode", source_mode)),
                cli_command=self._optional_str(final_metadata.get("cli_command")),
                cli_exit_code=self._optional_int(final_metadata.get("cli_exit_code")),
                cli_duration_ms=self._optional_int(final_metadata.get("cli_duration_ms")),
                assistant_message_id=assistant_message_id,
                error="cancelled",
            )
            self._results[message_id] = result
            self._broadcast(message_id, {
                "content": "",
                "done": True,
                "result": result,
            })

        except Exception as e:
            log.error("Generation error", message_id=message_id, error=str(e))
            # Persist partial content with error
            assistant_message_id = None
            if conversation_id and db_session_factory and full_content:
                try:
                    assistant_message_id = await self._persist_result(
                        db_session_factory=db_session_factory,
                        conversation_id=conversation_id,
                        content=full_content,
                        model=resolved_model,
                        provider=provider_name,
                        provider_config_id=provider_config_id,
                        source_mode=str(final_metadata.get("source_mode", source_mode)),
                        prompt_tokens=None,
                        completion_tokens=None,
                        cli_command=self._optional_str(final_metadata.get("cli_command")),
                        cli_exit_code=self._optional_int(final_metadata.get("cli_exit_code")),
                        cli_duration_ms=self._optional_int(final_metadata.get("cli_duration_ms")),
                        error=str(e),
                    )
                except Exception:
                    pass

            result = ChatTaskResult(
                message_id=message_id,
                content=full_content,
                model=resolved_model,
                provider=provider_name,
                source_mode=str(final_metadata.get("source_mode", source_mode)),
                cli_command=self._optional_str(final_metadata.get("cli_command")),
                cli_exit_code=self._optional_int(final_metadata.get("cli_exit_code")),
                cli_duration_ms=self._optional_int(final_metadata.get("cli_duration_ms")),
                assistant_message_id=assistant_message_id,
                error=str(e),
            )
            self._results[message_id] = result
            self._broadcast(message_id, {
                "content": "",
                "done": True,
                "result": result,
            })

        finally:
            # Signal end-of-stream to all subscribers
            self._broadcast_end(message_id)

    def _broadcast(self, message_id: str, data: dict) -> None:
        """Push data to all subscriber queues."""
        for queue in self._subscribers.get(message_id, []):
            try:
                queue.put_nowait(data)
            except asyncio.QueueFull:
                pass  # Drop if queue is full

    def _broadcast_end(self, message_id: str) -> None:
        """Signal end-of-stream to all subscribers."""
        for queue in self._subscribers.get(message_id, []):
            try:
                queue.put_nowait(_STREAM_END)
            except asyncio.QueueFull:
                pass

    def _on_task_done(self, message_id: str) -> None:
        """Cleanup when a task finishes."""
        self._active_tasks.pop(message_id, None)
        self._subscribers.pop(message_id, None)

    async def _persist_result(
        self,
        *,
        db_session_factory: Any,
        conversation_id: str,
        content: str,
        model: str | None,
        provider: str | None,
        provider_config_id: int | None,
        source_mode: str,
        prompt_tokens: int | None,
        completion_tokens: int | None,
        cli_command: str | None = None,
        cli_exit_code: int | None = None,
        cli_duration_ms: int | None = None,
        error: str | None = None,
    ) -> str | None:
        """Persist assistant message using a fresh DB session."""
        from app.models.ai import AIChatMessage, AIConversation

        try:
            async with db_session_factory() as session:
                msg = AIChatMessage(
                    conversation_id=conversation_id,
                    role="assistant",
                    content=content,
                    model=model,
                    provider=provider,
                    source_mode=source_mode,
                    cli_command=cli_command,
                    cli_exit_code=cli_exit_code,
                    cli_duration_ms=cli_duration_ms,
                    tokens_prompt=prompt_tokens,
                    tokens_completion=completion_tokens,
                    error=error,
                )
                session.add(msg)

                # Update conversation model
                conv = await session.get(AIConversation, conversation_id)
                if conv and model:
                    conv.model = model
                    if provider_config_id is not None:
                        conv.provider_config_id = provider_config_id

                await session.commit()
                return msg.id
        except Exception as e:
            log.error("Failed to persist result", error=str(e))
            return None

    @staticmethod
    def _optional_str(value: Any) -> str | None:
        return value if isinstance(value, str) else None

    @staticmethod
    def _optional_int(value: Any) -> int | None:
        return value if isinstance(value, int) else None

    def _cleanup_stale_results(self) -> None:
        """Remove results older than TTL."""
        now = datetime.now(UTC)
        stale = [
            mid
            for mid, result in self._results.items()
            if now - result.completed_at > self._result_ttl
        ]
        for mid in stale:
            del self._results[mid]


# Module-level singleton
chat_task_manager = ChatTaskManager()
