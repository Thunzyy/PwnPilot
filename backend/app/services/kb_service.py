"""Knowledge Base service — business logic for vault indexing, search,
document retrieval, backlinks, pagination, and tree navigation.

All KB REST endpoints delegate to this service.  Composes Phase 1
primitives (MarkdownParser, FTS5 triggers, validate_vault_path) into
a cohesive service layer.
"""

from __future__ import annotations

import base64
import datetime
import os
import re
import time
from pathlib import Path

import frontmatter
from sqlalchemy import delete as sa_delete
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import ErrorCode
from app.core.exceptions import AppException
from app.core.file_lock import vault_file_lock
from app.core.security import sanitize_filename, validate_vault_path
from app.models.knowledge import KnowledgeDoc, KnowledgeSource
from app.services.base import BaseService
from app.services.markdown_parser import MarkdownParser
from app.services.query_parser import parse_search_query

# ---------------------------------------------------------------------------
# Cursor helpers (inline — pagination.py may not exist yet)
# ---------------------------------------------------------------------------


def _encode_cursor(dt: datetime.datetime, doc_id: str) -> str:
    """Encode a (datetime, id) pair into a URL-safe cursor string."""
    raw = f"{dt.isoformat()}|{doc_id}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime.datetime, str]:
    """Decode a cursor string back to (datetime, id)."""
    decoded = base64.urlsafe_b64decode(cursor).decode()
    ts_str, doc_id = decoded.rsplit("|", 1)
    return datetime.datetime.fromisoformat(ts_str), doc_id


# ---------------------------------------------------------------------------
# KBService
# ---------------------------------------------------------------------------


