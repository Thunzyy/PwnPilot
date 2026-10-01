"""WebSocket endpoint for AI chat streaming.

Protocol:
  Client -> Server: WSChatMessage | WSCancelMessage  (JSON)
  Server -> Client: WSChunkResponse | WSCompleteResponse |
                   WSCancelledResponse | WSErrorResponse  (JSON)
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import decode_access_token
from app.core.errors import ErrorCode
from app.core.logging import get_logger
from app.database import async_session_maker, get_db
from app.models.ai import AIAttachment, AIChatMessage, AIConversation, AISystemPrompt
from app.models.user import User
from app.schemas.ai import (
    WSCancelledResponse,
    WSChatMessage,
    WSChunkResponse,
    WSCompleteResponse,
    WSErrorResponse,
    WSToolCallError,
    WSToolCallResult,
    WSToolCallStart,
)
from app.services.chat_task_manager import _STREAM_END, ChatTaskResult, chat_task_manager
from app.services.context_builder import ContextBuilder
from app.services.llm_service import LLMService

router = APIRouter(tags=["ai-chat"])
log = get_logger("ws.chat")


# =============================================================================
# Auth helper
# =============================================================================


async def _authenticate_ws(websocket: WebSocket, db: AsyncSession) -> User | None:
    """Authenticate a WebSocket connection via query param or first message."""
    token = websocket.query_params.get("token")
    if not token:
        return None

    try:
        payload = decode_access_token(token)
    except Exception:
        return None

    user_id = payload.get("sub")
    if not user_id:
        return None

    user = await db.get(User, user_id)
    if not user or not user.is_active:
        return None

    return user


# =============================================================================
# Default system prompt
# =============================================================================

DEFAULT_SYSTEM_PROMPT = (
    "You are PwnPilot AI, a penetration testing and CTF assistant. "
    "You help with reconnaissance, enumeration, exploitation, "
    "privilege escalation, and report writing. "
    "When the user provides project context, use it to give specific, "
    "actionable advice. Always prioritize accuracy and safety."
)


async def _get_system_prompt(
    db: AsyncSession,
    user_id: str,
    context_type: str,
) -> str:
    """Get the user's default system prompt for this context type."""
    stmt = select(AISystemPrompt).where(
        AISystemPrompt.user_id == user_id,
        AISystemPrompt.context_type == context_type,
        AISystemPrompt.is_default.is_(True),
    )
    result = await db.execute(stmt)
    prompt = result.scalar_one_or_none()
    if prompt:
        return prompt.content
    return DEFAULT_SYSTEM_PROMPT


# =============================================================================
# Persistence helpers
# =============================================================================


async def _persist_user_message(
    db: AsyncSession,
    conversation_id: str,
    content: str,
    attachment_ids: list[str],
) -> str:
    """Persist a user message and link attachments. Returns message ID."""
    msg = AIChatMessage(
        conversation_id=conversation_id,
        role="user",
        content=content,
    )
    db.add(msg)
    await db.flush()

    if attachment_ids:
        for att_id in attachment_ids:
            att = await db.get(AIAttachment, att_id)
            if att:
                att.message_id = msg.id

    await db.commit()
    return msg.id


async def _persist_assistant_message(
    db: AsyncSession,
    conversation_id: str,
    content: str,
    model: str | None,
    provider: str | None,
    source_mode: str,
    tokens_prompt: int | None,
    tokens_completion: int | None,
    cli_command: str | None = None,
    cli_exit_code: int | None = None,
    cli_duration_ms: int | None = None,
    error: str | None = None,
) -> str:
    """Persist an assistant message. Returns message ID."""
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
        tokens_prompt=tokens_prompt,
        tokens_completion=tokens_completion,
        error=error,
    )
    db.add(msg)
    await db.commit()
    return msg.id


async def _update_conversation_title(
    db: AsyncSession,
    conversation_id: str,
    first_message: str,
) -> None:
    """Auto-set conversation title from first user message."""
    conv = await db.get(AIConversation, conversation_id)
    if conv and conv.title == "New Chat":
        conv.title = first_message[:50].strip()
        if len(first_message) > 50:
            conv.title += "..."
        await db.commit()


