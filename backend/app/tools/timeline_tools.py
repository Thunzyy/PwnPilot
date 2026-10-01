"""Timeline tools (4). Direct SQLAlchemy queries against Timeline model."""
from __future__ import annotations

from sqlalchemy import select

from app.models.timeline import Timeline
from app.tools.registry import ToolContext, tool


@tool(name="timeline_list", description="List timeline entries for the current project", category="timeline")
async def timeline_list(ctx: ToolContext, limit: int = 20, entry_type: str | None = None) -> list[dict]:
    if not ctx.project_id:
        return []
    stmt = (
        select(Timeline)
        .where(Timeline.project_id == ctx.project_id)
        .order_by(Timeline.created_at.desc())
        .limit(limit)
    )
    if entry_type:
        stmt = stmt.where(Timeline.type == entry_type)
    result = await ctx.db.execute(stmt)
    return [
        {"id": e.id, "type": e.type, "content": e.content, "output": e.output, "created_at": str(e.created_at)}
        for e in result.scalars()
    ]


@tool(name="timeline_add", description="Add a timeline entry (note, finding, credential, etc.)", category="timeline")
async def timeline_add(
    ctx: ToolContext,
    entry_type: str,
    content: str,
    output: str | None = None,
    entry_data: dict | None = None,
) -> dict:
    if not ctx.project_id:
        return {"error": "No project context"}
    entry = Timeline(
        project_id=ctx.project_id,
        type=entry_type,
        content=content,
        output=output,
        entry_data=entry_data or {},
    )
    ctx.db.add(entry)
    await ctx.db.commit()
    await ctx.db.refresh(entry)
    return {"id": entry.id, "type": entry.type, "content": entry.content}


@tool(name="timeline_update", description="Update an existing timeline entry", category="timeline")
async def timeline_update(
    ctx: ToolContext,
    entry_id: str,
    content: str | None = None,
    output: str | None = None,
    entry_data: dict | None = None,
) -> dict:
    entry = await ctx.db.get(Timeline, entry_id)
    if not entry:
        return {"error": f"Entry {entry_id} not found"}
    if content is not None:
        entry.content = content
    if output is not None:
        entry.output = output
    if entry_data is not None:
        entry.entry_data = entry_data
    await ctx.db.commit()
    return {"id": entry.id, "updated": True}


@tool(name="timeline_delete", description="Delete a timeline entry", category="timeline")
async def timeline_delete(ctx: ToolContext, entry_id: str) -> dict:
    entry = await ctx.db.get(Timeline, entry_id)
    if not entry:
        return {"error": f"Entry {entry_id} not found"}
    await ctx.db.delete(entry)
    await ctx.db.commit()
    return {"deleted": True, "id": entry_id}
