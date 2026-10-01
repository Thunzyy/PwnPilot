"""Tool registry — shared by agent loop and MCP server."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.tools.schema_builder import build_params_model


@dataclass
class ToolContext:
    """Injected at call-time. NOT exposed in LLM/MCP schemas."""
    db: AsyncSession
    user_id: str
    project_id: str | None


@dataclass
class ToolDef:
    """A registered tool definition."""
    name: str
    description: str
    fn: Callable
    params_model: type[BaseModel]
    category: str


_TOOLS: dict[str, ToolDef] = {}


def tool(name: str, description: str, category: str = "general"):
    """Decorator that registers an async function as an agent tool."""
    def wrapper(fn: Callable) -> Callable:
        if name in _TOOLS:
            raise ValueError(f"Duplicate tool name: {name}")
        params_model = build_params_model(fn, exclude={ToolContext})
        _TOOLS[name] = ToolDef(
            name=name,
            description=description,
            fn=fn,
            params_model=params_model,
            category=category,
        )
        return fn
    return wrapper


def get_all_tools() -> list[ToolDef]:
    """Return all registered tools in registration order."""
    return list(_TOOLS.values())


def get_tool(name: str) -> ToolDef | None:
    """Return a tool by name, or None."""
    return _TOOLS.get(name)


async def execute_tool(name: str, raw_args: dict, ctx: ToolContext) -> Any:
    """Validate args via Pydantic, inject ctx, call fn."""
    tool_def = _TOOLS[name]
    validated = tool_def.params_model.model_validate(raw_args)
    return await tool_def.fn(ctx=ctx, **validated.model_dump())


def load_tools() -> None:
    """Explicit import of all tool modules. Call at FastAPI startup."""
    from app.tools import (  # noqa: F401
        graph_tools,
        kb_tools,
        project_tools,
        terminal_tools,
        timeline_tools,
    )