async def _update_conversation_model(
    db: AsyncSession,
    conversation_id: str,
    model: str,
) -> None:
    """Update the last-used model on the conversation."""
    conv = await db.get(AIConversation, conversation_id)
    if conv:
        conv.model = model
        await db.commit()


# =============================================================================
# Shared message builder (reused by REST endpoint)
# =============================================================================


async def build_messages_from_conversation(
    db: AsyncSession,
    conversation_id: str,
    new_content: str,
    system_prompt: str,
    project_context: str | None = None,
    mode: str = "question",
) -> list[dict]:
    """Load conversation history from DB and build messages list.

    This is shared between the WebSocket handler and the REST chat endpoint.
    """
    messages: list[dict] = [{"role": "system", "content": system_prompt}]

    if project_context:
        messages.append(
            {"role": "user", "content": f"<context>\n{project_context}\n</context>"}
        )

    # Load previous messages from the conversation
    stmt = (
        select(AIChatMessage)
        .where(AIChatMessage.conversation_id == conversation_id)
        .order_by(AIChatMessage.created_at)
    )
    result = await db.execute(stmt)
    for msg in result.scalars():
        # In question mode, skip tool messages
        if mode == "question" and msg.role == "tool":
            continue
        messages.append({"role": msg.role, "content": msg.content})

    # Append the new user message
    messages.append({"role": "user", "content": new_content})
    return messages


# =============================================================================
# WebSocket endpoint
# =============================================================================


@router.websocket("/ws/ai/global")
async def ws_ai_chat_global(
    websocket: WebSocket,
    db: AsyncSession = Depends(get_db),
):
    """WebSocket endpoint for global (non-project) AI chat."""
    await _ws_ai_chat_impl(websocket, None, db)


@router.websocket("/ws/ai/{project_id}")
async def ws_ai_chat(
    websocket: WebSocket,
    project_id: str,
    db: AsyncSession = Depends(get_db),
):
    """WebSocket endpoint for streaming AI chat."""
    await _ws_ai_chat_impl(websocket, project_id, db)


async def _ws_ai_chat_impl(
    websocket: WebSocket,
    project_id: str | None,
    db: AsyncSession,
):
    """Shared implementation for project and global AI chat WS."""
    await websocket.accept()

    # Authenticate
    user = await _authenticate_ws(websocket, db)
    if user is None:
        await websocket.send_json(
            WSErrorResponse(
                code=ErrorCode.AUTH_INVALID_TOKEN,
                message="Authentication required",
            ).model_dump()
        )
        await websocket.close(code=4001)
        return

    # Release the auth session immediately. Holding a SQLite reader open for the
    # lifetime of the WebSocket can block later writes from the REST chat/CLI flows.
    await db.close()

    log.info("AI chat connected", user_id=user.id, project_id=project_id)

    # Track subscriber queues and local forwarding tasks for cleanup
    subscriber_queues: dict[str, asyncio.Queue] = {}
    forwarding_tasks: dict[str, asyncio.Task] = {}

    try:
        while True:
            raw = await websocket.receive_json()
            msg_type = raw.get("type")

            if msg_type == "chat":
                msg = WSChatMessage.model_validate(raw)
                asyncio.create_task(
                    _handle_chat(
                        websocket, user, project_id, msg,
                        subscriber_queues, forwarding_tasks,
                    )
                )
                # The _handle_chat task is short-lived: it sets up the
                # ChatTaskManager submission and spawns a forwarding task.
                # We don't need to track it in active_tasks.

            elif msg_type == "cancel":
                message_id = raw.get("message_id", "")

                # Cancel the generation in ChatTaskManager
                cancelled = await chat_task_manager.cancel(message_id)
                if cancelled:
                    await websocket.send_json(
                        WSCancelledResponse(message_id=message_id).model_dump()
                    )

                # Clean up local forwarding task
                ft = forwarding_tasks.pop(message_id, None)
                if ft and not ft.done():
                    ft.cancel()

                # Unsubscribe from the queue
                q = subscriber_queues.pop(message_id, None)
                if q:
                    chat_task_manager.unsubscribe(message_id, q)

    except WebSocketDisconnect:
        log.info("AI chat disconnected", user_id=user.id)
    except Exception as e:
        log.error("WebSocket error", error=str(e))
    finally:
        # Unsubscribe all queues (generation tasks keep running in ChatTaskManager)
        for mid, q in subscriber_queues.items():
            chat_task_manager.unsubscribe(mid, q)
        # Cancel local forwarding tasks
        for ft in forwarding_tasks.values():
            if not ft.done():
                ft.cancel()


