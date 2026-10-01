from __future__ import annotations

from collections import defaultdict
from difflib import unified_diff

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_project_member
from app.database import get_db
from app.models.project import Project
from app.models.report import (
    ReportArtifactDB,
    ReportDB,
    ReportEvidenceLinkDB,
    ReportSectionDB,
    ReportUpdateProposalDB,
    ReportUpdateSectionPatchDB,
)
from app.schemas.report import (
    ReportBundleArtifactCommandDeltaResponse,
    ReportBundleArtifactCompareResponse,
    ReportBundleArtifactCompareSummaryResponse,
    ReportBundleArtifactGraphDeltaResponse,
    ReportBundleArtifactListResponse,
    ReportBundleArtifactReportDiffResponse,
    ReportBundleArtifactResponse,
    ReportEvaluationTaskResponse,
    ReportEvidenceLinkResponse,
    ReportEvidenceUsageItemResponse,
    ReportEvidenceUsageListResponse,
    ReportFolderExportResponse,
    ReportManualProposalRequest,
    ReportMockSeedResponse,
    ReportNotesSyncDiffResponse,
    ReportNotesSyncResponse,
    ReportNotesSyncStatusResponse,
    ReportProposalActionResponse,
    ReportProposalCreateResponse,
    ReportProposalListResponse,
    ReportProposalResponse,
    ReportProposalSectionPatchResponse,
    ReportResponse,
    ReportSectionResponse,
)
from app.services.report_bundle_service import ReportBundleService
from app.services.report_evaluation_task_manager import (
    ReportEvaluationTask,
    report_evaluation_task_manager,
)
from app.services.report_evidence_service import ReportEvidenceService
from app.services.report_mock_seed_service import ReportMockSeedService
from app.services.report_service import ReportService

router = APIRouter(prefix="/projects/{project_id}/report", tags=["report"])

SECTION_HINT_ALIASES: dict[str, tuple[str, ...]] = {
    "overview": ("overview", "executive_summary", "scope_methodology", "recon"),
    "attack_path": ("attack_path", "findings", "recon"),
    "enumeration": ("enumeration", "recon", "scope_methodology", "findings"),
    "foothold": ("foothold", "initial_access", "findings"),
    "privilege_escalation": ("privilege_escalation", "findings"),
    "flags_evidence": ("flags_evidence", "loot_evidence", "appendix_evidence"),
    "command_timeline": ("command_timeline", "appendix_evidence", "loot_evidence"),
}


@router.get("", response_model=ReportResponse)
async def get_project_report(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
):
    report = await _ensure_project_report(db, project)
    return await _build_report_response(db, report)


@router.get("/proposals", response_model=ReportProposalListResponse)
async def list_project_report_proposals(
    project_id: str,
    status: str = "pending",
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
):
    report = await _ensure_project_report(db, project)
    proposals = await _load_proposals(db, report.id, status=status)
    items = [await _build_proposal_response(db, report, proposal) for proposal in proposals]
    return ReportProposalListResponse(items=items, total=len(items))


@router.get("/evidence", response_model=ReportEvidenceUsageListResponse)
async def list_project_report_evidence_usage(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
):
    report = await _ensure_project_report(db, project)
    evidence_links = await _load_used_evidence_links(db, report.id)
    items = [
        ReportEvidenceUsageItemResponse(
            id=link.id,
            proposal_id=link.proposal_id,
            proposal_status=proposal.status,
            patch_id=link.patch_id,
            source_type=link.source_type,
            source_id=link.source_id,
            created_at=link.created_at,
        )
        for link, proposal in evidence_links
    ]
    return ReportEvidenceUsageListResponse(items=items, total=len(items))


@router.get("/bundle")
async def download_project_report_bundle(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
):
    report = await _ensure_project_report(db, project)
    bundle = await ReportBundleService(db).build_bundle(project=project, report=report)
    return Response(
        content=bundle.content,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{bundle.filename}"',
        },
    )


@router.get("/bundle/artifacts", response_model=ReportBundleArtifactListResponse)
async def list_project_report_bundle_artifacts(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
):
    report = await _ensure_project_report(db, project)
    artifacts = await ReportBundleService(db).list_bundle_artifacts(
        project_id=project.id,
        report_id=report.id,
    )
    items = [_build_bundle_artifact_response(artifact) for artifact in artifacts]
    return ReportBundleArtifactListResponse(items=items, total=len(items))


