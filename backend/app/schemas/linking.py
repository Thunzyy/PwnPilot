"""Pydantic schemas for Engagement Linking and MITRE ATT&CK tagging.

These schemas handle validation and serialization for:
- Timeline-to-KB link CRUD
- Bidirectional link queries (LinkedEngagement, LinkedDoc)
- MITRE ATT&CK technique tagging and validation
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

# =============================================================================
# Link schemas
# =============================================================================


class LinkCreateResponse(BaseModel):
    """Response after creating a timeline-to-KB link."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    timeline_entry_id: str
    doc_id: str
    created_at: datetime


class LinkedEngagement(BaseModel):
    """A timeline entry + project linked to a KB article.

    Used for LINK-02 'Used in' queries: given a KB doc, find all
    timeline entries that reference it.
    """

    timeline_entry_id: str
    project_id: str
    project_name: str
    entry_type: str
    entry_content: str
    created_at: str


class LinkedDoc(BaseModel):
    """A KB doc linked to a timeline entry.

    Used for LINK-03 'Related knowledge' queries: given a timeline
    entry, find all KB docs linked to it.
    """

    doc_id: str
    title: str
    relative_path: str
    source_id: str


# =============================================================================
# MITRE ATT&CK schemas
# =============================================================================


class MitreTagRequest(BaseModel):
    """Request to add or remove a MITRE ATT&CK technique tag.

    Validates technique IDs match the ATT&CK format:
    - Parent technique: T followed by 4 digits (e.g., T1190)
    - Sub-technique: T followed by 4 digits, dot, 3 digits (e.g., T1059.001)
    """

    technique_id: str = Field(..., pattern=r"^T\d{4}(\.\d{3})?$")


class MitreTechnique(BaseModel):
    """A single MITRE ATT&CK technique from the static lookup."""

    id: str
    name: str
    tactic: str


class MitreTagResponse(BaseModel):
    """Response after adding or removing a MITRE technique tag."""

    doc_id: str
    tags: str
    mitre_techniques: list[str]