# =============================================================================
# Chat handler (setup + delegate to ChatTaskManager)
# =============================================================================


async def _handle_chat(
    ws: WebSocket,
    user: User,
    project_id: str | None,
    msg: WSChatMessage,
    subscriber_queues: dict[str, asyncio.Queue],
    forwarding_tasks: dict[str, asyncio.Task],
) -> None:
    """Set up a chat generation: persist user msg, submit to ChatTaskManager, forward chunks."""
    try:
        async with async_session_maker() as db:
            # 1. Persist user message (if conversation provided)
            user_message_id = None
            if msg.conversation_id:
                user_message_id = await _persist_user_message(
                    db, msg.conversation_id, msg.content, msg.attachment_ids,
                )
                await _update_conversation_title(db, msg.conversation_id, msg.content)

            # 2. Resolve provider
            svc = LLMService(db)

            if msg.overrides and msg.overrides.provider_id:
                provider = await svc.get_provider_by_id(
                    msg.overrides.provider_id, user_id=user.id
                )
            else:
                provider = await svc.get_provider_for_context(
                    user_id=user.id,
                    context_type=msg.context_type,
                    project_id=project_id,
                )

            if provider is None:
                await ws.send_json(
                    WSErrorResponse(
                        message_id=msg.message_id,
                        code=ErrorCode.AI_PROVIDER_NOT_FOUND,
                        message="No AI provider configured. Go to Settings -> AI to add one.",
                    ).model_dump()
                )
                return

            # 2b. If agent mode, delegate to agent handler
            if msg.mode == "agent":
                await _handle_agent_chat(
                    ws, db, user, project_id, msg, provider,
                    subscriber_queues, forwarding_tasks,
                )
                return

            # 3. Build context (skip for global/non-project chats)
            context = ""
            if project_id:
                ctx_builder = ContextBuilder(db)
                context = await ctx_builder.build(
                    project_id=project_id,
                    preset="standard",
                )

            # 4. Build messages (with conversation history)
            system_prompt = DEFAULT_SYSTEM_PROMPT
            if msg.overrides and msg.overrides.system_prompt:
                system_prompt = msg.overrides.system_prompt
            else:
                system_prompt = await _get_system_prompt(db, user.id, msg.context_type)

            if msg.conversation_id:
                messages = await build_messages_from_conversation(
                    db,
                    conversation_id=msg.conversation_id,
                    new_content=msg.content,
                    system_prompt=system_prompt,
                    project_context=context,
                )
            else:
                # No conversation — single message, no history
                messages = [{"role": "system", "content": system_prompt}]
                if context:
                    messages.append(
                        {"role": "user", "content": f"<context>\n{context}\n</context>"}
                    )
                messages.append({"role": "user", "content": msg.content})

        # 5. Submit to ChatTaskManager (fire-and-forget generation)
        model = msg.overrides.model if msg.overrides else None
        temperature = msg.overrides.temperature if msg.overrides else None
        max_tokens = msg.overrides.max_tokens if msg.overrides else None

        await chat_task_manager.submit(
            message_id=msg.message_id,
            provider=provider,
            messages=messages,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            conversation_id=msg.conversation_id,
            db_session_factory=async_session_maker,
        )

        # 6. Subscribe to receive chunks
        queue = chat_task_manager.subscribe(msg.message_id)
        subscriber_queues[msg.message_id] = queue

        # 7. Spawn a forwarding task to drain queue -> WebSocket
        ft = asyncio.create_task(
            _forward_chunks(
                ws, msg.message_id, user_message_id, queue,
                subscriber_queues, forwarding_tasks,
            )
        )
        forwarding_tasks[msg.message_id] = ft

    except Exception as e:
        log.error("Chat setup error", message_id=msg.message_id, error=str(e))
        try:
            await ws.send_json(
                WSErrorResponse(
                    message_id=msg.message_id,
                    code=ErrorCode.AI_PROVIDER_ERROR,
                    message=str(e),
                ).model_dump()
            )
        except Exception:
            pass