@router.post("/folder-export", response_model=ReportFolderExportResponse)
async def export_project_report_folder(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
):
    report = await _ensure_project_report(db, project)
    folder_export = await ReportBundleService(db).export_bundle_folder(
        project=project,
        report=report,
    )
    return ReportFolderExportResponse(
        path=folder_export.path,
        files=folder_export.files,
        file_count=folder_export.file_count,
        manifest=folder_export.manifest,
    )


@router.post("/notes-sync", response_model=ReportNotesSyncResponse)
async def sync_project_report_to_notes(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
    current_user=Depends(get_current_user),
):
    report = await _ensure_project_report(db, project)
    notes_sync = await ReportBundleService(db).sync_bundle_to_notes(
        project=project,
        report=report,
        user_id=current_user.id,
    )
    return ReportNotesSyncResponse(
        source_id=notes_sync.source_id,
        source_name=notes_sync.source_name,
        source_path=notes_sync.source_path,
        doc_id=notes_sync.doc_id,
        doc_path=notes_sync.doc_path,
        report_revision=notes_sync.report_revision,
        generated_at=notes_sync.generated_at,
        files=notes_sync.files,
        file_count=notes_sync.file_count,
        stats=notes_sync.stats,
    )


@router.get("/notes-sync", response_model=ReportNotesSyncStatusResponse)
async def get_project_report_notes_sync_status(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
    current_user=Depends(get_current_user),
):
    notes_sync = await ReportBundleService(db).get_existing_notes_sync(
        project=project,
        user_id=current_user.id,
    )
    if notes_sync is None:
        return ReportNotesSyncStatusResponse(sync=None)

    return ReportNotesSyncStatusResponse(
        sync=ReportNotesSyncResponse(
            source_id=notes_sync.source_id,
            source_name=notes_sync.source_name,
            source_path=notes_sync.source_path,
            doc_id=notes_sync.doc_id,
            doc_path=notes_sync.doc_path,
            report_revision=notes_sync.report_revision,
            generated_at=notes_sync.generated_at,
            files=notes_sync.files,
            file_count=notes_sync.file_count,
            stats=notes_sync.stats,
        )
    )


@router.get("/notes-sync/diff", response_model=ReportNotesSyncDiffResponse)
async def get_project_report_notes_sync_diff(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
    current_user=Depends(get_current_user),
):
    report = await _ensure_project_report(db, project)
    notes_diff = await ReportBundleService(db).get_notes_sync_diff(
        project=project,
        report=report,
        user_id=current_user.id,
    )
    if notes_diff is None:
        raise HTTPException(status_code=404, detail="Report notes sync not found")

    return ReportNotesSyncDiffResponse(
        changed=notes_diff.changed,
        synced_report_revision=notes_diff.synced_report_revision,
        current_report_revision=notes_diff.current_report_revision,
        diff_text=notes_diff.diff_text,
    )


@router.get("/bundle/artifacts/compare", response_model=ReportBundleArtifactCompareResponse)
async def compare_project_report_bundle_artifacts(
    project_id: str,
    base_artifact_id: str,
    target_artifact_id: str,
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
):
    report = await _ensure_project_report(db, project)
    comparison = await ReportBundleService(db).compare_bundle_artifacts(
        project_id=project.id,
        report_id=report.id,
        base_artifact_id=base_artifact_id,
        target_artifact_id=target_artifact_id,
    )
    if comparison is None:
        raise HTTPException(status_code=404, detail="Report artifact not found")
    return _build_bundle_artifact_compare_response(comparison)


@router.get("/bundle/artifacts/{artifact_id}/download")
async def download_project_report_bundle_artifact(
    project_id: str,
    artifact_id: str,
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
):
    report = await _ensure_project_report(db, project)
    artifact = await ReportBundleService(db).get_bundle_artifact(
        project_id=project.id,
        report_id=report.id,
        artifact_id=artifact_id,
    )
    if artifact is None:
        raise HTTPException(status_code=404, detail="Report artifact not found")

    return Response(
        content=artifact.content,
        media_type=artifact.content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{artifact.filename}"',
        },
    )


