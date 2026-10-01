"""Attack Graph tools (4)."""
from __future__ import annotations

import uuid

from app.models.project import Project
from app.schemas.engagement import (
    EngagementGraphEdge,
    EngagementGraphNode,
    EngagementGraphNodePosition,
    EngagementStateBase,
)
from app.services.engagement_provider_factory import get_engagement_state_store
from app.services.graph_service import GraphService
from app.tools.registry import ToolContext, tool


async def _get_state_and_project(ctx: ToolContext) -> tuple[EngagementStateBase, Project]:
    """Helper: load project and engagement state."""
    project = await ctx.db.get(Project, ctx.project_id)
    if not project:
        raise ValueError("Project not found")
    store = get_engagement_state_store()
    state = await store.read(project)
    if state is None:
        state = EngagementStateBase()
    return state, project


async def _get_project(ctx: ToolContext) -> Project | None:
    if not ctx.project_id:
        return None
    return await ctx.db.get(Project, ctx.project_id)


@tool(name="graph_get_state", description="Get full engagement state (checklist + graph)", category="graph")
async def graph_get_state(ctx: ToolContext) -> dict:
    if not ctx.project_id:
        return {"error": "No project context"}
    state, _ = await _get_state_and_project(ctx)
    return state.model_dump()


@tool(name="graph_update_state", description="Persist complete engagement state (freezes snapshot)", category="graph")
async def graph_update_state(ctx: ToolContext, state: dict) -> dict:
    if not ctx.project_id:
        return {"error": "No project context"}
    project = await ctx.db.get(Project, ctx.project_id)
    if not project:
        return {"error": "Project not found"}
    parsed = EngagementStateBase.model_validate(state)
    store = get_engagement_state_store()
    await store.write(project, parsed)
    await ctx.db.commit()
    return {"updated": True, "source": "stored"}


@tool(name="graph_add_node", description="Add a node to the engagement graph (read-modify-write)", category="graph")
async def graph_add_node(
    ctx: ToolContext,
    title: str,
    subtitle: str = "\u2014",
    icon: str = "circle",
    kind: str = "default",
    position: dict | None = None,
    branch: str | None = None,
) -> dict:
    if not ctx.project_id:
        return {"error": "No project context"}
    state, project = await _get_state_and_project(ctx)
    node_id = str(uuid.uuid4())
    pos = position or {"x": "0", "y": "0"}
    new_node = EngagementGraphNode(
        id=node_id,
        type=kind,
        status="pending",
        title=title,
        subtitle=subtitle,
        icon=icon,
        position=EngagementGraphNodePosition(x=str(pos.get("x", "0")), y=str(pos.get("y", "0"))),
    )
    state.graph.nodes.append(new_node)
    store = get_engagement_state_store()
    await store.write(project, state)
    await ctx.db.commit()
    return {"node_id": node_id, "title": title}


@tool(name="graph_add_edge", description="Add an edge between two nodes in the engagement graph", category="graph")
async def graph_add_edge(ctx: ToolContext, source_id: str, target_id: str) -> dict:
    if not ctx.project_id:
        return {"error": "No project context"}
    state, project = await _get_state_and_project(ctx)
    edge_id = str(uuid.uuid4())
    new_edge = EngagementGraphEdge(id=edge_id, source_id=source_id, target_id=target_id)
    state.graph.edges.append(new_edge)
    store = get_engagement_state_store()
    await store.write(project, state)
    await ctx.db.commit()
    return {"edge_id": edge_id, "source_id": source_id, "target_id": target_id}


@tool(
    name="graph_v2_get",
    description="Get the typed attack graph v2 for the current project",
    category="graph",
)
async def graph_v2_get(ctx: ToolContext) -> dict:
    project = await _get_project(ctx)
    if not project:
        return {"error": "Project not found"}
    service = GraphService(ctx.db)
    graph = await service.get_graph(project.id)
    return graph.model_dump()


@tool(
    name="graph_v2_seed_demo_ctf",
    description="Seed a realistic CTF workspace (commands, timeline, AI, KB) and return the graph",
    category="graph",
)
async def graph_v2_seed_demo_ctf(ctx: ToolContext) -> dict:
    project = await _get_project(ctx)
    if not project:
        return {"error": "Project not found"}
    service = GraphService(ctx.db)
    graph = await service.seed_demo_ctf(project, user_id=ctx.user_id)
    return graph.model_dump()


@tool(
    name="graph_v2_paths",
    description="Compute shortest path(s) between two nodes in the typed graph",
    category="graph",
)
async def graph_v2_paths(ctx: ToolContext, from_id: str, to_id: str) -> dict:
    project = await _get_project(ctx)
    if not project:
        return {"error": "Project not found"}
    service = GraphService(ctx.db)
    paths = await service.get_shortest_paths(
        project_id=project.id,
        from_id=from_id,
        to_id=to_id,
    )
    return paths.model_dump()
