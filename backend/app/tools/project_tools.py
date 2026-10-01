"""Project tools (3). Basic project info and command history."""
from __future__ import annotations

from sqlalchemy import select

from app.models.command_history import CommandHistory
from app.models.project import Project
from app.tools.registry import ToolContext, tool


@tool(name="project_get", description="Get current project info (name, type, variables, status)", category="project")
async def project_get(ctx: ToolContext) -> dict:
    if not ctx.project_id:
        return {"error": "No project context"}
    project = await ctx.db.get(Project, ctx.project_id)
    if not project:
        return {"error": "Project not found"}
    return {
        "id": project.id,
        "name": project.name,
        "type": project.type,
        "status": project.status,
        "variables": project.variables or {},
    }


@tool(name="project_update_variables", description="Update project variables (target IP, ports, etc.)", category="project")
async def project_update_variables(ctx: ToolContext, variables: dict) -> dict:
    if not ctx.project_id:
        return {"error": "No project context"}
    project = await ctx.db.get(Project, ctx.project_id)
    if not project:
        return {"error": "Project not found"}
    current = dict(project.variables or {})
    current.update(variables)
    project.variables = current
    await ctx.db.commit()
    return {"updated": True, "variables": current}


@tool(name="command_history", description="List command history for the current project", category="project")
async def command_history(ctx: ToolContext, limit: int = 20, search: str | None = None) -> list[dict]:
    if not ctx.project_id:
        return []
    stmt = (
        select(CommandHistory)
        .where(CommandHistory.project_id == ctx.project_id)
        .order_by(CommandHistory.created_at.desc())
        .limit(limit)
    )
    if search:
        stmt = stmt.where(CommandHistory.command.ilike(f"%{search}%"))
    result = await ctx.db.execute(stmt)
    return [
        {"id": e.id, "command": e.command, "exit_code": e.exit_code, "created_at": str(e.created_at)}
        for e in result.scalars()
    ]
