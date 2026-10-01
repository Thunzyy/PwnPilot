"""Knowledge Base API endpoints.

Thin router that delegates all business logic to KBService.
Endpoints: search, document list/detail/tree, attachments,
source CRUD, background indexing, sync, and community catalog.
"""

from __future__ import annotations

import json
import logging
import mimetypes
import shutil
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, Query, status
from fastapi.responses import FileResponse
from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.core.errors import ErrorCode
from app.core.exceptions import AppException
from app.core.security import validate_vault_path
from app.database import async_session_maker, get_db
from app.models.knowledge import KnowledgeDoc, KnowledgeSource
from app.schemas.knowledge import (
    AddCommunitySourceRequest,
    AddCustomGitSourceRequest,
    BookmarkCreate,
    BookmarkResponse,
    BulkTagEditRequest,
    BulkTagEditResponse,
    CatalogEntry,
    CreateFolderRequest,
    CreateFolderResponse,
    DeleteTagRequest,
    KnowledgeDocCreate,
    KnowledgeDocDetailResponse,
    KnowledgeDocListResponse,
    KnowledgeDocUpdate,
    KnowledgeSourceCreate,
    KnowledgeSourceResponse,
    KnowledgeSourceUpdate,
    RenameDocRequest,
    RenameDocResponse,
    RenameTagRequest,
    SearchResponse,
    TagInfo,
    TagOperationResponse,
    TreeNode,
)
from app.services.kb_service import KBService
from app.services.sync_service import SyncService

router = APIRouter(prefix="/kb", tags=["knowledge-base"])
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Allowed attachment extensions
# ---------------------------------------------------------------------------

ALLOWED_EXTENSIONS: set[str] = {
    # Images
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico",
    # Documents
    ".pdf", ".txt", ".csv", ".json", ".xml", ".yaml", ".yml",
    # Archives
    ".zip", ".tar", ".gz", ".7z",
    # Code / scripts
    ".py", ".sh", ".bash", ".ps1", ".rb", ".pl",
    # Pentest-specific
    ".nmap", ".gnmap", ".pcap", ".pcapng", ".cap",
    ".ovpn", ".conf", ".cfg", ".ini", ".log",
    ".html", ".htm", ".md",
    # Binary / executable (for analysis)
    ".elf", ".exe", ".dll", ".so",
}

# ---------------------------------------------------------------------------
# Background indexing state
# ---------------------------------------------------------------------------

_index_tasks: dict[str, dict] = {}


async def _run_index_task(
    task_id: str, source_id: str, vault_path: str
) -> None:
    """Background task -- creates its own DB session.

    Loads include_paths from the source record so community repos
    are indexed only within their recommended subdirectories.
    """
    _index_tasks[task_id]["status"] = "running"
    _index_tasks[task_id]["started_at"] = time.time()
    try:
        async with async_session_maker() as db:
            # Load source to get include_paths
            source = await db.get(KnowledgeSource, source_id)
            include_paths = source.include_paths if source else None
            service = KBService(db)
            stats = await service.index_vault(
                source_id, vault_path, include_paths=include_paths
            )
            _index_tasks[task_id]["status"] = "completed"
            _index_tasks[task_id]["stats"] = stats
    except Exception as e:
        _index_tasks[task_id]["status"] = "failed"
        _index_tasks[task_id]["error"] = str(e)


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------