@router.get("/bundle/artifacts/{artifact_id}/graph.svg")
async def preview_project_report_bundle_artifact_graph(
    project_id: str,
    artifact_id: str,
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
):
    report = await _ensure_project_report(db, project)
    graph_svg = await ReportBundleService(db).get_bundle_artifact_graph_svg(
        project_id=project.id,
        report_id=report.id,
        artifact_id=artifact_id,
    )
    if graph_svg is None:
        raise HTTPException(status_code=404, detail="Report artifact not found")

    return Response(content=graph_svg, media_type="image/svg+xml")


@router.get("/bundle/artifacts/{artifact_id}/graph.png")
async def download_project_report_bundle_artifact_graph_png(
    project_id: str,
    artifact_id: str,
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
):
    report = await _ensure_project_report(db, project)
    graph_png = await ReportBundleService(db).get_bundle_artifact_graph_png(
        project_id=project.id,
        report_id=report.id,
        artifact_id=artifact_id,
    )
    if graph_png is None:
        raise HTTPException(status_code=404, detail="Report artifact not found")

    return Response(
        content=graph_png,
        media_type="image/png",
        headers={
            "Content-Disposition": 'attachment; filename="attack-graph.png"',
        },
    )


@router.post("/proposals", response_model=ReportProposalCreateResponse, status_code=201)
async def create_project_report_proposal(
    project_id: str,
    payload: ReportManualProposalRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
):
    report = await _ensure_project_report(db, project)
    existing_proposal = await _find_existing_evidence_proposal(
        db,
        report_id=report.id,
        evidence=[
            (item.source_type, item.source_id)
            for item in payload.evidence
        ],
    )
    if existing_proposal is not None:
        response.status_code = 200
        return ReportProposalCreateResponse(
            proposal=await _build_proposal_response(db, report, existing_proposal),
            duplicate=True,
        )

    section = await _resolve_report_section(
        db,
        report_id=report.id,
        section_key=payload.section_key,
        section_hint=payload.section_hint,
    )
    proposal = await ReportService(db).create_manual_proposal(
        report.id,
        [
            {
                "section_key": section.key,
                "content_md": _append_section_content(section.content_md, payload.content_md),
                "summary": payload.summary or f"Add evidence to {section.title}",
                "evidence": [item.model_dump() for item in payload.evidence],
            }
        ],
        trigger_type=payload.trigger_type,
    )
    refreshed_report = await _get_report(db, report.id)
    return ReportProposalCreateResponse(
        proposal=await _build_proposal_response(db, refreshed_report, proposal),
        duplicate=False,
    )


@router.post("/evaluate", response_model=ReportEvaluationTaskResponse, status_code=202)
async def evaluate_project_report(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
    current_user=Depends(get_current_user),
):
    await _ensure_project_report(db, project)
    task = await report_evaluation_task_manager.submit(
        project_id=project_id,
        user_id=current_user.id,
        trigger_type="manual",
    )
    return _build_evaluation_task_response(task)


@router.post("/sections/{section_key}/evaluate", response_model=ReportEvaluationTaskResponse, status_code=202)
async def evaluate_project_report_section(
    project_id: str,
    section_key: str,
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
    current_user=Depends(get_current_user),
):
    report = await _ensure_project_report(db, project)
    await _ensure_report_section_exists(db, report.id, section_key)
    task = await report_evaluation_task_manager.submit(
        project_id=project_id,
        user_id=current_user.id,
        trigger_type="manual",
        target_section_keys=[section_key],
    )
    return _build_evaluation_task_response(task)


@router.get("/evaluate/{task_id}", response_model=ReportEvaluationTaskResponse)
async def get_project_report_evaluation_task(
    project_id: str,
    task_id: str,
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
):
    await _ensure_project_report(db, project)
    task = await report_evaluation_task_manager.get_task(task_id)
    if task is None or task.project_id != project_id:
        raise HTTPException(status_code=404, detail="Report evaluation task not found")
    return _build_evaluation_task_response(task)


@router.post("/proposals/{proposal_id}/accept", response_model=ReportProposalActionResponse)
async def accept_project_report_proposal(
    project_id: str,
    proposal_id: str,
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
):
    report = await _ensure_project_report(db, project)
    await ReportService(db).accept_proposal(
        report_id=report.id,
        proposal_id=proposal_id,
        workspace_path=project.workspace_path,
    )
    refreshed_report = await _get_report(db, report.id)
    proposal = await _get_proposal(db, report.id, proposal_id)
    return ReportProposalActionResponse(
        report=await _build_report_response(db, refreshed_report),
        proposal=await _build_proposal_response(db, refreshed_report, proposal),
    )


