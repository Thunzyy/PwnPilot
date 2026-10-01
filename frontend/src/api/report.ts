import { api } from "@/api/client";
import type {
  Report,
  CreateReportProposalPayload,
  CreateReportProposalResponse,
  ReportBundleArtifact,
  ReportBundleArtifactCompareResponse,
  ReportBundleArtifactListResponse,
  ReportEvidenceUsageListResponse,
  ReportEvaluationTask,
  ReportFolderExportResponse,
  ReportMockSeedResponse,
  ReportNotesSyncDiffResponse,
  ReportNotesSyncResponse,
  ReportProposal,
  ReportProposalActionResponse,
  ReportProposalListResponse,
} from "@/types/report";
import type {
  AttackGraphEdge,
  AttackGraphNode,
} from "@/features/attack-graph/types";

interface RawReportEvidenceLink {
  id: string;
  patch_id?: string | null;
  source_type: string;
  source_id: string;
  label?: string | null;
  preview?: string | null;
  href?: string | null;
  created_at: string;
}

interface RawReportSection {
  id: string;
  key: string;
  title: string;
  content_md: string;
  position: number;
  updated_at: string;
}

interface RawReport {
  id: string;
  project_id: string;
  title: string;
  profile: string;
  markdown_path?: string | null;
  current_revision: number;
  last_evaluated_at?: string | null;
  last_accepted_at?: string | null;
  created_at: string;
  updated_at: string;
  sections: RawReportSection[];
}

interface RawReportProposalSectionPatch {
  id: string;
  section_key: string;
  section_title: string;
  summary?: string | null;
  current_content_md: string;
  content_md: string;
  diff_text: string;
  created_at: string;
  evidence_links: RawReportEvidenceLink[];
}

interface RawReportProposal {
  id: string;
  report_id: string;
  trigger_type: string;
  status: string;
  summary?: string | null;
  created_at: string;
  updated_at: string;
  resolved_at?: string | null;
  section_patches: RawReportProposalSectionPatch[];
  evidence_links: RawReportEvidenceLink[];
}

interface RawReportProposalListResponse {
  items: RawReportProposal[];
  total: number;
}

interface RawReportProposalCreateResponse {
  proposal: RawReportProposal;
  duplicate: boolean;
}

interface RawReportEvidenceUsageItem {
  id: string;
  proposal_id: string;
  proposal_status: string;
  patch_id?: string | null;
  source_type: string;
  source_id: string;
  created_at: string;
}

interface RawReportEvidenceUsageListResponse {
  items: RawReportEvidenceUsageItem[];
  total: number;
}

interface RawReportBundleArtifact {
  id: string;
  project_id: string;
  report_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  report_revision: number;
  graph_node_count: number;
  graph_edge_count: number;
  accepted_command_count: number;
  accepted_command_ids: string[];
  created_at: string;
}

interface RawReportBundleArtifactListResponse {
  items: RawReportBundleArtifact[];
  total: number;
}

interface RawReportFolderExportResponse {
  path: string;
  files: Record<string, string>;
  file_count: number;
  manifest: Record<string, unknown>;
}

interface RawReportNotesSyncResponse {
  source_id: string;
  source_name: string;
  source_path: string;
  doc_id?: string | null;
  doc_path: string;
  report_revision?: number | null;
  generated_at?: string | null;
  files: Record<string, string>;
  file_count: number;
  stats: Record<string, unknown>;
}

interface RawReportNotesSyncStatusResponse {
  sync?: RawReportNotesSyncResponse | null;
}

interface RawReportNotesSyncDiffResponse {
  changed: boolean;
  synced_report_revision?: number | null;
  current_report_revision: number;
  diff_text: string;
}

interface RawAttackGraphNode {
  id: string;
  project_id: string;
  type: AttackGraphNode["type"];
  label: string;
  created_at: string;
  updated_at: string;
  created_by: AttackGraphNode["createdBy"];
  confidence: number;
  source_step_ids?: string[];
  tags?: string[];
  notes?: string | null;
  position?: { x: number; y: number } | null;
  meta?: Record<string, unknown>;
}