# =============================================================================
# Forwarding task (queue -> WebSocket)
# =============================================================================


async def _forward_chunks(
    ws: WebSocket,
    message_id: str,
    user_message_id: str | None,
    queue: asyncio.Queue,
    subscriber_queues: dict[str, asyncio.Queue],
    forwarding_tasks: dict[str, asyncio.Task],
) -> None:
    """Forward chunks from ChatTaskManager queue to WebSocket client."""
    chunk_index = 0
    try:
        while True:
            data = await queue.get()

            if data is _STREAM_END:
                break

            if data.get("done"):
                result: ChatTaskResult | None = data.get("result")
                if result:
                    complete = WSCompleteResponse(
                        message_id=message_id,
                        model=result.model,
                        provider=result.provider,
                        source_mode=result.source_mode,
                        cli_command=result.cli_command,
                        user_message_id=user_message_id,
                        assistant_message_id=result.assistant_message_id,
                        prompt_tokens=result.prompt_tokens,
                        completion_tokens=result.completion_tokens,
                    )
                    if result.prompt_tokens and result.completion_tokens:
                        complete.total_tokens = (
                            result.prompt_tokens + result.completion_tokens
                        )
                    await ws.send_json(complete.model_dump())

                    if result.error:
                        await ws.send_json(
                            WSErrorResponse(
                                message_id=message_id,
                                code=ErrorCode.AI_PROVIDER_ERROR,
                                message=result.error,
                            ).model_dump()
                        )
                break

            # Regular content chunk
            await ws.send_json(
                WSChunkResponse(
                    message_id=message_id,
                    content=data["content"],
                    index=chunk_index,
                ).model_dump()
            )
            chunk_index += 1

    except asyncio.CancelledError:
        pass
    except Exception as e:
        log.debug("Forward error", message_id=message_id, error=str(e))
    finally:
        subscriber_queues.pop(message_id, None)
        forwarding_tasks.pop(message_id, None)


# =============================================================================
# Agent mode handler
# =============================================================================


