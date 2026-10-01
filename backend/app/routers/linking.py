"""Engagement Linking and MITRE ATT&CK API endpoints.

Thin router that delegates business logic to LinkingService.
Endpoints: link CRUD, bidirectional queries, MITRE tag management,
and technique catalog search.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.database import get_db
from app.schemas.linking import (
    LinkCreateResponse,
    LinkedDoc,
    LinkedEngagement,
    MitreTagRequest,
    MitreTagResponse,
    MitreTechnique,
)
from app.services.linking_service import LinkingService

router = APIRouter(prefix="/linking", tags=["engagement-linking"])


# ---------------------------------------------------------------------------
# Link CRUD (LINK-01)
# ---------------------------------------------------------------------------


@router.post(
    "/timeline/{entry_id}/kb/{doc_id}",
    response_model=LinkCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_link(
    entry_id: str,
    doc_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a link between a timeline entry and a KB document."""
    service = LinkingService(db)
    link = await service.create_link(entry_id, doc_id)
    return link


@router.delete(
    "/timeline/{entry_id}/kb/{doc_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_link(
    entry_id: str,
    doc_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove a link between a timeline entry and a KB document."""
    service = LinkingService(db)
    await service.delete_link(entry_id, doc_id)


# ---------------------------------------------------------------------------
# Bidirectional queries (LINK-02, LINK-03)
# ---------------------------------------------------------------------------


@router.get(
    "/kb/{doc_id}/engagements",
    response_model=list[LinkedEngagement],
)
async def get_doc_engagements(
    doc_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get timeline entries linked to a KB document (LINK-02)."""
    service = LinkingService(db)
    return await service.get_linked_engagements(doc_id)


@router.get(
    "/timeline/{entry_id}/docs",
    response_model=list[LinkedDoc],
)
async def get_entry_docs(
    entry_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get KB documents linked to a timeline entry (LINK-03)."""
    service = LinkingService(db)
    return await service.get_linked_docs(entry_id)


# ---------------------------------------------------------------------------
# MITRE ATT&CK tag management (MITRE-01)
# ---------------------------------------------------------------------------


@router.post(
    "/kb/documents/{doc_id}/mitre-tags",
    response_model=MitreTagResponse,
)
async def add_mitre_tag(
    doc_id: str,
    body: MitreTagRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add a MITRE ATT&CK technique tag to a KB document."""
    service = LinkingService(db)
    doc = await service.add_mitre_tag(doc_id, body.technique_id)
    mitre_tags = await service.get_mitre_tags(doc_id)
    return MitreTagResponse(
        doc_id=doc_id,
        tags=doc.tags or "",
        mitre_techniques=mitre_tags,
    )


@router.delete(
    "/kb/documents/{doc_id}/mitre-tags/{technique_id}",
    response_model=MitreTagResponse,
)
async def remove_mitre_tag(
    doc_id: str,
    technique_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove a MITRE ATT&CK technique tag from a KB document."""
    service = LinkingService(db)
    doc = await service.remove_mitre_tag(doc_id, technique_id)
    mitre_tags = await service.get_mitre_tags(doc_id)
    return MitreTagResponse(
        doc_id=doc_id,
        tags=doc.tags or "",
        mitre_techniques=mitre_tags,
    )


# ---------------------------------------------------------------------------
# MITRE technique catalog (MITRE-02)
# ---------------------------------------------------------------------------


@router.get(
    "/mitre/techniques",
    response_model=list[MitreTechnique],
)
async def list_mitre_techniques(
    q: str | None = None,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List MITRE ATT&CK techniques with optional search filter."""
    service = LinkingService(db)
    return service.list_mitre_techniques(q=q)
