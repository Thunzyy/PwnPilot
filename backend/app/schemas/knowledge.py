"""Pydantic schemas for Knowledge Base API.

These schemas handle validation and serialization for KB endpoints:
sources, documents, search, tree navigation, and index tasks.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

# =============================================================================
# KnowledgeSource schemas
# =============================================================================

SourceType = Literal["local", "community"]


class KnowledgeSourceBase(BaseModel):
    """Base schema with common knowledge source fields."""

    name: str = Field(..., min_length=1, max_length=200)
    source_type: SourceType = Field(default="local")
    origin: str | None = None
    path: str | None = None
    remote_url: str | None = None
    read_only: bool = False
    include_paths: list[str] | None = None


class KnowledgeSourceCreate(KnowledgeSourceBase):
    """Schema for creating a new knowledge source."""

    project_id: str


class KnowledgeSourceUpdate(BaseModel):
    """Schema for updating an existing knowledge source. All fields optional."""

    name: str | None = None
    path: str | None = None
    remote_url: str | None = None
    read_only: bool | None = None
    include_paths: list[str] | None = None
    opsec_acknowledged: bool | None = None


class KnowledgeSourceResponse(KnowledgeSourceBase):
    """Schema for knowledge source API responses."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    project_id: str
    sync_status: str | None = None
    opsec_warning: str | None = None
    opsec_acknowledged: bool = False
    last_synced_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="after")
    def compute_opsec_warning(self) -> KnowledgeSourceResponse:
        """Set opsec warning when a remote URL is configured."""
        if self.remote_url is not None:
            self.opsec_warning = (
                "WARNING: This source has a remote git URL configured. "
                "Pushing to a remote may expose sensitive pentest data. "
                "Ensure the remote is private and intended for this purpose."
            )
        return self


# =============================================================================
# KnowledgeDoc schemas
# =============================================================================


