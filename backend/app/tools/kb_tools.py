"""Knowledge Base tools (6)."""
from __future__ import annotations

from app.models.knowledge import KnowledgeDoc
from app.services.kb_service import KBService
from app.tools.registry import ToolContext, tool


@tool(
    name="kb_search",
    description="Search knowledge base documents (full-text)",
    category="kb",
)
async def kb_search(
    ctx: ToolContext,
    query: str,
    limit: int = 10,
    source_id: str | None = None,
) -> list[dict]:
    svc = KBService(ctx.db)
    result = await svc.search_docs(
        query=query, limit=limit, source_id=source_id
    )
    return [
        {
            "id": item.get("id", ""),
            "title": item.get("title", ""),
            "snippet": item.get("body", "")[:200],
        }
        for item in result.get("items", [])
    ]


@tool(
    name="kb_get_doc",
    description="Read a document's full content by ID",
    category="kb",
)
async def kb_get_doc(ctx: ToolContext, doc_id: str) -> dict:
    doc = await ctx.db.get(KnowledgeDoc, doc_id)
    if not doc:
        return {"error": f"Document {doc_id} not found"}
    tags = doc.tags.split() if doc.tags else []
    return {
        "id": doc.id,
        "title": doc.title,
        "body": doc.body or "",
        "tags": tags,
    }


@tool(
    name="kb_create_doc",
    description="Create a new knowledge base document",
    category="kb",
)
async def kb_create_doc(
    ctx: ToolContext,
    title: str,
    body: str,
    source_id: str,
    parent_id: str | None = None,
    tags: list[str] | None = None,
) -> dict:
    svc = KBService(ctx.db)
    filename = f"{title}.md"
    doc = await svc.create_doc(
        source_id=source_id, folder="/", filename=filename
    )
    if not doc:
        return {"error": "Failed to create document"}
    # Update body and tags
    if body:
        doc = await svc.save_doc(doc.id, body)
    if tags:
        doc.tags = " ".join(tags)
        await ctx.db.commit()
        await ctx.db.refresh(doc)
    return {"id": doc.id, "title": doc.title}


@tool(
    name="kb_update_doc",
    description="Update a document's body content",
    category="kb",
)
async def kb_update_doc(
    ctx: ToolContext, doc_id: str, body: str
) -> dict:
    doc = await ctx.db.get(KnowledgeDoc, doc_id)
    if not doc:
        return {"error": f"Document {doc_id} not found"}
    svc = KBService(ctx.db)
    updated = await svc.save_doc(doc_id, body)
    return {"id": updated.id, "title": updated.title, "updated": True}


@tool(
    name="kb_delete_doc",
    description="Delete a knowledge base document",
    category="kb",
)
async def kb_delete_doc(ctx: ToolContext, doc_id: str) -> dict:
    doc = await ctx.db.get(KnowledgeDoc, doc_id)
    if not doc:
        return {"error": f"Document {doc_id} not found"}
    await ctx.db.delete(doc)
    await ctx.db.commit()
    return {"deleted": True, "id": doc_id}


@tool(
    name="kb_list_tags",
    description="List all tags with usage count",
    category="kb",
)
async def kb_list_tags(
    ctx: ToolContext, source_id: str | None = None
) -> list[dict]:
    svc = KBService(ctx.db)
    return await svc.get_all_tags(source_id=source_id)