interface RawAttackGraphEdge {
  id: string;
  project_id: string;
  source_id: string;
  target_id: string;
  kind: AttackGraphEdge["kind"];
  source_step_id?: string | null;
  command?: string | null;
  tool?: string | null;
  created_at: string;
  confidence: number;
  label?: string | null;
  meta?: Record<string, unknown>;
}

interface RawReportBundleArtifactCompareResponse {
  base: RawReportBundleArtifact;
  target: RawReportBundleArtifact;
  report_diff: {
    changed: boolean;
    diff_text: string;
  };
  commands: {
    added_ids: string[];
    removed_ids: string[];
    unchanged_ids: string[];
  };
  graph: {
    added_node_ids: string[];
    removed_node_ids: string[];
    added_edge_ids: string[];
    removed_edge_ids: string[];
    added_nodes?: RawAttackGraphNode[];
    removed_nodes?: RawAttackGraphNode[];
    added_edges?: RawAttackGraphEdge[];
    removed_edges?: RawAttackGraphEdge[];
  };
  summary: {
    added_commands: number;
    removed_commands: number;
    added_nodes: number;
    removed_nodes: number;
    added_edges: number;
    removed_edges: number;
    report_changed: boolean;
  };
}

interface RawReportEvaluationTask {
  task_id: string;
  project_id: string;
  trigger_type: string;
  target_section_keys?: string[] | null;
  status: string;
  proposal_id?: string | null;
  error?: string | null;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
}

interface RawReportProposalActionResponse {
  report: RawReport;
  proposal: RawReportProposal;
}

interface RawReportMockSeedResponse {
  project_id: string;
  scenario: string;
  accepted_revision_count: number;
  report: RawReport;
  pending_proposals: RawReportProposal[];
}

export const reportQueryKeys = {
  detail: (projectId: string) => ["report", projectId] as const,
  proposals: (projectId: string) => ["report", projectId, "proposals"] as const,
  evidence: (projectId: string) => ["report", projectId, "evidence"] as const,
  artifacts: (projectId: string) => ["report", projectId, "artifacts"] as const,
  artifactGraphPreview: (projectId: string, artifactId: string) =>
    ["report", projectId, "artifact-graph-preview", artifactId] as const,
  artifactComparison: (
    projectId: string,
    baseArtifactId: string,
    targetArtifactId: string,
  ) =>
    [
      "report",
      projectId,
      "artifact-comparison",
      baseArtifactId,
      targetArtifactId,
    ] as const,
  evaluationTask: (projectId: string, taskId: string) =>
    ["report", projectId, "evaluation-task", taskId] as const,
  notesSyncStatus: (projectId: string) =>
    ["report", projectId, "notes-sync-status"] as const,
  notesSyncDiff: (projectId: string) =>
    ["report", projectId, "notes-sync-diff"] as const,
};

const toEvidenceLink = (item: RawReportEvidenceLink) => ({
  id: item.id,
  patchId: item.patch_id ?? null,
  sourceType: item.source_type,
  sourceId: item.source_id,
  label: item.label ?? null,
  preview: item.preview ?? null,
  href: item.href ?? null,
  createdAt: item.created_at,
});

const toSection = (item: RawReportSection) => ({
  id: item.id,
  key: item.key,
  title: item.title,
  contentMd: item.content_md,
  position: item.position,
  updatedAt: item.updated_at,
});

const toReport = (item: RawReport): Report => ({
  id: item.id,
  projectId: item.project_id,
  title: item.title,
  profile: item.profile,
  markdownPath: item.markdown_path ?? null,
  currentRevision: item.current_revision,
  lastEvaluatedAt: item.last_evaluated_at ?? null,
  lastAcceptedAt: item.last_accepted_at ?? null,
  createdAt: item.created_at,
  updatedAt: item.updated_at,
  sections: (item.sections ?? []).map(toSection),
});

const toProposal = (item: RawReportProposal): ReportProposal => ({
  id: item.id,
  reportId: item.report_id,
  triggerType: item.trigger_type,
  status: item.status,
  summary: item.summary ?? null,
  createdAt: item.created_at,
  updatedAt: item.updated_at,
  resolvedAt: item.resolved_at ?? null,
  evidenceLinks: (item.evidence_links ?? []).map(toEvidenceLink),
  sectionPatches: (item.section_patches ?? []).map((patch) => ({
    id: patch.id,
    sectionKey: patch.section_key,
    sectionTitle: patch.section_title,
    summary: patch.summary ?? null,
    currentContentMd: patch.current_content_md,
    contentMd: patch.content_md,
    diffText: patch.diff_text,
    createdAt: patch.created_at,
    evidenceLinks: (patch.evidence_links ?? []).map(toEvidenceLink),
  })),
});