class KnowledgeDocResponse(BaseModel):
    """Schema for knowledge doc list responses.

    Excludes body for performance in list endpoints.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str
    source_id: str
    title: str
    relative_path: str
    tags: str | None = None
    content_hash: str | None = None
    wikilinks: list[dict] | None = None
    frontmatter: dict | None = None
    created_at: datetime
    updated_at: datetime


class BacklinkItem(BaseModel):
    """A document that links to the current document."""

    id: str
    title: str
    relative_path: str
    context_line: str | None = None


class KnowledgeDocDetailResponse(KnowledgeDocResponse):
    """Schema for single-doc detail response with body and backlinks."""

    body: str | None = None
    backlinks: list[BacklinkItem] = Field(default_factory=list)
    source: KnowledgeSourceResponse | None = None


class KnowledgeDocUpdate(BaseModel):
    """Schema for updating a document's raw markdown content.

    The body field contains the full raw markdown (frontmatter + body).
    The backend writes this to disk as-is, then re-parses to extract
    metadata, tags, wikilinks, and content_hash.
    """

    body: str = Field(..., min_length=0, description="Full raw markdown content")


class KnowledgeDocCreate(BaseModel):
    """Schema for creating a new markdown document.

    source_id identifies the writable source.
    folder is the optional subdirectory path (e.g., 'recon/tools').
    filename is the bare filename (e.g., 'my-note.md').
    """

    source_id: str
    folder: str = Field(default="", description="Subdirectory path (optional)")
    filename: str = Field(
        ..., min_length=1, max_length=255, description="Filename"
    )


class RenameDocRequest(BaseModel):
    """Schema for renaming a document. Accepts the new title (stem)."""

    new_title: str = Field(..., min_length=1, max_length=255)


class RenameDocResponse(KnowledgeDocDetailResponse):
    """Rename response includes refs_updated count for wikilink cascade."""

    refs_updated: int = Field(
        default=0,
        description="Number of wikilink references updated across the vault",
    )


# =============================================================================
# Search schemas
# =============================================================================


class SearchResultItem(BaseModel):
    """A single search result with snippet and BM25 rank."""

    id: str
    title: str
    relative_path: str
    source_id: str
    tags: str | None = None
    snippet: str
    rank: float
    created_at: str | None = None
    updated_at: str | None = None


class SearchResponse(BaseModel):
    """Search endpoint response with query echo and total count."""

    items: list[SearchResultItem]
    query: str
    total: int


# =============================================================================
# Tree schemas
# =============================================================================


class TreeDocItem(BaseModel):
    """A document leaf node in the tree."""

    id: str
    title: str
    relative_path: str
    tags: str | None = None
    updated_at: str | None = None


class TagInfo(BaseModel):
    """A tag with its document count for autocomplete."""

    tag: str
    count: int


class RenameTagRequest(BaseModel):
    """Request to rename a tag across all documents."""

    old_tag: str = Field(..., min_length=1, max_length=100)
    new_tag: str = Field(..., min_length=1, max_length=100)


class DeleteTagRequest(BaseModel):
    """Request to delete a tag from all documents."""

    tag: str = Field(..., min_length=1, max_length=100)


class TagOperationResponse(BaseModel):
    """Response for bulk tag operations (rename/delete)."""

    docs_updated: int
    read_only_skipped: int = 0


class BulkTagEditRequest(BaseModel):
    """Request to add/remove tags on a set of documents."""

    doc_ids: list[str] = Field(..., min_length=1, max_length=200)
    add_tags: list[str] = Field(default_factory=list)
    remove_tags: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def check_not_empty(self) -> BulkTagEditRequest:
        if not self.add_tags and not self.remove_tags:
            raise ValueError("At least one of add_tags or remove_tags must be non-empty")
        return self


class BulkTagEditResponse(BaseModel):
    """Response for bulk tag edit operations."""

    docs_updated: int
    read_only_skipped: int = 0


class TreeNode(BaseModel):
    """A folder or file node in the vault tree structure."""

    name: str
    type: Literal["folder", "file"]
    children: list[TreeNode] = Field(default_factory=list)
    docs: list[TreeDocItem] = Field(default_factory=list)


class CreateFolderRequest(BaseModel):
    """Request body for creating a folder in a source."""

    folder_path: str = Field(..., min_length=1, max_length=500)


class CreateFolderResponse(BaseModel):
    """Response for folder creation."""

    folder_path: str
    created: bool


# =============================================================================
# Index task schemas
# =============================================================================


class IndexErrorItem(BaseModel):
    """An error encountered during indexing of a single file."""

    path: str
    reason: str


class IndexStats(BaseModel):
    """Statistics from a completed index operation."""

    added: int
    updated: int
    deleted: int
    errors: list[IndexErrorItem]
    duration_ms: int


class IndexTaskResponse(BaseModel):
    """Schema for index task status polling responses."""

    task_id: str
    status: Literal["pending", "running", "completed", "failed"]
    source_id: str
    started_at: float | None = None
    stats: IndexStats | None = None
    error: str | None = None


# =============================================================================
# Document list schema (cursor-paginated)
# =============================================================================


class KnowledgeDocListResponse(BaseModel):
    """Cursor-paginated list of knowledge documents."""

    items: list[KnowledgeDocResponse]
    next_cursor: str | None = None
    has_more: bool = False


# =============================================================================
# Sync schemas
# =============================================================================

SyncStatus = Literal["pending", "running", "completed", "failed"]


class SyncTaskResponse(BaseModel):
    """Schema for sync task status polling responses."""

    task_id: str
    status: SyncStatus
    source_id: str
    started_at: float | None = None
    stats: IndexStats | None = None
    error: str | None = None


# =============================================================================
# Community catalog schemas
# =============================================================================


class CatalogEntry(BaseModel):
    """A pre-configured community repository from the catalog."""

    slug: str
    name: str
    url: str
    description: str
    recommended_filters: list[str] = Field(default_factory=list)
    read_only: bool = True
    clone_depth: int = 1


class AddCommunitySourceRequest(BaseModel):
    """Request to add a community source from the catalog."""

    project_id: str
    slug: str
    include_paths: list[str] | None = None


class AddCustomGitSourceRequest(BaseModel):
    """Request to add a community source from an arbitrary git URL."""

    project_id: str
    name: str = Field(..., min_length=1, max_length=200)
    url: str = Field(..., min_length=1)
    include_paths: list[str] | None = None


# =============================================================================
# Bookmark schemas
# =============================================================================


class BookmarkCreate(BaseModel):
    """Request to bookmark a document."""

    doc_id: str


class BookmarkResponse(BaseModel):
    """Bookmark entry with document details."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    doc_id: str
    title: str
    relative_path: str
    source_id: str
    created_at: datetime