@router.post("/proposals/{proposal_id}/reject", response_model=ReportProposalActionResponse)
async def reject_project_report_proposal(
    project_id: str,
    proposal_id: str,
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
):
    report = await _ensure_project_report(db, project)
    await ReportService(db).reject_proposal(report_id=report.id, proposal_id=proposal_id)
    refreshed_report = await _get_report(db, report.id)
    proposal = await _get_proposal(db, report.id, proposal_id)
    return ReportProposalActionResponse(
        report=await _build_report_response(db, refreshed_report),
        proposal=await _build_proposal_response(db, refreshed_report, proposal),
    )


@router.post("/mock-seed/demo-ctf", response_model=ReportMockSeedResponse)
async def mock_seed_project_report_demo_ctf(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
    current_user=Depends(get_current_user),
):
    result = await ReportMockSeedService(db).seed_demo_ctf(
        project,
        user_id=current_user.id,
    )
    refreshed_report = await _get_report(db, result.report.id)
    pending_proposals = [
        await _build_proposal_response(db, refreshed_report, proposal)
        for proposal in result.pending_proposals
    ]
    return ReportMockSeedResponse(
        project_id=project_id,
        scenario=result.scenario,
        accepted_revision_count=result.accepted_revision_count,
        report=await _build_report_response(db, refreshed_report),
        pending_proposals=pending_proposals,
    )


async def _ensure_project_report(db: AsyncSession, project: Project) -> ReportDB:
    service = ReportService(db)
    report = await service.ensure_report(project.id, project.name)
    await service.seed_default_sections(report.id)
    return report