@router.get("/search", response_model=SearchResponse)
async def search_documents(
    q: str = "",
    source_id: str | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    sort_by: str = Query(default="relevance"),
    sort_dir: str = Query(default="desc"),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Full-text search across KB documents with BM25 ranking."""
    service = KBService(db)
    result = await service.search_docs(q, source_id, limit, sort_by=sort_by, sort_dir=sort_dir)
    return SearchResponse(items=result["items"], query=q, total=result["total"])


# ---------------------------------------------------------------------------
# Tags (autocomplete)
# ---------------------------------------------------------------------------


@router.get("/tags", response_model=list[TagInfo])
async def list_tags(
    source_id: str | None = None,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all known tags with document counts for autocomplete."""
    service = KBService(db)
    return await service.get_all_tags(source_id)


@router.post("/tags/rename", response_model=TagOperationResponse)
async def rename_tag(
    data: RenameTagRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Rename a tag across all documents (frontmatter + DB)."""
    service = KBService(db)
    return await service.rename_tag(data.old_tag, data.new_tag)


@router.post("/tags/delete", response_model=TagOperationResponse)
async def delete_tag(
    data: DeleteTagRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a tag from all documents (frontmatter + DB)."""
    service = KBService(db)
    return await service.delete_tag(data.tag)


@router.post("/tags/bulk-edit", response_model=BulkTagEditResponse)
async def bulk_edit_tags(
    data: BulkTagEditRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add and/or remove tags on a set of documents (frontmatter + DB)."""
    service = KBService(db)
    return await service.bulk_edit_tags(
        data.doc_ids, data.add_tags, data.remove_tags
    )


# ---------------------------------------------------------------------------
# Document list
# ---------------------------------------------------------------------------


@router.get("/documents", response_model=KnowledgeDocListResponse)
async def list_documents(
    source_id: str | None = None,
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    tag: str | None = None,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List KB documents with cursor-based pagination and optional tag filter."""
    service = KBService(db)
    return await service.list_docs(source_id, cursor, limit, tag=tag)


# ---------------------------------------------------------------------------
# Document tree (MUST be before /documents/{doc_id})
# ---------------------------------------------------------------------------


@router.get("/documents/tree", response_model=TreeNode)
async def get_document_tree(
    source_id: str | None = None,
    tag: str | None = None,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Nested folder tree of all KB documents."""
    service = KBService(db)
    return await service.get_tree(source_id, tag=tag)


# ---------------------------------------------------------------------------
# Document detail
# ---------------------------------------------------------------------------


@router.get(
    "/documents/{doc_id}",
    response_model=KnowledgeDocDetailResponse,
)
async def get_document(
    doc_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get full document detail including body, backlinks, and source."""
    service = KBService(db)
    doc = await service.get_doc(doc_id)
    backlinks = await service.get_backlinks(doc_id)
    return KnowledgeDocDetailResponse(
        id=doc.id,
        source_id=doc.source_id,
        title=doc.title,
        relative_path=doc.relative_path,
        tags=doc.tags,
        content_hash=doc.content_hash,
        wikilinks=doc.wikilinks,
        frontmatter=doc.frontmatter,
        created_at=doc.created_at,
        updated_at=doc.updated_at,
        body=doc.body,
        backlinks=backlinks,
        source=doc.source,
    )


@router.put(
    "/documents/{doc_id}",
    response_model=KnowledgeDocDetailResponse,
)
async def update_document(
    doc_id: str,
    data: KnowledgeDocUpdate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Save updated markdown content to disk and refresh the DB row.

    The full raw markdown (frontmatter + body) is written to disk,
    then re-parsed. The FTS5 index auto-updates via DB triggers.
    Returns 403 for read-only sources.
    """
    service = KBService(db)
    doc = await service.save_doc(doc_id, data.body)
    backlinks = await service.get_backlinks(doc_id)
    return KnowledgeDocDetailResponse(
        id=doc.id,
        source_id=doc.source_id,
        title=doc.title,
        relative_path=doc.relative_path,
        tags=doc.tags,
        content_hash=doc.content_hash,
        wikilinks=doc.wikilinks,
        frontmatter=doc.frontmatter,
        created_at=doc.created_at,
        updated_at=doc.updated_at,
        body=doc.body,
        backlinks=backlinks,
        source=doc.source,
    )


# ---------------------------------------------------------------------------
# Document create
# ---------------------------------------------------------------------------


@router.post(
    "/documents",
    response_model=KnowledgeDocDetailResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_document(
    data: KnowledgeDocCreate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new markdown document on disk and in the DB.

    Creates the file with minimal frontmatter, parses it, and inserts
    a DB row (FTS5 AFTER INSERT trigger fires). Returns 403 for
    read-only sources, 409 for duplicate paths.
    """
    service = KBService(db)
    doc = await service.create_doc(
        data.source_id, data.folder, data.filename
    )
    backlinks = await service.get_backlinks(doc.id)
    return KnowledgeDocDetailResponse(
        id=doc.id,
        source_id=doc.source_id,
        title=doc.title,
        relative_path=doc.relative_path,
        tags=doc.tags,
        content_hash=doc.content_hash,
        wikilinks=doc.wikilinks,
        frontmatter=doc.frontmatter,
        created_at=doc.created_at,
        updated_at=doc.updated_at,
        body=doc.body,
        backlinks=backlinks,
        source=doc.source,
    )


# ---------------------------------------------------------------------------
# Document rename
# ---------------------------------------------------------------------------


@router.post(
    "/documents/{doc_id}/rename",
    response_model=RenameDocResponse,
)
async def rename_document(
    doc_id: str,
    data: RenameDocRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Rename a document on disk, update DB, and cascade wikilinks.

    Returns the updated document with refs_updated count.
    Returns 403 for read-only sources, 409 for name collisions.
    """
    service = KBService(db)
    doc, refs_updated = await service.rename_doc(doc_id, data.new_title)
    backlinks = await service.get_backlinks(doc_id)
    return RenameDocResponse(
        id=doc.id,
        source_id=doc.source_id,
        title=doc.title,
        relative_path=doc.relative_path,
        tags=doc.tags,
        content_hash=doc.content_hash,
        wikilinks=doc.wikilinks,
        frontmatter=doc.frontmatter,
        created_at=doc.created_at,
        updated_at=doc.updated_at,
        body=doc.body,
        backlinks=backlinks,
        source=doc.source,
        refs_updated=refs_updated,
    )


# ---------------------------------------------------------------------------
# Document delete
# ---------------------------------------------------------------------------


@router.delete(
    "/documents/{doc_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_document(
    doc_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a document from disk and remove the DB row.

    The FTS5 index is automatically cleaned up via the AFTER DELETE
    trigger. Returns 403 for read-only sources, 404 if not found.
    Orphaned wikilinks in other documents are intentionally preserved.
    """
    service = KBService(db)
    await service.delete_doc(doc_id)


# ---------------------------------------------------------------------------
# Bookmarks
# ---------------------------------------------------------------------------


@router.get("/bookmarks", response_model=list[BookmarkResponse])
async def list_bookmarks(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all bookmarks for the current user."""
    service = KBService(db)
    return await service.list_bookmarks(current_user.id)


@router.post(
    "/bookmarks",
    response_model=BookmarkResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_bookmark(
    data: BookmarkCreate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Bookmark a document."""
    service = KBService(db)
    return await service.add_bookmark(current_user.id, data.doc_id)


@router.delete(
    "/bookmarks/{doc_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_bookmark(
    doc_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove a bookmark."""
    service = KBService(db)
    await service.remove_bookmark(current_user.id, doc_id)


# ---------------------------------------------------------------------------
# Attachments
# ---------------------------------------------------------------------------


@router.get("/documents/{doc_id}/attachments/{filename:path}")
async def get_attachment(
    doc_id: str,
    filename: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Serve a vault attachment file with extension validation."""
    service = KBService(db)
    doc = await service.get_doc(doc_id)
    source = doc.source

    # Validate extension
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise AppException(
            ErrorCode.KB_VAULT_PATH_FORBIDDEN,
            f"File type '{ext}' is not allowed",
        )

    # Build and validate full path
    full_path = str(
        Path(source.path) / Path(doc.relative_path).parent / filename
    )
    validated = validate_vault_path(full_path, source.path)

    if not validated.is_file():
        raise AppException(
            ErrorCode.KB_ATTACHMENT_NOT_FOUND,
            "Attachment file not found",
        )

    content_type, _ = mimetypes.guess_type(str(validated))
    return FileResponse(
        path=str(validated),
        filename=validated.name,
        media_type=content_type or "application/octet-stream",
    )


# ---------------------------------------------------------------------------
# Background indexing
# ---------------------------------------------------------------------------


@router.post(
    "/sources/{source_id}/index",
    status_code=status.HTTP_202_ACCEPTED,
)
async def trigger_index(
    source_id: str,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Trigger vault indexing as a background task."""
    service = KBService(db)
    source = await service.get_source(source_id)

    task_id = str(uuid.uuid4())
    _index_tasks[task_id] = {
        "task_id": task_id,
        "status": "pending",
        "source_id": source_id,
        "started_at": None,
        "stats": None,
        "error": None,
    }

    background_tasks.add_task(
        _run_index_task, task_id, source_id, source.path
    )
    return {"task_id": task_id, "status": "pending"}


@router.get("/index-tasks/{task_id}")
async def get_index_status(
    task_id: str,
    current_user=Depends(get_current_user),
):
    """Poll indexing task status."""
    task = _index_tasks.get(task_id)
    if not task:
        raise AppException(
            ErrorCode.KB_INDEX_FAILED,
            f"Index task '{task_id}' not found",
            {"task_id": task_id},
        )
    return task


# ---------------------------------------------------------------------------
# Background sync state
# ---------------------------------------------------------------------------

_sync_tasks: dict[str, dict] = {}


async def _run_sync_task(task_id: str, source_id: str) -> None:
    """Background sync task -- creates its own DB session."""
    _sync_tasks[task_id]["status"] = "running"
    _sync_tasks[task_id]["started_at"] = time.time()
    try:
        async with async_session_maker() as db:
            sync_svc = SyncService(db)
            stats = await sync_svc.sync_source(source_id)
            _sync_tasks[task_id]["status"] = "completed"
            _sync_tasks[task_id]["stats"] = stats
    except Exception as e:
        _sync_tasks[task_id]["status"] = "failed"
        _sync_tasks[task_id]["error"] = str(e)


# ---------------------------------------------------------------------------
# Sync endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/sources/{source_id}/sync",
    status_code=status.HTTP_202_ACCEPTED,
)
async def trigger_sync(
    source_id: str,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Trigger vault sync (git pull + re-index) as a background task."""
    service = KBService(db)
    await service.get_source(source_id)

    task_id = str(uuid.uuid4())
    _sync_tasks[task_id] = {
        "task_id": task_id,
        "status": "pending",
        "source_id": source_id,
        "started_at": None,
        "stats": None,
        "error": None,
    }

    background_tasks.add_task(_run_sync_task, task_id, source_id)
    return {"task_id": task_id, "status": "pending"}


@router.get("/sync-tasks/{task_id}")
async def get_sync_status(
    task_id: str,
    current_user=Depends(get_current_user),
):
    """Poll sync task status."""
    task = _sync_tasks.get(task_id)
    if not task:
        raise AppException(
            ErrorCode.KB_SYNC_FAILED,
            f"Sync task '{task_id}' not found",
            {"task_id": task_id},
        )
    return task


# ---------------------------------------------------------------------------
# MITRE tag migration
# ---------------------------------------------------------------------------


@router.post("/migrate-mitre-tags")
async def migrate_mitre_tags(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """One-time migration: move mitre: tags from DB to frontmatter YAML."""
    service = KBService(db)
    stats = await service.migrate_mitre_tags()
    return stats


# ---------------------------------------------------------------------------
# Community catalog
# ---------------------------------------------------------------------------


def _load_catalog() -> list[dict]:
    """Load community catalog from backend/data/community_catalog.json."""
    # __file__ is app/routers/kb.py, go up 3 levels to backend/
    catalog_path = (
        Path(__file__).resolve().parent.parent.parent
        / "data"
        / "community_catalog.json"
    )
    if not catalog_path.exists():
        return []
    return json.loads(catalog_path.read_text())


@router.get(
    "/community-catalog",
    response_model=list[CatalogEntry],
)
async def get_community_catalog(
    current_user=Depends(get_current_user),
):
    """List available community knowledge sources."""
    return _load_catalog()


# ---------------------------------------------------------------------------
# Source CRUD (community POST must precede {source_id} GET)
# ---------------------------------------------------------------------------


@router.post(
    "/sources/community",
    response_model=KnowledgeSourceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_community_source(
    data: AddCommunitySourceRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add a community source from the catalog.

    Clones the repo and starts background indexing.
    """
    # Find catalog entry
    catalog = _load_catalog()
    entry = next((e for e in catalog if e["slug"] == data.slug), None)
    if not entry:
        raise AppException(
            ErrorCode.KB_SOURCE_NOT_FOUND,
            f"Community source '{data.slug}' not found in catalog",
        )

    # Determine clone destination (backend/data/)
    data_dir = (
        Path(__file__).resolve().parent.parent.parent / "data"
    )
    clone_dir = data_dir / "community" / data.slug
    clone_dir.parent.mkdir(parents=True, exist_ok=True)

    # Clone if needed
    sync_svc = SyncService(db)
    await sync_svc.clone_source(
        url=entry["url"],
        dest=str(clone_dir),
        depth=entry.get("clone_depth", 1),
    )

    # Resolve include_paths
    include = data.include_paths or entry.get("recommended_filters")

    # Create source record
    source = KnowledgeSource(
        name=entry["name"],
        source_type="community",
        origin="git",
        path=str(clone_dir),
        remote_url=entry["url"],
        read_only=True,
        include_paths=include,
        user_id=current_user.id,
        project_id=data.project_id,
    )
    db.add(source)
    await db.commit()
    await db.refresh(source)

    return source


@router.post(
    "/sources/community/custom",
    response_model=KnowledgeSourceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_custom_git_source(
    data: AddCustomGitSourceRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add a community source from an arbitrary git URL.

    Clones the repo and starts background indexing.
    """
    import re

    # Derive a slug from the URL for the clone directory
    slug = re.sub(r"[^\w\-]", "-", data.url.rstrip("/").split("/")[-1].removesuffix(".git")).lower().strip("-")
    if not slug:
        slug = re.sub(r"[^\w\-]", "-", data.name).lower().strip("-")

    # Determine clone destination
    data_dir = Path(__file__).resolve().parent.parent.parent / "data"
    clone_dir = data_dir / "community" / slug
    clone_dir.parent.mkdir(parents=True, exist_ok=True)

    # Clone
    sync_svc = SyncService(db)
    await sync_svc.clone_source(url=data.url, dest=str(clone_dir), depth=1)

    # Create source record
    source = KnowledgeSource(
        name=data.name,
        source_type="community",
        origin="git",
        path=str(clone_dir),
        remote_url=data.url,
        read_only=True,
        include_paths=data.include_paths,
        user_id=current_user.id,
        project_id=data.project_id,
    )
    db.add(source)
    await db.commit()
    await db.refresh(source)

    return source


@router.get(
    "/sources",
    response_model=list[KnowledgeSourceResponse],
)
async def list_sources(
    project_id: str | None = None,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List knowledge sources, optionally filtered by project."""
    query = select(KnowledgeSource)
    if project_id:
        query = query.where(KnowledgeSource.project_id == project_id)
    result = await db.execute(query)
    return list(result.scalars().all())


@router.get(
    "/sources/{source_id}",
    response_model=KnowledgeSourceResponse,
)
async def get_source(
    source_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a knowledge source by ID."""
    service = KBService(db)
    return await service.get_source(source_id)


@router.patch(
    "/sources/{source_id}",
    response_model=KnowledgeSourceResponse,
)
async def update_source(
    source_id: str,
    data: KnowledgeSourceUpdate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a knowledge source with partial data."""
    service = KBService(db)
    source = await service.get_source(source_id)
    update_fields = data.model_dump(exclude_unset=True)
    for key, value in update_fields.items():
        setattr(source, key, value)
    await db.commit()
    await db.refresh(source)
    return source


@router.delete(
    "/sources/{source_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_source(
    source_id: str,
    delete_files: bool = Query(default=False),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a knowledge source and all its indexed documents.

    When delete_files=True, also removes local files from disk.
    Only community sources have their files deleted; local vault
    files are preserved since they are user-managed.
    """
    service = KBService(db)
    source = await service.get_source(source_id)

    # Optionally remove files from disk
    if delete_files and source.path:
        if source.source_type == "community":
            source_path = Path(source.path)
            if source_path.exists():
                shutil.rmtree(source.path, ignore_errors=True)
                logger.info("Deleted community source files: %s", source.path)
        else:
            logger.debug(
                "Preserving local vault files for source %s at %s",
                source_id,
                source.path,
            )

    # Delete all docs belonging to this source first
    await db.execute(
        sa_delete(KnowledgeDoc).where(
            KnowledgeDoc.source_id == source.id
        )
    )
    await db.delete(source)
    await db.commit()


@router.post(
    "/sources/{source_id}/folders",
    response_model=CreateFolderResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_folder(
    source_id: str,
    data: CreateFolderRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create an empty folder on disk within a source.

    Returns 403 for read-only sources. Validates the folder path
    against directory traversal attacks via validate_vault_path.
    """
    service = KBService(db)
    source = await service.get_source(source_id)

    if source.read_only:
        raise AppException(
            ErrorCode.KB_DOC_READ_ONLY, "Source is read-only"
        )

    folder_clean = data.folder_path.strip().strip("/")
    if not folder_clean:
        raise AppException(
            ErrorCode.KB_VAULT_PATH_FORBIDDEN,
            "Folder path cannot be empty",
        )

    full_path = Path(source.path) / folder_clean
    validated = validate_vault_path(str(full_path), source.path)
    validated.mkdir(parents=True, exist_ok=True)
    return CreateFolderResponse(
        folder_path=folder_clean, created=True
    )


@router.post(
    "/sources",
    response_model=KnowledgeSourceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_source(
    data: KnowledgeSourceCreate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new knowledge source with auto-detection.

    If path looks like a git URL, sets origin='git'.
    Otherwise sets origin='filesystem'. Defaults to
    remote_url=null (local-only) for OPSEC safety.
    """
    # Auto-detect origin if not explicitly set
    origin = data.origin
    if not origin and data.path:
        git_prefixes = (
            "http://", "https://", "git://",
            "file://", "ssh://", "git@",
        )
        origin = (
            "git"
            if any(data.path.startswith(p) for p in git_prefixes)
            else "filesystem"
        )

    source = KnowledgeSource(
        name=data.name,
        source_type=data.source_type,
        origin=origin,
        path=data.path,
        remote_url=data.remote_url,
        read_only=data.read_only,
        include_paths=data.include_paths,
        user_id=current_user.id,
        project_id=data.project_id,
    )
    db.add(source)
    await db.commit()
    await db.refresh(source)

    return source