class KBService(BaseService):
    """Core KB business logic service.

    Methods
    -------
    index_vault   -- scan vault .md files, hash-compare, upsert/delete
    search_docs   -- FTS5 full-text search with BM25 ranking + snippets
    get_doc       -- single-doc retrieval with eager-loaded source
    save_doc      -- write content to disk, refresh DB row
    create_doc    -- create new markdown file on disk and in DB
    rename_doc    -- rename file on disk, update DB, cascade wikilinks
    delete_doc    -- remove file from disk, delete DB row
    get_backlinks -- find docs that wikilink to a target document
    list_docs     -- cursor-based paginated listing
    get_tree      -- nested folder tree from flat document paths
    get_source    -- simple source lookup by ID
    """

    def __init__(self, db: AsyncSession):
        super().__init__("service.kb")
        self.db = db

    # ------------------------------------------------------------------
    # index_vault
    # ------------------------------------------------------------------

    async def index_vault(
        self,
        source_id: str,
        vault_path: str,
        include_paths: list[str] | None = None,
    ) -> dict:
        """Scan *vault_path* for ``.md`` files, hash-compare against DB,
        and upsert / delete as needed.

        When *include_paths* is provided, only ``.md`` files under those
        subdirectories are indexed (subdirectory-scoped filtering for
        large community repos).  Otherwise the full vault is scanned.

        Returns ``{added, updated, deleted, errors, duration_ms}``.
        """
        start = time.time()

        vault = Path(vault_path)
        if not vault.exists():
            raise AppException(
                ErrorCode.KB_INDEX_FAILED,
                f"Vault path not found: {vault_path}",
            )

        stats: dict = {
            "added": 0,
            "updated": 0,
            "deleted": 0,
            "errors": [],
        }
        parser = MarkdownParser()
        existing_paths: set[str] = set()

        # Load all existing docs for this source
        result = await self.db.execute(
            select(KnowledgeDoc).where(
                KnowledgeDoc.source_id == source_id
            )
        )
        existing_docs = {
            d.relative_path: d for d in result.scalars().all()
        }

        # Scan .md files on disk (with optional subdirectory filter)
        if include_paths:
            md_files: list[Path] = []
            for subdir in include_paths:
                subpath = vault / subdir
                if subpath.is_dir():
                    md_files.extend(sorted(subpath.rglob("*.md")))
                else:
                    self.log.warning(f"Include path not found: {subdir}")
            md_files = sorted(set(md_files))  # Deduplicate
        else:
            md_files = sorted(vault.rglob("*.md"))

        for md_file in md_files:
            try:
                parsed = parser.parse(md_file, vault)
                rel_path = parsed["relative_path"]
                existing_paths.add(rel_path)

                existing = existing_docs.get(rel_path)
                if existing and existing.content_hash == parsed["content_hash"]:
                    continue  # unchanged — skip

                frontmatter = self._sanitize_frontmatter(
                    parsed["frontmatter"]
                )
                tags_str = (
                    " ".join(parsed["tags"]) if parsed["tags"] else None
                )

                if existing:
                    # UPDATE in place (critical for FTS5 trigger)
                    existing.title = parsed["title"]
                    existing.body = parsed["body"]
                    existing.tags = tags_str
                    existing.content_hash = parsed["content_hash"]
                    existing.wikilinks = parsed["wikilinks"]
                    existing.frontmatter = frontmatter
                    stats["updated"] += 1
                else:
                    doc = KnowledgeDoc(
                        source_id=source_id,
                        title=parsed["title"],
                        relative_path=rel_path,
                        body=parsed["body"],
                        tags=tags_str,
                        content_hash=parsed["content_hash"],
                        wikilinks=parsed["wikilinks"],
                        frontmatter=frontmatter,
                    )
                    self.db.add(doc)
                    stats["added"] += 1

            except Exception as exc:
                stats["errors"].append(
                    {"path": str(md_file), "reason": str(exc)}
                )
                self.log.error(f"Error indexing {md_file}: {exc}")

        # Delete orphaned docs (present in DB but not on disk)
        for rel_path, doc in existing_docs.items():
            if rel_path not in existing_paths:
                await self.db.delete(doc)
                stats["deleted"] += 1

        await self.db.commit()

        # Update source.last_synced_at
        source = await self.db.get(KnowledgeSource, source_id)
        if source:
            source.last_synced_at = datetime.datetime.now(datetime.UTC)
            await self.db.commit()

        duration_ms = int((time.time() - start) * 1000)
        stats["duration_ms"] = duration_ms

        self.log.info(
            f"Index complete: +{stats['added']} ~{stats['updated']} "
            f"-{stats['deleted']} ({duration_ms}ms, "
            f"{len(stats['errors'])} errors)"
        )
        return stats

    # ------------------------------------------------------------------
    # search_docs
    # ------------------------------------------------------------------

    async def search_docs(
        self,
        query: str,
        source_id: str | None = None,
        limit: int = 20,
        sort_by: str = "relevance",
        sort_dir: str = "desc",
    ) -> dict:
        """Full-text search using FTS5 with BM25 ranking and snippets.

        Supports filter prefixes (path:, file:, tag:, line:, section:,
        [property:value]) extracted before FTS5 MATCH.  Filter-only
        queries (no free text) bypass FTS5 entirely.

        Returns ``{"items": [dict], "total": int}`` where total is the
        true count of all matching documents (independent of LIMIT).
        Each item includes created_at and updated_at timestamps.

        *sort_by* controls ordering: relevance (BM25), filename (path
        ascending), modified (updated_at descending), or created
        (created_at descending).
        """
        # --- 1. Parse filter prefixes BEFORE sanitizing -----------------
        parsed = parse_search_query(query)

        if not parsed.has_free_text and not parsed.has_filters:
            return {"items": [], "total": 0}

        # --- 2. Build WHERE clauses + params ----------------------------
        params: dict = {"limit": limit}
        where_clauses: list[str] = []

        # source_id (existing parameter)
        if source_id:
            where_clauses.append("kd.source_id = :source_id")
            params["source_id"] = source_id

        # path: filter (FILT-01) — case-insensitive LIKE
        for i, pf in enumerate(parsed.path_filters):
            key = f"path_{i}"
            where_clauses.append(
                f"LOWER(kd.relative_path) LIKE :{key}"
            )
            params[key] = f"%{pf.lower()}%"

        # file: filter (FILT-02) — match filename portion
        for i, ff in enumerate(parsed.file_filters):
            key_a = f"file_a_{i}"
            key_b = f"file_b_{i}"
            where_clauses.append(
                f"(LOWER(kd.relative_path) LIKE :{key_a} "
                f"OR LOWER(kd.relative_path) LIKE :{key_b})"
            )
            params[key_a] = f"%/{ff.lower()}%"
            params[key_b] = f"{ff.lower()}%"

        # tag: filter (FILT-03) — reuse 4-clause LIKE pattern
        for i, tf in enumerate(parsed.tag_filters):
            where_clauses.append(
                f"(LOWER(kd.tags) = :te_{i} "
                f"OR LOWER(kd.tags) LIKE :ts_{i} "
                f"OR LOWER(kd.tags) LIKE :tm_{i} "
                f"OR LOWER(kd.tags) LIKE :td_{i})"
            )
            params[f"te_{i}"] = tf.lower()
            params[f"ts_{i}"] = f"{tf.lower()} %"
            params[f"tm_{i}"] = f"% {tf.lower()} %"
            params[f"td_{i}"] = f"% {tf.lower()}"

        # [property:value] filter (FILT-06) — json_extract
        for i, (prop, val) in enumerate(parsed.frontmatter_filters):
            where_clauses.append(
                f"json_extract(kd.frontmatter, :fp_{i}) = :fv_{i}"
            )
            params[f"fp_{i}"] = f"$.{prop}"
            params[f"fv_{i}"] = val

        # --- 3. Build SQL query -----------------------------------------
        where_sql = " AND ".join(where_clauses) if where_clauses else ""

        if parsed.has_free_text:
            # Path A: FTS5 MATCH + WHERE filters
            sanitized = self._sanitize_fts_query(parsed.free_text)
            if not sanitized and not parsed.has_filters:
                return {"items": [], "total": 0}

            if sanitized:
                params["query"] = sanitized
                fts_where = "knowledge_docs_fts MATCH :query"
                all_where = (
                    f"{fts_where} AND {where_sql}"
                    if where_sql
                    else fts_where
                )

                # Sort logic (same as before)
                sort_columns = {
                    "relevance": "rank",
                    "filename": "kd.relative_path",
                    "modified": "kd.updated_at",
                    "created": "kd.created_at",
                }
                col = sort_columns.get(sort_by, "rank")
                if sort_by == "relevance":
                    sql_dir = (
                        "ASC" if sort_dir == "desc" else "DESC"
                    )
                else:
                    sql_dir = (
                        sort_dir.upper()
                        if sort_dir in ("asc", "desc")
                        else "DESC"
                    )
                order_by_sql = f"{col} {sql_dir}"

                sql = (
                    "SELECT "
                    "  kd.id, kd.title, kd.relative_path, "
                    "  kd.source_id, kd.tags, "
                    "  kd.created_at, kd.updated_at, kd.body, "
                    "  snippet(knowledge_docs_fts, 1, "
                    "    '<mark>', '</mark>', '...', 32) AS snippet, "
                    "  bm25(knowledge_docs_fts, 10.0, 1.0, 5.0) "
                    "    AS rank "
                    "FROM knowledge_docs_fts "
                    "JOIN knowledge_docs kd "
                    "  ON kd.rowid = knowledge_docs_fts.rowid "
                    f"WHERE {all_where} "
                    f"ORDER BY {order_by_sql} "
                )
            else:
                # Sanitized text was empty but filters exist — use
                # filter-only path below.
                sql = self._build_filter_only_sql(where_sql)
        else:
            # Path B: filter-only, no FTS5
            sql = self._build_filter_only_sql(where_sql)

        # --- 4. Execute --------------------------------------------------
        exec_params = {
            k: v for k, v in params.items() if k != "limit"
        }
        result = await self.db.execute(text(sql), exec_params)
        rows = result.fetchall()

        items = [dict(row._mapping) for row in rows]

        # --- 5. Post-filter: line: and section: (FILT-04, FILT-05) ------
        for keyword in parsed.line_filters:
            items = [
                it
                for it in items
                if self._matches_line_filter(
                    it.get("body") or "", keyword
                )
            ]

        for keyword in parsed.section_filters:
            items = [
                it
                for it in items
                if self._matches_section_filter(
                    it.get("body") or "", keyword
                )
            ]

        # --- 6. Deduplicate by relative_path ----------------------------
        seen_paths: set[str] = set()
        unique_items: list[dict] = []
        for item in items:
            path = item["relative_path"]
            if path not in seen_paths:
                seen_paths.add(path)
                # Remove internal body key before returning
                item.pop("body", None)
                unique_items.append(item)

        total = len(unique_items)
        return {
            "items": unique_items[:limit],
            "total": total,
        }

    @staticmethod
    def _build_filter_only_sql(where_sql: str) -> str:
        """Build a SELECT for filter-only queries (no FTS5 MATCH).

        When *where_sql* is empty (only post-filters like line:/section:
        exist), the WHERE clause is omitted entirely so all docs are
        returned for Python-side post-filtering.
        """
        where_part = f"WHERE {where_sql} " if where_sql else ""
        return (
            "SELECT "
            "  kd.id, kd.title, kd.relative_path, "
            "  kd.source_id, kd.tags, "
            "  kd.created_at, kd.updated_at, kd.body, "
            "  SUBSTR(kd.body, 1, 200) AS snippet, "
            "  0 AS rank "
            "FROM knowledge_docs kd "
            f"{where_part}"
            "ORDER BY kd.updated_at DESC "
        )

    # ------------------------------------------------------------------
    # get_doc
    # ------------------------------------------------------------------

    async def get_doc(self, doc_id: str) -> KnowledgeDoc:
        """Return a single ``KnowledgeDoc`` with its source eagerly loaded.

        Raises ``AppException(KB_DOC_NOT_FOUND)`` when not found.
        """
        result = await self.db.execute(
            select(KnowledgeDoc)
            .where(KnowledgeDoc.id == doc_id)
            .options(selectinload(KnowledgeDoc.source))
        )
        doc = result.scalar_one_or_none()
        if not doc:
            raise AppException(
                ErrorCode.KB_DOC_NOT_FOUND,
                f"Document '{doc_id}' not found",
                {"doc_id": doc_id},
            )
        return doc

    # ------------------------------------------------------------------
    # save_doc
    # ------------------------------------------------------------------

    async def save_doc(self, doc_id: str, raw_content: str) -> KnowledgeDoc:
        """Write updated content to disk and refresh the DB row.

        Guards:
        - source.read_only must be False (403 if True)
        - vault path validated against traversal (validate_vault_path)
        - file lock acquired during write (vault_file_lock)

        The FTS5 AFTER UPDATE trigger auto-syncs the search index
        when the KnowledgeDoc row is committed.
        """
        doc = await self.get_doc(doc_id)  # eager-loads source
        source = doc.source

        if source.read_only:
            raise AppException(
                ErrorCode.KB_DOC_READ_ONLY,
                "Cannot edit documents from a read-only source",
            )

        vault_path = Path(source.path)
        file_path = vault_path / doc.relative_path
        validated = validate_vault_path(str(file_path), source.path)

        parser = MarkdownParser()

        async with vault_file_lock(source.path):
            validated.write_text(raw_content, encoding="utf-8")
            parsed = parser.parse(validated, vault_path)

        # Update DB row fields (triggers FTS5 auto-update on commit)
        doc.title = parsed["title"]
        doc.body = parsed["body"]
        doc.tags = (
            " ".join(parsed["tags"]) if parsed["tags"] else None
        )
        doc.content_hash = parsed["content_hash"]
        doc.wikilinks = parsed["wikilinks"]
        doc.frontmatter = self._sanitize_frontmatter(
            parsed["frontmatter"]
        )

        await self.db.commit()
        await self.db.refresh(doc)
        return doc

    # ------------------------------------------------------------------
    # create_doc
    # ------------------------------------------------------------------

    async def create_doc(
        self, source_id: str, folder: str, filename: str
    ) -> KnowledgeDoc:
        """Create a new markdown file on disk and insert a DB row.

        Guards:
        - source.read_only must be False (403)
        - filename sanitized (no traversal chars)
        - full path validated within vault (validate_vault_path)
        - no duplicate (source_id, relative_path) in DB
        - no existing file at target path on disk

        The FTS5 AFTER INSERT trigger auto-syncs the search index.
        """
        source = await self.get_source(source_id)

        if source.read_only:
            raise AppException(
                ErrorCode.KB_DOC_READ_ONLY,
                "Cannot create documents in a read-only source",
            )

        # Sanitize filename and ensure .md extension
        clean_name = sanitize_filename(filename)
        if not clean_name.endswith(".md"):
            clean_name += ".md"

        # Build relative path
        folder_clean = folder.strip().strip("/")
        relative_path = (
            f"{folder_clean}/{clean_name}" if folder_clean else clean_name
        )

        # Validate full path within vault
        vault_path = Path(source.path)
        file_path = vault_path / relative_path
        validated = validate_vault_path(str(file_path), source.path)

        # Check DB for duplicate (source_id, relative_path)
        existing = await self.db.execute(
            select(KnowledgeDoc).where(
                KnowledgeDoc.source_id == source_id,
                KnowledgeDoc.relative_path == relative_path,
            )
        )
        if existing.scalar_one_or_none():
            raise AppException(
                ErrorCode.KB_DOC_DUPLICATE_PATH,
                f"A document already exists at '{relative_path}'",
                {"relative_path": relative_path},
            )

        # Check disk (defense-in-depth for out-of-sync scenarios)
        if validated.exists():
            raise AppException(
                ErrorCode.KB_DOC_DUPLICATE_PATH,
                f"A file already exists at '{relative_path}'",
                {"relative_path": relative_path},
            )

        # Create file on disk
        title = Path(clean_name).stem
        initial_content = f"---\ntitle: {title}\n---\n"
        parser = MarkdownParser()

        async with vault_file_lock(source.path):
            validated.parent.mkdir(parents=True, exist_ok=True)
            validated.write_text(initial_content, encoding="utf-8")
            parsed = parser.parse(validated, vault_path)

        # Insert DB row (triggers FTS5 AFTER INSERT)
        doc = KnowledgeDoc(
            source_id=source_id,
            title=parsed["title"],
            relative_path=relative_path,
            body=parsed["body"],
            tags=(
                " ".join(parsed["tags"]) if parsed["tags"] else None
            ),
            content_hash=parsed["content_hash"],
            wikilinks=parsed["wikilinks"],
            frontmatter=self._sanitize_frontmatter(
                parsed["frontmatter"]
            ),
        )
        self.db.add(doc)
        await self.db.commit()
        await self.db.refresh(doc)
        return doc

    # ------------------------------------------------------------------
    # rename_doc
    # ------------------------------------------------------------------

    async def rename_doc(
        self, doc_id: str, new_title: str
    ) -> tuple[KnowledgeDoc, int]:
        """Rename a document on disk, update DB, and cascade wikilinks.

        Guards:
        - source.read_only must be False (403)
        - new filename sanitized (no traversal chars)
        - destination validated within vault (validate_vault_path)
        - no collision with existing file (DB or disk) (409)
        - vault file lock acquired during rename

        Returns (updated_doc, refs_updated_count).
        """
        doc = await self.get_doc(doc_id)
        source = doc.source

        if source.read_only:
            raise AppException(
                ErrorCode.KB_DOC_READ_ONLY,
                "Cannot rename documents in a read-only source",
            )

        # Sanitize and build new filename
        clean_name = sanitize_filename(new_title)
        if not clean_name.endswith(".md"):
            clean_name += ".md"

        # Build new relative path (same parent folder)
        old_rel = doc.relative_path
        parent = str(Path(old_rel).parent)
        new_relative_path = (
            f"{parent}/{clean_name}" if parent != "." else clean_name
        )

        # Skip if nothing changed
        if new_relative_path == old_rel:
            return doc, 0

        # Validate destination within vault
        vault_path = Path(source.path)
        new_file_path = vault_path / new_relative_path
        validate_vault_path(str(new_file_path), source.path)

        # Collision check: DB
        existing = await self.db.execute(
            select(KnowledgeDoc).where(
                KnowledgeDoc.source_id == source.id,
                KnowledgeDoc.relative_path == new_relative_path,
            )
        )
        if existing.scalar_one_or_none():
            raise AppException(
                ErrorCode.KB_DOC_RENAME_COLLISION,
                f"A document already exists at '{new_relative_path}'",
                {"relative_path": new_relative_path},
            )

        # Collision check: disk
        if new_file_path.exists():
            raise AppException(
                ErrorCode.KB_DOC_RENAME_COLLISION,
                f"A file already exists at '{new_relative_path}'",
                {"relative_path": new_relative_path},
            )

        old_file_path = vault_path / old_rel
        parser = MarkdownParser()

        async with vault_file_lock(source.path):
            # Atomic rename on same filesystem
            os.rename(str(old_file_path), str(new_file_path))

            # Update frontmatter title in the renamed file
            raw_content = new_file_path.read_text(encoding="utf-8")
            post = frontmatter.loads(raw_content)
            new_stem = Path(clean_name).stem
            post.metadata["title"] = new_stem
            updated_content = frontmatter.dumps(post)
            new_file_path.write_text(updated_content, encoding="utf-8")

            # Re-parse the renamed file
            parsed = parser.parse(new_file_path, vault_path)

        # Update DB row (preserves UUID, triggers FTS5 UPDATE)
        doc.title = parsed["title"]
        doc.relative_path = new_relative_path
        doc.body = parsed["body"]
        doc.tags = (
            " ".join(parsed["tags"]) if parsed["tags"] else None
        )
        doc.content_hash = parsed["content_hash"]
        doc.wikilinks = parsed["wikilinks"]
        doc.frontmatter = self._sanitize_frontmatter(
            parsed["frontmatter"]
        )

        # Wikilink cascade
        refs_updated = await self._cascade_wikilinks(
            doc, old_rel, new_relative_path, vault_path, parser
        )

        await self.db.commit()
        await self.db.refresh(doc)
        return doc, refs_updated

    async def _cascade_wikilinks(
        self,
        renamed_doc: KnowledgeDoc,
        old_rel: str,
        new_rel: str,
        vault_path: Path,
        parser: MarkdownParser,
    ) -> int:
        """Update [[old_stem]] -> [[new_stem]] in same-source docs."""
        old_stem = Path(old_rel).stem
        new_stem = Path(new_rel).stem

        if old_stem.lower() == new_stem.lower():
            return 0

        # Find affected docs via json_each (case-insensitive)
        affected_result = await self.db.execute(
            text(
                "SELECT DISTINCT kd.id "
                "FROM knowledge_docs kd, json_each(kd.wikilinks) je "
                "WHERE kd.source_id = :source_id "
                "AND kd.id != :doc_id "
                "AND LOWER(json_extract(je.value, '$.target')) "
                "    = LOWER(:old_stem)"
            ),
            {
                "source_id": renamed_doc.source_id,
                "doc_id": renamed_doc.id,
                "old_stem": old_stem,
            },
        )
        affected_ids = [row[0] for row in affected_result.fetchall()]

        if not affected_ids:
            return 0

        # Build case-insensitive replacement pattern
        pattern = re.compile(
            r"\[\[" + re.escape(old_stem) + r"(\|[^\]]+)?\]\]",
            re.IGNORECASE,
        )

        refs_updated = 0
        for affected_id in affected_ids:
            affected_doc = await self.get_doc(affected_id)
            file_path = vault_path / affected_doc.relative_path

            content = file_path.read_text(encoding="utf-8")
            new_content = pattern.sub(
                lambda m: f"[[{new_stem}{m.group(1) or ''}]]",
                content,
            )

            if new_content != content:
                async with vault_file_lock(str(vault_path)):
                    file_path.write_text(new_content, encoding="utf-8")
                    parsed = parser.parse(file_path, vault_path)

                affected_doc.title = parsed["title"]
                affected_doc.body = parsed["body"]
                affected_doc.tags = (
                    " ".join(parsed["tags"])
                    if parsed["tags"]
                    else None
                )
                affected_doc.content_hash = parsed["content_hash"]
                affected_doc.wikilinks = parsed["wikilinks"]
                affected_doc.frontmatter = self._sanitize_frontmatter(
                    parsed["frontmatter"]
                )
                refs_updated += 1

        return refs_updated

    # ------------------------------------------------------------------
    # delete_doc
    # ------------------------------------------------------------------

    async def delete_doc(self, doc_id: str) -> None:
        """Delete a document from disk and remove the DB row.

        Guards:
        - source.read_only must be False (403)
        - vault path validated against traversal (validate_vault_path)
        - file lock acquired during unlink (vault_file_lock)

        The FTS5 AFTER DELETE trigger auto-cleans the search index
        when the KnowledgeDoc row is committed.

        Orphaned wikilinks in other documents are NOT updated
        (intentional -- matches Obsidian behavior for broken links).
        """
        doc = await self.get_doc(doc_id)  # eager-loads source
        source = doc.source

        if source.read_only:
            raise AppException(
                ErrorCode.KB_DOC_READ_ONLY,
                "Cannot delete documents from a read-only source",
            )

        vault_path = Path(source.path)
        file_path = vault_path / doc.relative_path
        validated = validate_vault_path(str(file_path), source.path)

        async with vault_file_lock(source.path):
            if validated.exists():
                validated.unlink()

        await self.db.delete(doc)
        await self.db.commit()

    # ------------------------------------------------------------------
    # get_backlinks
    # ------------------------------------------------------------------

    async def get_backlinks(self, doc_id: str) -> list[dict]:
        """Find documents whose wikilinks target *doc_id*'s file.

        Uses ``json_each()`` + ``json_extract()`` on the ``wikilinks``
        JSON column for query-time derivation.
        """
        doc = await self.get_doc(doc_id)
        stem = Path(doc.relative_path).stem

        result = await self.db.execute(
            text(
                "SELECT DISTINCT kd.id, kd.title, kd.relative_path, kd.body "
                "FROM knowledge_docs kd, json_each(kd.wikilinks) je "
                "WHERE kd.source_id = :source_id "
                "AND kd.id != :doc_id "
                "AND ("
                "  json_extract(je.value, '$.target') = :filename "
                "  OR json_extract(je.value, '$.target') = :stem"
                ") "
            ),
            {
                "source_id": doc.source_id,
                "doc_id": doc_id,
                "filename": doc.relative_path,
                "stem": stem,
            },
        )
        backlinks = []
        for row in result.fetchall():
            mapping = dict(row._mapping)
            body = mapping.pop("body", None) or ""
            mapping["context_line"] = self._extract_context_line(body, stem)
            backlinks.append(mapping)
        return backlinks

    @staticmethod
    def _extract_context_line(body: str, stem: str) -> str | None:
        """Extract the first line containing ``[[stem]]`` from body text."""
        if not body:
            return None
        pattern = re.compile(
            r".*\[\[" + re.escape(stem) + r"(?:\|[^\]]+)?\]\].*",
            re.IGNORECASE,
        )
        for line in body.splitlines():
            if pattern.match(line):
                return line.strip()
        return None

    # ------------------------------------------------------------------
    # list_docs
    # ------------------------------------------------------------------

    async def list_docs(
        self,
        source_id: str | None = None,
        cursor: str | None = None,
        limit: int = 50,
        tag: str | None = None,
    ) -> dict:
        """Return cursor-paginated knowledge docs.

        When *tag* is provided, only documents whose ``tags`` column
        contains the exact tag are returned.  Tags are stored as
        space-separated strings (e.g. ``"nmap recon privesc"``).

        Returns ``{items, next_cursor, has_more}``.
        """
        query = select(KnowledgeDoc).order_by(
            KnowledgeDoc.created_at.desc(),
            KnowledgeDoc.id.desc(),
        )

        if source_id:
            query = query.where(
                KnowledgeDoc.source_id == source_id
            )

        if tag:
            # Tags column stores space-separated tags.
            # Match tag at start, middle, end, or as the only value.
            query = query.where(
                text(
                    "(knowledge_docs.tags = :tag_exact "
                    "OR knowledge_docs.tags LIKE :tag_start "
                    "OR knowledge_docs.tags LIKE :tag_middle "
                    "OR knowledge_docs.tags LIKE :tag_end)"
                ).bindparams(
                    tag_exact=tag,
                    tag_start=f"{tag} %",
                    tag_middle=f"% {tag} %",
                    tag_end=f"% {tag}",
                )
            )

        if cursor:
            cursor_dt, cursor_id = _decode_cursor(cursor)
            # Use explicit OR for composite cursor comparison.
            # SQLite stores datetimes as text, so we convert cursor_dt
            # to the same format SQLite uses for reliable comparison.
            cursor_dt_str = cursor_dt.strftime("%Y-%m-%d %H:%M:%S")
            query = query.where(
                text(
                    "(knowledge_docs.created_at < :cursor_dt "
                    "OR (knowledge_docs.created_at = :cursor_dt "
                    "AND knowledge_docs.id < :cursor_id))"
                ).bindparams(
                    cursor_dt=cursor_dt_str,
                    cursor_id=cursor_id,
                )
            )

        query = query.limit(limit + 1)

        result = await self.db.execute(query)
        docs = list(result.scalars().all())

        has_more = len(docs) > limit
        if has_more:
            docs = docs[:limit]

        next_cursor = None
        if has_more and docs:
            last = docs[-1]
            next_cursor = _encode_cursor(last.created_at, last.id)

        return {
            "items": docs,
            "next_cursor": next_cursor,
            "has_more": has_more,
        }

    # ------------------------------------------------------------------
    # migrate_mitre_tags
    # ------------------------------------------------------------------

    async def migrate_mitre_tags(self) -> dict:
        """Migrate ``mitre:`` prefixed tags into frontmatter YAML.

        For writable sources the MITRE tags are written into the file's
        frontmatter ``tags`` list and the document is re-parsed.  For
        read-only sources the ``mitre:`` prefix is stripped in the DB
        only (no file write).

        Returns ``{"migrated": N, "skipped": N, "errors": [...]}``.
        """
        query = (
            select(KnowledgeDoc)
            .where(KnowledgeDoc.tags.like("%mitre:%"))
            .options(selectinload(KnowledgeDoc.source))
        )
        result = await self.db.execute(query)
        docs = list(result.scalars().all())

        migrated = 0
        skipped = 0
        errors: list[dict] = []

        for doc in docs:
            try:
                all_tags = (doc.tags or "").split()
                mitre_tags = [
                    t.removeprefix("mitre:")
                    for t in all_tags
                    if t.startswith("mitre:")
                ]

                if not mitre_tags:
                    skipped += 1
                    continue

                # Read-only source: strip prefix in DB only
                if doc.source.read_only:
                    non_mitre = [
                        t for t in all_tags
                        if not t.startswith("mitre:")
                    ]
                    updated = non_mitre + mitre_tags
                    doc.tags = (
                        " ".join(updated) if updated else None
                    )
                    migrated += 1
                    continue

                # Writable source: update frontmatter on disk
                vault_path = Path(doc.source.path)
                file_path = vault_path / doc.relative_path

                if not file_path.exists():
                    errors.append(
                        {
                            "id": doc.id,
                            "reason": f"File not found: {file_path}",
                        }
                    )
                    continue

                raw = file_path.read_text(encoding="utf-8")
                post = frontmatter.loads(raw)

                existing_fm_tags = post.metadata.get("tags", [])
                if isinstance(existing_fm_tags, str):
                    existing_fm_tags = [
                        t.strip()
                        for t in existing_fm_tags.split(",")
                    ]

                merged = list(
                    dict.fromkeys(existing_fm_tags + mitre_tags)
                )
                post.metadata["tags"] = merged

                file_path.write_text(
                    frontmatter.dumps(post), encoding="utf-8"
                )

                parser = MarkdownParser()
                parsed = parser.parse(file_path, vault_path)

                doc.title = parsed["title"]
                doc.body = parsed["body"]
                doc.tags = (
                    " ".join(parsed["tags"])
                    if parsed["tags"]
                    else None
                )
                doc.content_hash = parsed["content_hash"]
                doc.wikilinks = parsed["wikilinks"]
                doc.frontmatter = self._sanitize_frontmatter(
                    parsed["frontmatter"]
                )

                migrated += 1
            except Exception as exc:
                errors.append(
                    {"id": doc.id, "reason": str(exc)}
                )

        await self.db.commit()
        return {
            "migrated": migrated,
            "skipped": skipped,
            "errors": errors,
        }

    # ------------------------------------------------------------------
    # get_all_tags
    # ------------------------------------------------------------------

    async def get_all_tags(
        self, source_id: str | None = None
    ) -> list[dict]:
        """Return all unique tags across documents with counts.

        Tags are stored as space-separated strings in the DB. This method
        splits them and aggregates counts across all documents.
        """
        query = select(KnowledgeDoc.tags).where(
            KnowledgeDoc.tags.isnot(None),
            KnowledgeDoc.tags != "",
        )
        if source_id:
            query = query.where(KnowledgeDoc.source_id == source_id)

        result = await self.db.execute(query)

        tag_counts: dict[str, int] = {}
        for (tags_str,) in result.fetchall():
            if tags_str:
                for tag in tags_str.split():
                    tag_counts[tag] = tag_counts.get(tag, 0) + 1

        return sorted(
            [{"tag": t, "count": c} for t, c in tag_counts.items()],
            key=lambda x: (-x["count"], x["tag"]),
        )

    # ------------------------------------------------------------------
    # rename_tag
    # ------------------------------------------------------------------

    async def rename_tag(
        self, old_tag: str, new_tag: str
    ) -> dict:
        """Rename a tag across all documents.

        Updates both the YAML frontmatter on disk and the DB ``tags``
        column.  Read-only sources are skipped.

        Returns ``{"docs_updated": N, "read_only_skipped": N}``.
        """
        old_tag = old_tag.strip()
        new_tag = new_tag.strip().lower()

        if old_tag == new_tag:
            return {"docs_updated": 0, "read_only_skipped": 0}
        if " " in new_tag:
            raise AppException(
                ErrorCode.KB_TAG_INVALID,
                "Tag must not contain spaces",
            )

        query = (
            select(KnowledgeDoc)
            .where(
                text(
                    "(knowledge_docs.tags = :tag_exact "
                    "OR knowledge_docs.tags LIKE :tag_start "
                    "OR knowledge_docs.tags LIKE :tag_middle "
                    "OR knowledge_docs.tags LIKE :tag_end)"
                ).bindparams(
                    tag_exact=old_tag,
                    tag_start=f"{old_tag} %",
                    tag_middle=f"% {old_tag} %",
                    tag_end=f"% {old_tag}",
                )
            )
            .options(selectinload(KnowledgeDoc.source))
        )
        result = await self.db.execute(query)
        docs = list(result.scalars().all())

        updated = 0
        read_only_skipped = 0

        for doc in docs:
            if doc.source.read_only:
                read_only_skipped += 1
                continue

            vault_path = Path(doc.source.path)
            file_path = vault_path / doc.relative_path
            if not file_path.exists():
                self.log.warning(f"rename_tag: file missing {file_path}")
                continue

            raw = file_path.read_text(encoding="utf-8")
            post = frontmatter.loads(raw)

            fm_tags = post.metadata.get("tags", [])
            if isinstance(fm_tags, str):
                fm_tags = [t.strip() for t in fm_tags.split(",")]

            fm_tags = [new_tag if t == old_tag else t for t in fm_tags]
            fm_tags = list(dict.fromkeys(fm_tags))  # deduplicate
            post.metadata["tags"] = fm_tags

            async with vault_file_lock(doc.source.path):
                file_path.write_text(
                    frontmatter.dumps(post), encoding="utf-8"
                )
                parser = MarkdownParser()
                parsed = parser.parse(file_path, vault_path)

            doc.title = parsed["title"]
            doc.body = parsed["body"]
            doc.tags = (
                " ".join(parsed["tags"]) if parsed["tags"] else None
            )
            doc.content_hash = parsed["content_hash"]
            doc.wikilinks = parsed["wikilinks"]
            doc.frontmatter = self._sanitize_frontmatter(
                parsed["frontmatter"]
            )
            updated += 1

        await self.db.commit()
        return {
            "docs_updated": updated,
            "read_only_skipped": read_only_skipped,
        }

    # ------------------------------------------------------------------
    # delete_tag
    # ------------------------------------------------------------------

    async def delete_tag(self, tag: str) -> dict:
        """Delete a tag from all documents.

        Removes the tag from YAML frontmatter on disk and the DB
        ``tags`` column.  Read-only sources are skipped.

        Returns ``{"docs_updated": N, "read_only_skipped": N}``.
        """
        tag = tag.strip()

        query = (
            select(KnowledgeDoc)
            .where(
                text(
                    "(knowledge_docs.tags = :tag_exact "
                    "OR knowledge_docs.tags LIKE :tag_start "
                    "OR knowledge_docs.tags LIKE :tag_middle "
                    "OR knowledge_docs.tags LIKE :tag_end)"
                ).bindparams(
                    tag_exact=tag,
                    tag_start=f"{tag} %",
                    tag_middle=f"% {tag} %",
                    tag_end=f"% {tag}",
                )
            )
            .options(selectinload(KnowledgeDoc.source))
        )
        result = await self.db.execute(query)
        docs = list(result.scalars().all())

        updated = 0
        read_only_skipped = 0

        for doc in docs:
            if doc.source.read_only:
                read_only_skipped += 1
                continue

            vault_path = Path(doc.source.path)
            file_path = vault_path / doc.relative_path
            if not file_path.exists():
                self.log.warning(f"delete_tag: file missing {file_path}")
                continue

            raw = file_path.read_text(encoding="utf-8")
            post = frontmatter.loads(raw)

            fm_tags = post.metadata.get("tags", [])
            if isinstance(fm_tags, str):
                fm_tags = [t.strip() for t in fm_tags.split(",")]

            fm_tags = [t for t in fm_tags if t != tag]

            if fm_tags:
                post.metadata["tags"] = fm_tags
            else:
                post.metadata.pop("tags", None)

            async with vault_file_lock(doc.source.path):
                file_path.write_text(
                    frontmatter.dumps(post), encoding="utf-8"
                )
                parser = MarkdownParser()
                parsed = parser.parse(file_path, vault_path)

            doc.title = parsed["title"]
            doc.body = parsed["body"]
            doc.tags = (
                " ".join(parsed["tags"]) if parsed["tags"] else None
            )
            doc.content_hash = parsed["content_hash"]
            doc.wikilinks = parsed["wikilinks"]
            doc.frontmatter = self._sanitize_frontmatter(
                parsed["frontmatter"]
            )
            updated += 1

        await self.db.commit()
        return {
            "docs_updated": updated,
            "read_only_skipped": read_only_skipped,
        }

    # ------------------------------------------------------------------
    # bulk_edit_tags
    # ------------------------------------------------------------------

    async def bulk_edit_tags(
        self,
        doc_ids: list[str],
        add_tags: list[str],
        remove_tags: list[str],
    ) -> dict:
        """Add and/or remove tags on a set of documents.

        Modifies YAML frontmatter on disk and the DB ``tags`` column.
        Read-only sources are skipped.

        Returns ``{"docs_updated": N, "read_only_skipped": N}``.
        """
        # Validate tags
        add_clean = []
        for t in add_tags:
            t = t.strip().lower()
            if " " in t:
                raise AppException(
                    ErrorCode.KB_TAG_INVALID,
                    f"Tag must not contain spaces: '{t}'",
                )
            if t:
                add_clean.append(t)

        remove_set = {t.strip().lower() for t in remove_tags if t.strip()}

        query = (
            select(KnowledgeDoc)
            .where(KnowledgeDoc.id.in_(doc_ids))
            .options(selectinload(KnowledgeDoc.source))
        )
        result = await self.db.execute(query)
        docs = list(result.scalars().all())

        updated = 0
        read_only_skipped = 0

        for doc in docs:
            if doc.source.read_only:
                read_only_skipped += 1
                continue

            vault_path = Path(doc.source.path)
            file_path = vault_path / doc.relative_path
            if not file_path.exists():
                self.log.warning(
                    f"bulk_edit_tags: file missing {file_path}"
                )
                continue

            raw = file_path.read_text(encoding="utf-8")
            post = frontmatter.loads(raw)

            fm_tags = post.metadata.get("tags", [])
            if isinstance(fm_tags, str):
                fm_tags = [t.strip() for t in fm_tags.split(",")]

            # Remove tags
            fm_tags = [t for t in fm_tags if t not in remove_set]
            # Add tags (only if not already present)
            for t in add_clean:
                if t not in fm_tags:
                    fm_tags.append(t)
            # Deduplicate preserving order
            fm_tags = list(dict.fromkeys(fm_tags))

            if fm_tags:
                post.metadata["tags"] = fm_tags
            else:
                post.metadata.pop("tags", None)

            async with vault_file_lock(doc.source.path):
                file_path.write_text(
                    frontmatter.dumps(post), encoding="utf-8"
                )
                parser = MarkdownParser()
                parsed = parser.parse(file_path, vault_path)

            doc.title = parsed["title"]
            doc.body = parsed["body"]
            doc.tags = (
                " ".join(parsed["tags"]) if parsed["tags"] else None
            )
            doc.content_hash = parsed["content_hash"]
            doc.wikilinks = parsed["wikilinks"]
            doc.frontmatter = self._sanitize_frontmatter(
                parsed["frontmatter"]
            )
            updated += 1

        await self.db.commit()
        return {
            "docs_updated": updated,
            "read_only_skipped": read_only_skipped,
        }

    # ------------------------------------------------------------------
    # get_tree
    # ------------------------------------------------------------------

    async def get_tree(
        self, source_id: str | None = None, tag: str | None = None
    ) -> dict:
        """Build a nested folder tree from flat document paths.

        Returns ``{name, type, children, docs}`` rooted at ``"/"``.
        """
        query = select(
            KnowledgeDoc.id,
            KnowledgeDoc.title,
            KnowledgeDoc.relative_path,
            KnowledgeDoc.tags,
            KnowledgeDoc.updated_at,
        )
        if source_id:
            query = query.where(
                KnowledgeDoc.source_id == source_id
            )
        if tag:
            query = query.where(
                text(
                    "(knowledge_docs.tags = :tag_exact "
                    "OR knowledge_docs.tags LIKE :tag_start "
                    "OR knowledge_docs.tags LIKE :tag_middle "
                    "OR knowledge_docs.tags LIKE :tag_end)"
                ).bindparams(
                    tag_exact=tag,
                    tag_start=f"{tag} %",
                    tag_middle=f"% {tag} %",
                    tag_end=f"% {tag}",
                )
            )

        result = await self.db.execute(query)
        rows = result.fetchall()

        root: dict = {
            "name": "/",
            "type": "folder",
            "children": [],
            "docs": [],
        }

        for row in rows:
            doc_dict = {
                "id": row.id,
                "title": row.title,
                "relative_path": row.relative_path,
                "tags": row.tags,
                "updated_at": row.updated_at.isoformat() if row.updated_at else None,
            }
            parts = row.relative_path.split("/")
            current = root

            # Navigate / create folder hierarchy
            for folder_name in parts[:-1]:
                found = None
                for child in current["children"]:
                    if child["name"] == folder_name:
                        found = child
                        break
                if not found:
                    found = {
                        "name": folder_name,
                        "type": "folder",
                        "children": [],
                        "docs": [],
                    }
                    current["children"].append(found)
                current = found

            current["docs"].append(doc_dict)

        # Recursive sort
        self._sort_tree(root)
        return root

    # ------------------------------------------------------------------
    # get_source
    # ------------------------------------------------------------------

    async def get_source(self, source_id: str) -> KnowledgeSource:
        """Return a ``KnowledgeSource`` by ID.

        Raises ``AppException(KB_SOURCE_NOT_FOUND)`` when missing.
        """
        source = await self.db.get(KnowledgeSource, source_id)
        if not source:
            raise AppException(
                ErrorCode.KB_SOURCE_NOT_FOUND,
                f"Knowledge source '{source_id}' not found",
                {"source_id": source_id},
            )
        return source

    # ------------------------------------------------------------------
    # Bookmarks
    # ------------------------------------------------------------------

    async def list_bookmarks(self, user_id: str) -> list[dict]:
        """List all bookmarks for a user with doc details."""
        result = await self.db.execute(
            text(
                "SELECT kb.id, kb.doc_id, kd.title, kd.relative_path, "
                "kd.source_id, kb.created_at "
                "FROM knowledge_bookmarks kb "
                "JOIN knowledge_docs kd ON kb.doc_id = kd.id "
                "WHERE kb.user_id = :user_id "
                "ORDER BY kb.created_at DESC"
            ),
            {"user_id": user_id},
        )
        return [dict(row._mapping) for row in result.fetchall()]

    async def add_bookmark(self, user_id: str, doc_id: str) -> dict:
        """Add a bookmark. Returns the created bookmark with doc details."""
        from app.models.knowledge import KnowledgeBookmark

        # Verify doc exists
        doc = await self.get_doc(doc_id)

        bookmark = KnowledgeBookmark(user_id=user_id, doc_id=doc_id)
        self.db.add(bookmark)
        await self.db.commit()
        await self.db.refresh(bookmark)

        return {
            "id": bookmark.id,
            "doc_id": bookmark.doc_id,
            "title": doc.title,
            "relative_path": doc.relative_path,
            "source_id": doc.source_id,
            "created_at": bookmark.created_at,
        }

    async def remove_bookmark(self, user_id: str, doc_id: str) -> None:
        """Remove a bookmark by user_id + doc_id."""
        from app.models.knowledge import KnowledgeBookmark

        await self.db.execute(
            sa_delete(KnowledgeBookmark).where(
                KnowledgeBookmark.user_id == user_id,
                KnowledgeBookmark.doc_id == doc_id,
            )
        )
        await self.db.commit()

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _sanitize_frontmatter(meta: dict) -> dict:
        """Convert ``datetime.date`` / ``datetime.datetime`` values to
        ISO-format strings so the dict is JSON-serializable.
        """
        result: dict = {}
        for key, value in meta.items():
            if isinstance(value, datetime.date | datetime.datetime):
                result[key] = value.isoformat()
            else:
                result[key] = value
        return result

    @staticmethod
    def _sanitize_fts_query(query: str) -> str:
        """Strip FTS5 operators and wrap each term in double quotes."""
        cleaned = re.sub(r"[^\w\s]", "", query)
        terms = cleaned.split()
        return " ".join(f'"{term}"' for term in terms if term)

    @staticmethod
    def _sort_tree(node: dict) -> None:
        """Recursively sort *children* and *docs* alphabetically."""
        node["children"].sort(key=lambda n: n["name"].lower())
        node["docs"].sort(key=lambda d: d["title"].lower())
        for child in node["children"]:
            KBService._sort_tree(child)

    # ------------------------------------------------------------------
    # Post-filter helpers for line: and section: (FILT-04, FILT-05)
    # ------------------------------------------------------------------

    _HEADING_RE = re.compile(r"^#{1,6}\s", re.MULTILINE)

    @staticmethod
    def _matches_line_filter(body: str, keyword: str) -> bool:
        """Check if *keyword* appears on any single line in *body*."""
        if not body:
            return False
        kw_lower = keyword.lower()
        for line in body.splitlines():
            if kw_lower in line.lower():
                return True
        return False

    @staticmethod
    def _matches_section_filter(body: str, keyword: str) -> bool:
        """Check if *keyword* appears under any heading section.

        A section is a heading line (``# ...``) plus all content until
        the next heading.  The heading line itself is part of the
        section.  Returns True on the first section match.
        """
        if not body:
            return False
        kw_lower = keyword.lower()
        current_section = ""
        for line in body.splitlines():
            if re.match(r"^#{1,6}\s", line):
                # Check previous section before starting new one
                if kw_lower in current_section.lower():
                    return True
                current_section = line
            else:
                current_section += "\n" + line
        # Check the last section
        return kw_lower in current_section.lower()