const toEvidenceUsageItem = (item: RawReportEvidenceUsageItem) => ({
  id: item.id,
  proposalId: item.proposal_id,
  proposalStatus: item.proposal_status,
  patchId: item.patch_id ?? null,
  sourceType: item.source_type,
  sourceId: item.source_id,
  createdAt: item.created_at,
});

const toBundleArtifact = (item: RawReportBundleArtifact): ReportBundleArtifact => ({
  id: item.id,
  projectId: item.project_id,
  reportId: item.report_id,
  filename: item.filename,
  contentType: item.content_type,
  sizeBytes: item.size_bytes,
  sha256: item.sha256,
  reportRevision: item.report_revision,
  graphNodeCount: item.graph_node_count,
  graphEdgeCount: item.graph_edge_count,
  acceptedCommandCount: item.accepted_command_count,
  acceptedCommandIds: item.accepted_command_ids ?? [],
  createdAt: item.created_at,
});

function toReportFolderFileKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
}

const toReportFolderExport = (
  item: RawReportFolderExportResponse,
): ReportFolderExportResponse => ({
  path: item.path,
  files: Object.fromEntries(
    Object.entries(item.files ?? {}).map(([key, value]) => [
      toReportFolderFileKey(key),
      value,
    ]),
  ),
  fileCount: item.file_count,
  manifest: item.manifest ?? {},
});

const toReportNotesSync = (
  item: RawReportNotesSyncResponse,
): ReportNotesSyncResponse => ({
  sourceId: item.source_id,
  sourceName: item.source_name,
  sourcePath: item.source_path,
  docId: item.doc_id ?? null,
  docPath: item.doc_path,
  reportRevision: item.report_revision ?? null,
  generatedAt: item.generated_at ?? null,
  files: Object.fromEntries(
    Object.entries(item.files ?? {}).map(([key, value]) => [
      toReportFolderFileKey(key),
      value,
    ]),
  ),
  fileCount: item.file_count,
  stats: item.stats ?? {},
});

const toReportNotesSyncDiff = (
  item: RawReportNotesSyncDiffResponse,
): ReportNotesSyncDiffResponse => ({
  changed: item.changed,
  syncedReportRevision: item.synced_report_revision ?? null,
  currentReportRevision: item.current_report_revision,
  diffText: item.diff_text,
});

const toGraphNode = (node: RawAttackGraphNode): AttackGraphNode => ({
  id: node.id,
  projectId: node.project_id,
  type: node.type,
  label: node.label,
  createdAt: node.created_at,
  updatedAt: node.updated_at,
  createdBy: node.created_by,
  confidence: node.confidence,
  sourceStepIds: node.source_step_ids ?? [],
  tags: node.tags ?? [],
  notes: node.notes ?? null,
  position: node.position ?? null,
  meta: node.meta ?? {},
});

const toGraphEdge = (edge: RawAttackGraphEdge): AttackGraphEdge => ({
  id: edge.id,
  projectId: edge.project_id,
  sourceId: edge.source_id,
  targetId: edge.target_id,
  kind: edge.kind,
  sourceStepId: edge.source_step_id ?? null,
  command: edge.command ?? null,
  tool: edge.tool ?? null,
  createdAt: edge.created_at,
  confidence: edge.confidence,
  label: edge.label ?? null,
  meta: edge.meta ?? {},
});