async def _handle_agent_chat(
    ws: WebSocket,
    db: AsyncSession,
    user: User,
    project_id: str | None,
    msg: WSChatMessage,
    provider,
    subscriber_queues: dict,
    forwarding_tasks: dict,
) -> None:
    """Handle an agent-mode chat message with tool calling."""
    from app.services.agent.adapters import get_adapter
    from app.services.agent.loop import AgentLoop
    from app.tools.registry import ToolContext, get_all_tools

    try:
        # Persist user message
        user_message_id = None
        if msg.conversation_id:
            user_message_id = await _persist_user_message(
                db, msg.conversation_id, msg.content, msg.attachment_ids,
            )
            await _update_conversation_title(db, msg.conversation_id, msg.content)

        # Build context + messages
        context = ""
        if project_id:
            ctx_builder = ContextBuilder(db)
            context = await ctx_builder.build(project_id=project_id, preset="full")
        system_prompt = await _get_system_prompt(db, user.id, msg.context_type)

        if msg.overrides and msg.overrides.system_prompt:
            system_prompt = msg.overrides.system_prompt

        agent_system = (
            f"{system_prompt}\n\n"
            "You are in AGENT mode. You have access to tools for interacting with "
            "the project's terminal, timeline, knowledge base, and attack graph. "
            "Use tools proactively to accomplish the user's goals. "
            "Think step by step and use multiple tools if needed."
        )

        if msg.conversation_id:
            messages = await build_messages_from_conversation(
                db, msg.conversation_id, msg.content, agent_system, context,
                mode="agent",
            )
        else:
            messages: list[dict] = [{"role": "system", "content": agent_system}]
            if context:
                messages.append(
                    {"role": "user", "content": f"<context>\n{context}\n</context>"}
                )
            messages.append({"role": "user", "content": msg.content})

        # Create adapter and loop
        provider_type = type(provider).__name__.lower().replace("provider", "")
        type_map = {
            "anthropic": "anthropic",
            "openaicompatible": "openai_compat",
            "openai": "openai",
            "ollama": "ollama",
        }
        adapter = get_adapter(type_map.get(provider_type, "openai_compat"))
        tool_ctx = ToolContext(db=db, user_id=user.id, project_id=project_id)
        tools = get_all_tools()

        model = msg.overrides.model if msg.overrides else None
        temperature = msg.overrides.temperature if msg.overrides else None
        max_tokens = msg.overrides.max_tokens if msg.overrides else None

        loop = AgentLoop(provider=provider, adapter=adapter, ctx=tool_ctx)

        # Run the loop and forward events
        full_text = ""
        async for event in loop.run(
            messages=messages, tools=tools,
            model=model, temperature=temperature, max_tokens=max_tokens,
        ):
            etype = event["type"]

            if etype == "text":
                full_text += event["content"]
                await ws.send_json(
                    WSChunkResponse(
                        message_id=msg.message_id,
                        content=event["content"],
                        index=0,
                    ).model_dump()
                )

            elif etype == "tool_call_start":
                await ws.send_json(WSToolCallStart(
                    message_id=msg.message_id,
                    call_id=event["call_id"],
                    seq=event["seq"],
                    name=event["name"],
                    args=event["args"],
                ).model_dump())

            elif etype == "tool_call_result":
                await ws.send_json(WSToolCallResult(
                    message_id=msg.message_id,
                    call_id=event["call_id"],
                    seq=event["seq"],
                    name=event["name"],
                    result=event["result"],
                    duration_ms=event["duration_ms"],
                    success=event["success"],
                ).model_dump())

                # Persist tool call as message
                if msg.conversation_id:
                    await _persist_tool_message(db, msg.conversation_id, event)

            elif etype == "tool_call_error":
                await ws.send_json(WSToolCallError(
                    message_id=msg.message_id,
                    call_id=event["call_id"],
                    seq=event["seq"],
                    name=event["name"],
                    error=event["error"],
                ).model_dump())

            elif etype == "done":
                assistant_message_id = None
                if msg.conversation_id and full_text:
                    assistant_message_id = await _persist_assistant_message(
                        db, msg.conversation_id, full_text,
                        model=model or provider.default_model,
                        provider=provider.get_provider_label(),
                        source_mode=provider.get_source_mode(),
                        tokens_prompt=None,
                        tokens_completion=None,
                    )

                await ws.send_json(WSCompleteResponse(
                    message_id=msg.message_id,
                    model=model or provider.default_model,
                    provider=provider.get_provider_label(),
                    source_mode=provider.get_source_mode(),
                    user_message_id=user_message_id,
                    assistant_message_id=assistant_message_id,
                ).model_dump())

    except Exception as e:
        log.error("Agent chat error", message_id=msg.message_id, error=str(e))
        await ws.send_json(WSErrorResponse(
            message_id=msg.message_id,
            code="AGENT_ERROR",
            message=str(e),
        ).model_dump())


async def _persist_tool_message(
    db: AsyncSession,
    conversation_id: str,
    event: dict,
) -> None:
    """Persist a tool call result as a role='tool' message."""
    import json as _json

    msg = AIChatMessage(
        conversation_id=conversation_id,
        role="tool",
        content=_json.dumps(event.get("result", {}), default=str),
        tool_call_id=event.get("call_id"),
        tool_name=event.get("name"),
        tool_args=event.get("args"),
        tool_result=event.get("result"),
        tool_duration_ms=event.get("duration_ms"),
    )
    db.add(msg)
    await db.commit()
