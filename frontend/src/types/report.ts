import type {
  AttackGraphEdge,
  AttackGraphNode,
} from "@/features/attack-graph/types";

export interface ReportEvidenceLink {
  id: string;
  patchId: string | null;
  sourceType: string;
  sourceId: string;
  label: string | null;
  preview: string | null;
  href: string | null;
  createdAt: string;
}

export interface ReportSection {
  id: string;
  key: string;
  title: string;
  contentMd: string;
  position: number;
  updatedAt: string;
}

export interface Report {
  id: string;
  projectId: string;
  title: string;
  profile: string;
  markdownPath: string | null;
  currentRevision: number;
  lastEvaluatedAt: string | null;
  lastAcceptedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sections: ReportSection[];
}

export interface ReportProposalSectionPatch {
  id: string;
  sectionKey: string;
  sectionTitle: string;
  summary: string | null;
  currentContentMd: string;
  contentMd: string;
  diffText: string;
  createdAt: string;
  evidenceLinks: ReportEvidenceLink[];
}

export interface ReportProposal {
  id: string;
  reportId: string;
  triggerType: string;
  status: string;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  sectionPatches: ReportProposalSectionPatch[];
  evidenceLinks: ReportEvidenceLink[];
}

export interface ReportProposalListResponse {
  items: ReportProposal[];
  total: number;
}

export interface ReportProposalEvidenceInput {
  sourceType: string;
  sourceId: string;
}

export interface CreateReportProposalPayload {
  sectionKey?: string | null;
  sectionHint?: string | null;
  contentMd: string;
  summary?: string | null;
  triggerType?: string;
  evidence?: ReportProposalEvidenceInput[];
}

export interface CreateReportProposalResponse {
  proposal: ReportProposal;
  duplicate: boolean;
}

export interface ReportEvidenceUsageItem {
  id: string;
  proposalId: string;
  proposalStatus: string;
  patchId: string | null;
  sourceType: string;
  sourceId: string;
  createdAt: string;
}

export interface ReportEvidenceUsageListResponse {
  items: ReportEvidenceUsageItem[];
  total: number;
}

export interface ReportBundleArtifact {
  id: string;
  projectId: string;
  reportId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  reportRevision: number;
  graphNodeCount: number;
  graphEdgeCount: number;
  acceptedCommandCount: number;
  acceptedCommandIds: string[];
  createdAt: string;
}

export interface ReportBundleArtifactListResponse {
  items: ReportBundleArtifact[];
  total: number;
}

export interface ReportFolderExportResponse {
  path: string;
  files: Record<string, string>;
  fileCount: number;
  manifest: Record<string, unknown>;
}

export interface ReportNotesSyncResponse {
  sourceId: string;
  sourceName: string;
  sourcePath: string;
  docId: string | null;
  docPath: string;
  reportRevision: number | null;
  generatedAt: string | null;
  files: Record<string, string>;
  fileCount: number;
  stats: Record<string, unknown>;
}

export interface ReportNotesSyncDiffResponse {
  changed: boolean;
  syncedReportRevision: number | null;
  currentReportRevision: number;
  diffText: string;
}

export interface ReportBundleArtifactReportDiff {
  changed: boolean;
  diffText: string;
}

export interface ReportBundleArtifactCommandDelta {
  addedIds: string[];
  removedIds: string[];
  unchangedIds: string[];
}

export interface ReportBundleArtifactGraphDelta {
  addedNodeIds: string[];
  removedNodeIds: string[];
  addedEdgeIds: string[];
  removedEdgeIds: string[];
  addedNodes: AttackGraphNode[];
  removedNodes: AttackGraphNode[];
  addedEdges: AttackGraphEdge[];
  removedEdges: AttackGraphEdge[];
}

export interface ReportBundleArtifactCompareSummary {
  addedCommands: number;
  removedCommands: number;
  addedNodes: number;
  removedNodes: number;
  addedEdges: number;
  removedEdges: number;
  reportChanged: boolean;
}

export interface ReportBundleArtifactCompareResponse {
  base: ReportBundleArtifact;
  target: ReportBundleArtifact;
  reportDiff: ReportBundleArtifactReportDiff;
  commands: ReportBundleArtifactCommandDelta;
  graph: ReportBundleArtifactGraphDelta;
  summary: ReportBundleArtifactCompareSummary;
}

export interface ReportEvidenceUsageTarget {
  projectId: string;
  commandId: string;
  proposalId: string;
  proposalStatus: string;
  patchId: string | null;
}

export interface ReportEvaluationTask {
  taskId: string;
  projectId: string;
  triggerType: string;
  targetSectionKeys: string[] | null;
  status: string;
  proposalId: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ReportProposalActionResponse {
  report: Report;
  proposal: ReportProposal;
}

export interface ReportMockSeedResponse {
  projectId: string;
  scenario: string;
  acceptedRevisionCount: number;
  report: Report;
  pendingProposals: ReportProposal[];
}