const toBundleArtifactComparison = (
  item: RawReportBundleArtifactCompareResponse,
): ReportBundleArtifactCompareResponse => ({
  base: toBundleArtifact(item.base),
  target: toBundleArtifact(item.target),
  reportDiff: {
    changed: item.report_diff.changed,
    diffText: item.report_diff.diff_text,
  },
  commands: {
    addedIds: item.commands.added_ids ?? [],
    removedIds: item.commands.removed_ids ?? [],
    unchangedIds: item.commands.unchanged_ids ?? [],
  },
  graph: {
    addedNodeIds: item.graph.added_node_ids ?? [],
    removedNodeIds: item.graph.removed_node_ids ?? [],
    addedEdgeIds: item.graph.added_edge_ids ?? [],
    removedEdgeIds: item.graph.removed_edge_ids ?? [],
    addedNodes: (item.graph.added_nodes ?? []).map(toGraphNode),
    removedNodes: (item.graph.removed_nodes ?? []).map(toGraphNode),
    addedEdges: (item.graph.added_edges ?? []).map(toGraphEdge),
    removedEdges: (item.graph.removed_edges ?? []).map(toGraphEdge),
  },
  summary: {
    addedCommands: item.summary.added_commands,
    removedCommands: item.summary.removed_commands,
    addedNodes: item.summary.added_nodes,
    removedNodes: item.summary.removed_nodes,
    addedEdges: item.summary.added_edges,
    removedEdges: item.summary.removed_edges,
    reportChanged: item.summary.report_changed,
  },
});

const toEvaluationTask = (item: RawReportEvaluationTask): ReportEvaluationTask => ({
  taskId: item.task_id,
  projectId: item.project_id,
  triggerType: item.trigger_type,
  targetSectionKeys: item.target_section_keys ?? null,
  status: item.status,
  proposalId: item.proposal_id ?? null,
  error: item.error ?? null,
  createdAt: item.created_at,
  startedAt: item.started_at ?? null,
  completedAt: item.completed_at ?? null,
});

export async function fetchProjectReport(projectId: string): Promise<Report> {
  const response = await api.get<RawReport>(`/projects/${projectId}/report`);
  return toReport(response.data);
}

export async function downloadReportBundle(projectId: string): Promise<Blob> {
  const response = await api.get<Blob>(`/projects/${projectId}/report/bundle`, {
    responseType: "blob",
  });
  return response.data;
}

export async function exportReportFolder(
  projectId: string,
): Promise<ReportFolderExportResponse> {
  const response = await api.post<RawReportFolderExportResponse>(
    `/projects/${projectId}/report/folder-export`,
  );
  return toReportFolderExport(response.data);
}

export async function syncReportToNotes(
  projectId: string,
): Promise<ReportNotesSyncResponse> {
  const response = await api.post<RawReportNotesSyncResponse>(
    `/projects/${projectId}/report/notes-sync`,
  );
  return toReportNotesSync(response.data);
}

export async function fetchReportNotesSyncStatus(
  projectId: string,
): Promise<ReportNotesSyncResponse | null> {
  const response = await api.get<RawReportNotesSyncStatusResponse>(
    `/projects/${projectId}/report/notes-sync`,
  );
  return response.data.sync ? toReportNotesSync(response.data.sync) : null;
}

export async function fetchReportNotesSyncDiff(
  projectId: string,
): Promise<ReportNotesSyncDiffResponse> {
  const response = await api.get<RawReportNotesSyncDiffResponse>(
    `/projects/${projectId}/report/notes-sync/diff`,
  );
  return toReportNotesSyncDiff(response.data);
}

export async function fetchReportBundleArtifacts(
  projectId: string,
): Promise<ReportBundleArtifactListResponse> {
  const response = await api.get<RawReportBundleArtifactListResponse>(
    `/projects/${projectId}/report/bundle/artifacts`,
  );
  return {
    items: (response.data.items ?? []).map(toBundleArtifact),
    total: response.data.total ?? 0,
  };
}

export async function downloadReportBundleArtifact(
  projectId: string,
  artifactId: string,
): Promise<Blob> {
  const response = await api.get<Blob>(
    `/projects/${projectId}/report/bundle/artifacts/${artifactId}/download`,
    { responseType: "blob" },
  );
  return response.data;
}

export async function fetchReportBundleArtifactGraphSvg(
  projectId: string,
  artifactId: string,
): Promise<string> {
  const response = await api.get<string>(
    `/projects/${projectId}/report/bundle/artifacts/${artifactId}/graph.svg`,
    { responseType: "text" },
  );
  return response.data;
}

export async function downloadReportBundleArtifactGraphPng(
  projectId: string,
  artifactId: string,
): Promise<Blob> {
  const response = await api.get<Blob>(
    `/projects/${projectId}/report/bundle/artifacts/${artifactId}/graph.png`,
    { responseType: "blob" },
  );
  return response.data;
}

