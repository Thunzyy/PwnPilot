"""LinkingService -- engagement linking and MITRE ATT&CK tag management.

Business logic for:
- Creating/deleting timeline-to-KB links (LINK-01)
- Querying linked engagements for a KB doc (LINK-02)
- Querying linked KB docs for a timeline entry (LINK-03)
- Adding/removing MITRE ATT&CK technique tags on KB docs (MITRE-01)
- Searching the curated MITRE technique catalog (MITRE-02)
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ErrorCode
from app.core.exceptions import AppException
from app.models.knowledge import KnowledgeDoc
from app.models.project import Project
from app.models.timeline import Timeline
from app.models.timeline_kb_link import TimelineKBLink
from app.schemas.linking import LinkedDoc, LinkedEngagement, MitreTechnique
from app.services.base import BaseService

# ---------------------------------------------------------------------------
# Module-level MITRE technique catalog (loaded once, not per-request)
# ---------------------------------------------------------------------------
_MITRE_JSON_PATH = (
    Path(__file__).resolve().parent.parent.parent / "data" / "mitre_techniques.json"
)
_MITRE_TECHNIQUES: list[MitreTechnique] = []

if _MITRE_JSON_PATH.exists():
    with open(_MITRE_JSON_PATH) as f:
        _raw = json.load(f)
    _MITRE_TECHNIQUES = [
        MitreTechnique(**t) for t in _raw if "id" in t
    ]

# Regex for MITRE ATT&CK technique IDs: T1234 or T1234.567
_MITRE_ID_RE = re.compile(r"^T\d{4}(\.\d{3})?$")


# ---------------------------------------------------------------------------
# LinkingService
# ---------------------------------------------------------------------------


class LinkingService(BaseService):
    """Engagement linking and MITRE ATT&CK tagging service.

    Methods
    -------
    create_link     -- Create a timeline-to-KB link
    delete_link     -- Remove a timeline-to-KB link
    get_linked_engagements -- LINK-02: "Used in" panel
    get_linked_docs -- LINK-03: "Related knowledge"
    add_mitre_tag   -- MITRE-01: Add technique tag to KB doc
    remove_mitre_tag -- MITRE-01: Remove technique tag
    get_mitre_tags  -- MITRE-01: List technique tags on a doc
    list_mitre_techniques -- MITRE-02: Search technique catalog
    """

    def __init__(self, db: AsyncSession):
        super().__init__("service.linking")
        self.db = db

    # ------------------------------------------------------------------
    # Link management (LINK-01)
    # ------------------------------------------------------------------

    async def create_link(
        self, timeline_entry_id: str, doc_id: str
    ) -> TimelineKBLink:
        """Create a link between a timeline entry and a KB doc.

        Validates both entities exist. Raises on duplicate.
        """
        await self._validate_link_entities(timeline_entry_id, doc_id)

        link = TimelineKBLink(
            timeline_entry_id=timeline_entry_id,
            doc_id=doc_id,
        )
        self.db.add(link)
        await self.db.commit()
        await self.db.refresh(link)

        self.log.info(
            "Link created",
            timeline_entry_id=timeline_entry_id,
            doc_id=doc_id,
        )
        return link

    async def delete_link(
        self, timeline_entry_id: str, doc_id: str
    ) -> None:
        """Remove a timeline-to-KB link."""
        result = await self.db.execute(
            select(TimelineKBLink).where(
                TimelineKBLink.timeline_entry_id == timeline_entry_id,
                TimelineKBLink.doc_id == doc_id,
            )
        )
        link = result.scalar_one_or_none()
        if not link:
            raise AppException(
                ErrorCode.KB_LINK_NOT_FOUND,
                "Link not found",
                {
                    "timeline_entry_id": timeline_entry_id,
                    "doc_id": doc_id,
                },
            )

        await self.db.delete(link)
        await self.db.commit()

        self.log.info(
            "Link deleted",
            timeline_entry_id=timeline_entry_id,
            doc_id=doc_id,
        )

    # ------------------------------------------------------------------
    # Bidirectional queries
    # ------------------------------------------------------------------

    async def get_linked_engagements(
        self, doc_id: str
    ) -> list[LinkedEngagement]:
        """LINK-02: Get timeline entries + projects linked to a KB doc.

        JOINs TimelineKBLink -> Timeline -> Project.
        Returns list ordered by created_at desc.
        """
        result = await self.db.execute(
            select(
                TimelineKBLink.timeline_entry_id,
                Timeline.type.label("entry_type"),
                Timeline.content.label("entry_content"),
                Timeline.created_at,
                Project.id.label("project_id"),
                Project.name.label("project_name"),
            )
            .join(
                Timeline,
                TimelineKBLink.timeline_entry_id == Timeline.id,
            )
            .join(
                Project,
                Timeline.project_id == Project.id,
            )
            .where(TimelineKBLink.doc_id == doc_id)
            .order_by(Timeline.created_at.desc())
        )

        rows = result.fetchall()
        return [
            LinkedEngagement(
                timeline_entry_id=row.timeline_entry_id,
                project_id=row.project_id,
                project_name=row.project_name,
                entry_type=row.entry_type,
                entry_content=row.entry_content,
                created_at=str(row.created_at),
            )
            for row in rows
        ]

    async def get_linked_docs(
        self, timeline_entry_id: str
    ) -> list[LinkedDoc]:
        """LINK-03: Get KB docs linked to a timeline entry.

        JOINs TimelineKBLink -> KnowledgeDoc.
        """
        result = await self.db.execute(
            select(
                KnowledgeDoc.id.label("doc_id"),
                KnowledgeDoc.title,
                KnowledgeDoc.relative_path,
                KnowledgeDoc.source_id,
            )
            .join(
                TimelineKBLink,
                TimelineKBLink.doc_id == KnowledgeDoc.id,
            )
            .where(
                TimelineKBLink.timeline_entry_id == timeline_entry_id
            )
        )

        rows = result.fetchall()
        return [
            LinkedDoc(
                doc_id=row.doc_id,
                title=row.title,
                relative_path=row.relative_path,
                source_id=row.source_id,
            )
            for row in rows
        ]

    # ------------------------------------------------------------------
    # MITRE tag management (MITRE-01)
    # ------------------------------------------------------------------

    async def add_mitre_tag(
        self, doc_id: str, technique_id: str
    ) -> KnowledgeDoc:
        """Add a MITRE ATT&CK technique tag to a KB doc.

        Validates technique_id format. Prepends ``mitre:`` prefix.
        Appends to space-separated tags column.
        """
        if not _MITRE_ID_RE.match(technique_id):
            raise AppException(
                ErrorCode.KB_INVALID_MITRE_ID,
                f"Invalid MITRE technique ID: '{technique_id}'",
                {"technique_id": technique_id},
            )

        doc = await self.db.get(KnowledgeDoc, doc_id)
        if not doc:
            raise AppException(
                ErrorCode.KB_DOC_NOT_FOUND,
                f"Document '{doc_id}' not found",
                {"doc_id": doc_id},
            )

        mitre_tag = f"mitre:{technique_id}"
        current_tags = doc.tags.split() if doc.tags else []

        if mitre_tag in current_tags:
            raise AppException(
                ErrorCode.KB_MITRE_TAG_EXISTS,
                f"Document already tagged with {technique_id}",
                {"doc_id": doc_id, "technique_id": technique_id},
            )

        current_tags.append(mitre_tag)
        doc.tags = " ".join(current_tags)
        await self.db.commit()
        await self.db.refresh(doc)

        self.log.info(
            "MITRE tag added",
            doc_id=doc_id,
            technique_id=technique_id,
        )
        return doc

    async def remove_mitre_tag(
        self, doc_id: str, technique_id: str
    ) -> KnowledgeDoc:
        """Remove a MITRE ATT&CK technique tag from a KB doc."""
        doc = await self.db.get(KnowledgeDoc, doc_id)
        if not doc:
            raise AppException(
                ErrorCode.KB_DOC_NOT_FOUND,
                f"Document '{doc_id}' not found",
                {"doc_id": doc_id},
            )

        mitre_tag = f"mitre:{technique_id}"
        current_tags = doc.tags.split() if doc.tags else []

        if mitre_tag in current_tags:
            current_tags.remove(mitre_tag)

        doc.tags = " ".join(current_tags) if current_tags else None
        await self.db.commit()
        await self.db.refresh(doc)

        self.log.info(
            "MITRE tag removed",
            doc_id=doc_id,
            technique_id=technique_id,
        )
        return doc

    async def get_mitre_tags(self, doc_id: str) -> list[str]:
        """Extract MITRE technique IDs from a doc's tags column.

        Returns technique IDs without ``mitre:`` prefix.
        """
        doc = await self.db.get(KnowledgeDoc, doc_id)
        if not doc:
            raise AppException(
                ErrorCode.KB_DOC_NOT_FOUND,
                f"Document '{doc_id}' not found",
                {"doc_id": doc_id},
            )

        if not doc.tags:
            return []

        return [
            tag.removeprefix("mitre:")
            for tag in doc.tags.split()
            if tag.startswith("mitre:")
        ]

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _validate_link_entities(
        self, timeline_entry_id: str, doc_id: str
    ) -> None:
        """Validate that both the timeline entry and KB doc exist,
        and that no duplicate link exists between them.
        """
        entry = await self.db.get(Timeline, timeline_entry_id)
        if not entry:
            raise AppException(
                ErrorCode.TIMELINE_ENTRY_NOT_FOUND,
                f"Timeline entry '{timeline_entry_id}' not found",
                {"timeline_entry_id": timeline_entry_id},
            )

        doc = await self.db.get(KnowledgeDoc, doc_id)
        if not doc:
            raise AppException(
                ErrorCode.KB_DOC_NOT_FOUND,
                f"Document '{doc_id}' not found",
                {"doc_id": doc_id},
            )

        result = await self.db.execute(
            select(TimelineKBLink).where(
                TimelineKBLink.timeline_entry_id == timeline_entry_id,
                TimelineKBLink.doc_id == doc_id,
            )
        )
        if result.scalar_one_or_none():
            raise AppException(
                ErrorCode.KB_LINK_EXISTS,
                "Link already exists between this entry and document",
                {
                    "timeline_entry_id": timeline_entry_id,
                    "doc_id": doc_id,
                },
            )

    # ------------------------------------------------------------------
    # MITRE lookup (MITRE-02)
    # ------------------------------------------------------------------

    def list_mitre_techniques(
        self, q: str | None = None
    ) -> list[MitreTechnique]:
        """List MITRE ATT&CK techniques with optional search filter.

        Filters by case-insensitive match on id or name.
        """
        if not q:
            return list(_MITRE_TECHNIQUES)

        q_lower = q.lower()
        return [
            t
            for t in _MITRE_TECHNIQUES
            if q_lower in t.id.lower() or q_lower in t.name.lower()
        ]
