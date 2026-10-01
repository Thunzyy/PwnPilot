from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.schemas.graph import GraphEdge, GraphNode


class ReportEvidenceLinkResponse(BaseModel):
    id: str
    patch_id: str | None = None
    source_type: str
    source_id: str
    label: str | None = None
    preview: str | None = None
    href: str | None = None
    created_at: datetime


class ReportSectionResponse(BaseModel):
    id: str
    key: str
    title: str
    content_md: str
    position: int
    updated_at: datetime


class ReportResponse(BaseModel):
    id: str
    project_id: str
    title: str
    profile: str
    markdown_path: str | None = None
    current_revision: int
    last_evaluated_at: datetime | None = None
    last_accepted_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    sections: list[ReportSectionResponse]


class ReportProposalSectionPatchResponse(BaseModel):
    id: str
    section_key: str
    section_title: str
    summary: str | None = None
    current_content_md: str
    content_md: str
    diff_text: str
    created_at: datetime
    evidence_links: list[ReportEvidenceLinkResponse]


class ReportProposalResponse(BaseModel):
    id: str
    report_id: str
    trigger_type: str
    status: str
    summary: str | None = None
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None = None
    section_patches: list[ReportProposalSectionPatchResponse]
    evidence_links: list[ReportEvidenceLinkResponse]


class ReportProposalListResponse(BaseModel):
    items: list[ReportProposalResponse]
    total: int


class ReportProposalCreateResponse(BaseModel):
    proposal: ReportProposalResponse
    duplicate: bool


class ReportEvidenceUsageItemResponse(BaseModel):
    id: str
    proposal_id: str
    proposal_status: str
    patch_id: str | None = None
    source_type: str
    source_id: str
    created_at: datetime


class ReportEvidenceUsageListResponse(BaseModel):
    items: list[ReportEvidenceUsageItemResponse]
    total: int


class ReportBundleArtifactResponse(BaseModel):
    id: str
    project_id: str
    report_id: str
    filename: str
    content_type: str
    size_bytes: int
    sha256: str
    report_revision: int
    graph_node_count: int
    graph_edge_count: int
    accepted_command_count: int
    accepted_command_ids: list[str]
    created_at: datetime


class ReportBundleArtifactListResponse(BaseModel):
    items: list[ReportBundleArtifactResponse]
    total: int


class ReportFolderExportResponse(BaseModel):
    path: str
    files: dict[str, str]
    file_count: int
    manifest: dict[str, Any]


class ReportNotesSyncResponse(BaseModel):
    source_id: str
    source_name: str
    source_path: str
    doc_id: str | None = None
    doc_path: str
    report_revision: int | None = None
    generated_at: str | None = None
    files: dict[str, str]
    file_count: int
    stats: dict[str, Any]


class ReportNotesSyncStatusResponse(BaseModel):
    sync: ReportNotesSyncResponse | None = None


class ReportNotesSyncDiffResponse(BaseModel):
    changed: bool
    synced_report_revision: int | None = None
    current_report_revision: int
    diff_text: str


class ReportBundleArtifactReportDiffResponse(BaseModel):
    changed: bool
    diff_text: str


class ReportBundleArtifactCommandDeltaResponse(BaseModel):
    added_ids: list[str]
    removed_ids: list[str]
    unchanged_ids: list[str]


class ReportBundleArtifactGraphDeltaResponse(BaseModel):
    added_node_ids: list[str]
    removed_node_ids: list[str]
    added_nodes: list[GraphNode] = Field(default_factory=list)
    removed_nodes: list[GraphNode] = Field(default_factory=list)
    added_edge_ids: list[str]
    removed_edge_ids: list[str]
    added_edges: list[GraphEdge] = Field(default_factory=list)
    removed_edges: list[GraphEdge] = Field(default_factory=list)


class ReportBundleArtifactCompareSummaryResponse(BaseModel):
    added_commands: int
    removed_commands: int
    added_nodes: int
    removed_nodes: int
    added_edges: int
    removed_edges: int
    report_changed: bool


class ReportBundleArtifactCompareResponse(BaseModel):
    base: ReportBundleArtifactResponse
    target: ReportBundleArtifactResponse
    report_diff: ReportBundleArtifactReportDiffResponse
    commands: ReportBundleArtifactCommandDeltaResponse
    graph: ReportBundleArtifactGraphDeltaResponse
    summary: ReportBundleArtifactCompareSummaryResponse


class ReportProposalEvidenceInput(BaseModel):
    source_type: str = Field(min_length=1)
    source_id: str = Field(min_length=1)


class ReportManualProposalRequest(BaseModel):
    section_key: str | None = Field(default=None, max_length=64)
    section_hint: str | None = Field(default=None, max_length=64)
    content_md: str = Field(min_length=1)
    summary: str | None = None
    trigger_type: str = Field(default="manual", min_length=1, max_length=32)
    evidence: list[ReportProposalEvidenceInput] = Field(default_factory=list)


class ReportEvaluationTaskResponse(BaseModel):
    task_id: str
    project_id: str
    trigger_type: str
    target_section_keys: list[str] | None = None
    status: str
    proposal_id: str | None = None
    error: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None


class ReportProposalActionResponse(BaseModel):
    report: ReportResponse
    proposal: ReportProposalResponse


class ReportMockSeedResponse(BaseModel):
    project_id: str
    scenario: str
    accepted_revision_count: int
    report: ReportResponse
    pending_proposals: list[ReportProposalResponse]