export async function compareReportBundleArtifacts(
  projectId: string,
  baseArtifactId: string,
  targetArtifactId: string,
): Promise<ReportBundleArtifactCompareResponse> {
  const response = await api.get<RawReportBundleArtifactCompareResponse>(
    `/projects/${projectId}/report/bundle/artifacts/compare`,
    {
      params: {
        base_artifact_id: baseArtifactId,
        target_artifact_id: targetArtifactId,
      },
    },
  );
  return toBundleArtifactComparison(response.data);
}

export async function fetchReportProposals(projectId: string): Promise<ReportProposalListResponse> {
  const response = await api.get<RawReportProposalListResponse>(
    `/projects/${projectId}/report/proposals`,
  );
  return {
    items: (response.data.items ?? []).map(toProposal),
    total: response.data.total ?? 0,
  };
}

export async function fetchReportEvidenceUsage(
  projectId: string,
): Promise<ReportEvidenceUsageListResponse> {
  const response = await api.get<RawReportEvidenceUsageListResponse>(
    `/projects/${projectId}/report/evidence`,
  );
  return {
    items: (response.data.items ?? []).map(toEvidenceUsageItem),
    total: response.data.total ?? 0,
  };
}

export async function createReportProposal(
  projectId: string,
  payload: CreateReportProposalPayload,
): Promise<CreateReportProposalResponse> {
  const response = await api.post<RawReportProposalCreateResponse>(
    `/projects/${projectId}/report/proposals`,
    {
      section_key: payload.sectionKey ?? null,
      section_hint: payload.sectionHint ?? null,
      content_md: payload.contentMd,
      summary: payload.summary ?? null,
      trigger_type: payload.triggerType ?? "manual",
      evidence: (payload.evidence ?? []).map((item) => ({
        source_type: item.sourceType,
        source_id: item.sourceId,
      })),
    },
  );
  return {
    proposal: toProposal(response.data.proposal),
    duplicate: Boolean(response.data.duplicate),
  };
}

export async function evaluateProjectReport(projectId: string): Promise<ReportEvaluationTask> {
  const response = await api.post<RawReportEvaluationTask>(
    `/projects/${projectId}/report/evaluate`,
  );
  return toEvaluationTask(response.data);
}

export async function evaluateReportSection(
  projectId: string,
  sectionKey: string,
): Promise<ReportEvaluationTask> {
  const response = await api.post<RawReportEvaluationTask>(
    `/projects/${projectId}/report/sections/${sectionKey}/evaluate`,
  );
  return toEvaluationTask(response.data);
}

export async function fetchReportEvaluationTask(
  projectId: string,
  taskId: string,
): Promise<ReportEvaluationTask> {
  const response = await api.get<RawReportEvaluationTask>(
    `/projects/${projectId}/report/evaluate/${taskId}`,
  );
  return toEvaluationTask(response.data);
}

export async function acceptReportProposal(
  projectId: string,
  proposalId: string,
): Promise<ReportProposalActionResponse> {
  const response = await api.post<RawReportProposalActionResponse>(
    `/projects/${projectId}/report/proposals/${proposalId}/accept`,
  );
  return {
    report: toReport(response.data.report),
    proposal: toProposal(response.data.proposal),
  };
}

export async function rejectReportProposal(
  projectId: string,
  proposalId: string,
): Promise<ReportProposalActionResponse> {
  const response = await api.post<RawReportProposalActionResponse>(
    `/projects/${projectId}/report/proposals/${proposalId}/reject`,
  );
  return {
    report: toReport(response.data.report),
    proposal: toProposal(response.data.proposal),
  };
}

export async function seedMockReportDemoCtf(
  projectId: string,
): Promise<ReportMockSeedResponse> {
  const response = await api.post<RawReportMockSeedResponse>(
    `/projects/${projectId}/report/mock-seed/demo-ctf`,
  );
  return {
    projectId: response.data.project_id,
    scenario: response.data.scenario,
    acceptedRevisionCount: response.data.accepted_revision_count,
    report: toReport(response.data.report),
    pendingProposals: (response.data.pending_proposals ?? []).map(toProposal),
  };
}