async def _get_report(db: AsyncSession, report_id: str) -> ReportDB:
    report = await db.get(ReportDB, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return report


async def _ensure_report_section_exists(
    db: AsyncSession,
    report_id: str,
    section_key: str,
) -> None:
    result = await db.execute(
        select(ReportSectionDB.id).where(
            ReportSectionDB.report_id == report_id,
            ReportSectionDB.key == section_key,
        )
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Report section not found")


async def _find_existing_evidence_proposal(
    db: AsyncSession,
    report_id: str,
    evidence: list[tuple[str, str]],
) -> ReportUpdateProposalDB | None:
    if not evidence:
        return None

    evidence_conditions = [
        and_(
            ReportEvidenceLinkDB.source_type == source_type,
            ReportEvidenceLinkDB.source_id == source_id,
        )
        for source_type, source_id in evidence
    ]
    result = await db.execute(
        select(ReportUpdateProposalDB)
        .join(
            ReportEvidenceLinkDB,
            ReportEvidenceLinkDB.proposal_id == ReportUpdateProposalDB.id,
        )
        .where(
            ReportUpdateProposalDB.report_id == report_id,
            ReportUpdateProposalDB.status.in_(("pending", "accepted")),
            or_(*evidence_conditions),
        )
        .order_by(ReportUpdateProposalDB.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _load_used_evidence_links(
    db: AsyncSession,
    report_id: str,
) -> list[tuple[ReportEvidenceLinkDB, ReportUpdateProposalDB]]:
    result = await db.execute(
        select(ReportEvidenceLinkDB, ReportUpdateProposalDB)
        .join(
            ReportUpdateProposalDB,
            ReportUpdateProposalDB.id == ReportEvidenceLinkDB.proposal_id,
        )
        .where(
            ReportUpdateProposalDB.report_id == report_id,
            ReportUpdateProposalDB.status.in_(("pending", "accepted")),
        )
        .order_by(ReportEvidenceLinkDB.created_at.asc(), ReportEvidenceLinkDB.id.asc())
    )
    return list(result.all())


async def _resolve_report_section(
    db: AsyncSession,
    report_id: str,
    section_key: str | None,
    section_hint: str | None,
) -> ReportSectionDB:
    sections = await _load_sections(db, report_id)
    sections_by_key = {section.key: section for section in sections}

    if section_key:
        section = sections_by_key.get(section_key)
        if section:
            return section

    normalized_hint = (section_hint or "").strip().lower()
    for candidate_key in SECTION_HINT_ALIASES.get(normalized_hint, ()):
        section = sections_by_key.get(candidate_key)
        if section:
            return section

    if section_key:
        raise HTTPException(status_code=404, detail="Report section not found")
    raise HTTPException(status_code=400, detail="Report section hint is required")


def _append_section_content(current_content: str, content_to_append: str) -> str:
    current = current_content.strip()
    next_content = content_to_append.strip()
    if not current:
        return next_content
    return f"{current}\n\n{next_content}"


async def _get_proposal(
    db: AsyncSession, report_id: str, proposal_id: str
) -> ReportUpdateProposalDB:
    result = await db.execute(
        select(ReportUpdateProposalDB).where(
            ReportUpdateProposalDB.id == proposal_id,
            ReportUpdateProposalDB.report_id == report_id,
        )
    )
    proposal = result.scalar_one_or_none()
    if proposal is None:
        raise HTTPException(status_code=404, detail="Report proposal not found")
    return proposal


async def _load_sections(db: AsyncSession, report_id: str) -> list[ReportSectionDB]:
    result = await db.execute(
        select(ReportSectionDB)
        .where(ReportSectionDB.report_id == report_id)
        .order_by(ReportSectionDB.position.asc())
    )
    return list(result.scalars().all())


async def _load_proposals(
    db: AsyncSession, report_id: str, status: str | None
) -> list[ReportUpdateProposalDB]:
    stmt = select(ReportUpdateProposalDB).where(ReportUpdateProposalDB.report_id == report_id)
    if status:
        stmt = stmt.where(ReportUpdateProposalDB.status == status)
    stmt = stmt.order_by(
        ReportUpdateProposalDB.created_at.desc(),
        ReportUpdateProposalDB.id.desc(),
    )
    return list((await db.execute(stmt)).scalars().all())


async def _load_patches(
    db: AsyncSession, proposal_id: str
) -> list[ReportUpdateSectionPatchDB]:
    result = await db.execute(
        select(ReportUpdateSectionPatchDB)
        .where(ReportUpdateSectionPatchDB.proposal_id == proposal_id)
        .order_by(ReportUpdateSectionPatchDB.created_at.asc())
    )
    return list(result.scalars().all())


async def _load_evidence_links(
    db: AsyncSession, proposal_id: str
) -> list[ReportEvidenceLinkDB]:
    result = await db.execute(
        select(ReportEvidenceLinkDB)
        .where(ReportEvidenceLinkDB.proposal_id == proposal_id)
        .order_by(ReportEvidenceLinkDB.created_at.asc())
    )
    return list(result.scalars().all())


async def _build_report_response(db: AsyncSession, report: ReportDB) -> ReportResponse:
    sections = await _load_sections(db, report.id)
    return ReportResponse(
        id=report.id,
        project_id=report.project_id,
        title=report.title,
        profile=report.profile,
        markdown_path=report.markdown_path,
        current_revision=report.current_revision,
        last_evaluated_at=report.last_evaluated_at,
        last_accepted_at=report.last_accepted_at,
        created_at=report.created_at,
        updated_at=report.updated_at,
        sections=[
            ReportSectionResponse(
                id=section.id,
                key=section.key,
                title=section.title,
                content_md=section.content_md,
                position=section.position,
                updated_at=section.updated_at,
            )
            for section in sections
        ],
    )


def _build_bundle_artifact_response(
    artifact: ReportArtifactDB,
) -> ReportBundleArtifactResponse:
    return ReportBundleArtifactResponse(
        id=artifact.id,
        project_id=artifact.project_id,
        report_id=artifact.report_id,
        filename=artifact.filename,
        content_type=artifact.content_type,
        size_bytes=artifact.size_bytes,
        sha256=artifact.sha256,
        report_revision=artifact.report_revision,
        graph_node_count=artifact.graph_node_count,
        graph_edge_count=artifact.graph_edge_count,
        accepted_command_count=artifact.accepted_command_count,
        accepted_command_ids=list(artifact.accepted_command_ids or []),
        created_at=artifact.created_at,
    )


def _build_bundle_artifact_compare_response(
    comparison,
) -> ReportBundleArtifactCompareResponse:
    return ReportBundleArtifactCompareResponse(
        base=_build_bundle_artifact_response(comparison.base),
        target=_build_bundle_artifact_response(comparison.target),
        report_diff=ReportBundleArtifactReportDiffResponse(
            changed=comparison.report_changed,
            diff_text=comparison.report_diff_text,
        ),
        commands=ReportBundleArtifactCommandDeltaResponse(
            added_ids=comparison.added_command_ids,
            removed_ids=comparison.removed_command_ids,
            unchanged_ids=comparison.unchanged_command_ids,
        ),
        graph=ReportBundleArtifactGraphDeltaResponse(
            added_node_ids=comparison.added_node_ids,
            removed_node_ids=comparison.removed_node_ids,
            added_nodes=comparison.added_nodes,
            removed_nodes=comparison.removed_nodes,
            added_edge_ids=comparison.added_edge_ids,
            removed_edge_ids=comparison.removed_edge_ids,
            added_edges=comparison.added_edges,
            removed_edges=comparison.removed_edges,
        ),
        summary=ReportBundleArtifactCompareSummaryResponse(
            added_commands=len(comparison.added_command_ids),
            removed_commands=len(comparison.removed_command_ids),
            added_nodes=len(comparison.added_node_ids),
            removed_nodes=len(comparison.removed_node_ids),
            added_edges=len(comparison.added_edge_ids),
            removed_edges=len(comparison.removed_edge_ids),
            report_changed=comparison.report_changed,
        ),
    )


def _build_evaluation_task_response(
    task: ReportEvaluationTask,
) -> ReportEvaluationTaskResponse:
    return ReportEvaluationTaskResponse(
        task_id=task.task_id,
        project_id=task.project_id,
        trigger_type=task.trigger_type,
        target_section_keys=task.target_section_keys,
        status=task.status,
        proposal_id=task.proposal_id,
        error=task.error,
        created_at=task.created_at,
        started_at=task.started_at,
        completed_at=task.completed_at,
    )


async def _build_proposal_response(
    db: AsyncSession,
    report: ReportDB,
    proposal: ReportUpdateProposalDB,
) -> ReportProposalResponse:
    sections = await _load_sections(db, report.id)
    section_map = {section.key: section for section in sections}
    patches = await _load_patches(db, proposal.id)
    evidence_links = await _load_evidence_links(db, proposal.id)
    resolved_evidence_links = await ReportEvidenceService(db).resolve_for_project(
        project_id=report.project_id,
        evidence_links=evidence_links,
    )
    response_evidence_links = [
        ReportEvidenceLinkResponse(
            id=link.id,
            patch_id=link.patch_id,
            source_type=link.source_type,
            source_id=link.source_id,
            label=link.label,
            preview=link.preview,
            href=link.href,
            created_at=link.created_at,
        )
        for link in resolved_evidence_links
    ]
    evidence_by_patch: dict[str | None, list[ReportEvidenceLinkResponse]] = defaultdict(list)
    for link in response_evidence_links:
        evidence_by_patch[link.patch_id].append(link)

    return ReportProposalResponse(
        id=proposal.id,
        report_id=proposal.report_id,
        trigger_type=proposal.trigger_type,
        status=proposal.status,
        summary=proposal.summary,
        created_at=proposal.created_at,
        updated_at=proposal.updated_at,
        resolved_at=proposal.resolved_at,
        evidence_links=response_evidence_links,
        section_patches=[
            ReportProposalSectionPatchResponse(
                id=patch.id,
                section_key=patch.section_key,
                section_title=section_map.get(patch.section_key).title
                if section_map.get(patch.section_key)
                else patch.section_key.replace("_", " ").title(),
                summary=patch.summary,
                current_content_md=section_map.get(patch.section_key).content_md
                if section_map.get(patch.section_key)
                else "",
                content_md=patch.content_md,
                diff_text=_build_diff(
                    (
                        section_map.get(patch.section_key).content_md
                        if section_map.get(patch.section_key)
                        else ""
                    ),
                    patch.content_md,
                    patch.section_key,
                ),
                created_at=patch.created_at,
                evidence_links=list(evidence_by_patch.get(patch.id, [])),
            )
            for patch in patches
        ],
    )


def _build_diff(current_content: str, proposed_content: str, section_key: str) -> str:
    diff = list(
        unified_diff(
            current_content.splitlines(),
            proposed_content.splitlines(),
            fromfile=f"{section_key}:current",
            tofile=f"{section_key}:proposed",
            lineterm="",
        )
    )
    return "\n".join(diff)
