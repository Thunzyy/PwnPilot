import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Group, Panel } from "react-resizable-panels";
import { Link, useSearchParams } from "react-router-dom";

import { aiApi } from "@/api/ai";
import { AIQuickSettings } from "@/components/AI/AIQuickSettings";
import { MarkdownViewer } from "@/components/KnowledgeBase/MarkdownViewer/MarkdownViewer";
import { ResizeHandle } from "@/components/KnowledgeBase/ResizeHandle";
import { ReportEvidenceList } from "@/components/Reports/ReportEvidenceList";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getUserFacingErrorMessage } from "@/lib/apiError";
import { cn } from "@/lib/utils";
import {
  acceptReportProposal,
  compareReportBundleArtifacts,
  downloadReportBundle,
  downloadReportBundleArtifact,
  downloadReportBundleArtifactGraphPng,
  evaluateProjectReport,
  evaluateReportSection,
  exportReportFolder,
  fetchReportNotesSyncDiff,
  fetchReportNotesSyncStatus,
  fetchReportBundleArtifactGraphSvg,
  fetchReportBundleArtifacts,
  fetchProjectReport,
  fetchReportEvaluationTask,
  fetchReportProposals,
  rejectReportProposal,
  reportQueryKeys,
  seedMockReportDemoCtf,
  syncReportToNotes,
} from "@/api/report";
import { useProjectStore } from "@/stores/projectStore";
import type {
  Report,
  ReportBundleArtifact,
  ReportBundleArtifactCompareResponse,
  ReportEvaluationTask,
  ReportFolderExportResponse,
  ReportNotesSyncResponse,
  ReportProposal,
  ReportProposalSectionPatch,
  ReportSection,
} from "@/types/report";
import type { KBDocDetail } from "@/types/kb";
import type { AttackGraphComparisonOverlay } from "@/features/attack-graph/types";

const REPORT_PROFILE_LABELS: Record<string, string> = {
  hybrid: "Hybrid",
  htb_writeup: "HTB Write-Up",
  pentest_report: "Pentest Report",
};
const REPORTS_LAST_PROJECT_STORAGE_KEY = "pwnpilot:reports:last-project-id";
const REPORTS_NOTES_AUTO_SYNC_STORAGE_KEY = "pwnpilot:reports:auto-sync-notes";
const REPORTS_NOTES_AUTO_SYNC_DEBOUNCE_MS = 600;
const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";
const REPORT_PREVIEW_HIGHLIGHT_MS = 1600;
const REPORT_PREVIEW_HIGHLIGHT_CLASSES = [
  "report-preview-section-highlight",
  "-mx-1",
  "rounded-md",
  "bg-cyan-400/15",
  "px-1",
  "ring-2",
  "ring-cyan-300/70",
  "transition-colors",
  "duration-500",
];

type NotesDiffLineKind = "added" | "removed" | "context";
type NotesDiffFilter = "all" | "added" | "removed" | "sections";

interface NotesDiffLine {
  kind: NotesDiffLineKind;
  marker: string;
  content: string;
}

interface NotesDiffHunk {
  id: string;
  header: string;
  sectionLabel: string | null;
  additions: number;
  removals: number;
  lines: NotesDiffLine[];
}

interface ActionFeedback {
  title: string;
  message: string;
  hint: string;
}

function InlineActionError({ title, message }: { title: string; message: string }) {
  return (
    <div className="max-w-full rounded-md border border-red-400/20 bg-red-500/10 px-3 py-2 text-left text-xs sm:text-right">
      <p className="font-medium text-red-200">{title}</p>
      <p className="mt-1 break-words text-red-100/85">{message}</p>
    </div>
  );
}

function subscribeToDesktopBreakpoint(onStoreChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }

  const mediaQuery = window.matchMedia(DESKTOP_MEDIA_QUERY);
  mediaQuery.addEventListener("change", onStoreChange);

  return () => {
    mediaQuery.removeEventListener("change", onStoreChange);
  };
}

function getDesktopBreakpointSnapshot(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true;
  }

  return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
}

function getMarkdownSectionLabel(lineContent: string): string | null {
  const headingMatch = lineContent.trim().match(/^#{1,6}\s+(.+)$/);
  return headingMatch?.[1]?.trim() || null;
}

function normalizeMarkdownHeadingLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function parseNotesSyncDiff(diffText: string): NotesDiffHunk[] {
  const hunks: NotesDiffHunk[] = [];
  let activeHunk: NotesDiffHunk | null = null;

  const startHunk = (header: string): NotesDiffHunk => {
    const hunk = {
      id: `hunk-${hunks.length}`,
      header,
      sectionLabel: null,
      additions: 0,
      removals: 0,
      lines: [],
    };
    activeHunk = hunk;
    hunks.push(activeHunk);
    return hunk;
  };

  for (const rawLine of diffText.split("\n")) {
    if (rawLine.startsWith("--- ") || rawLine.startsWith("+++ ")) {
      continue;
    }

    if (rawLine.startsWith("@@")) {
      startHunk(rawLine);
      continue;
    }

    const hunk = activeHunk ?? startHunk("Diff");

    const marker = rawLine[0] ?? " ";
    const content = rawLine.length > 0 ? rawLine.slice(1) : "";
    const sectionLabel = getMarkdownSectionLabel(content);
    if (sectionLabel) {
      hunk.sectionLabel = sectionLabel;
    }

    if (marker === "+") {
      hunk.additions += 1;
      hunk.lines.push({ kind: "added", marker, content });
      continue;
    }

    if (marker === "-") {
      hunk.removals += 1;
      hunk.lines.push({ kind: "removed", marker, content });
      continue;
    }

    hunk.lines.push({ kind: "context", marker: " ", content });
  }

  return hunks.filter((hunk) => hunk.lines.length > 0);
}

function NotesSyncDiffViewer({
  diffText,
  onJumpToSection,
}: {
  diffText: string;
  onJumpToSection?: (sectionLabel: string) => void;
}) {
  const [activeFilter, setActiveFilter] = useState<NotesDiffFilter>("all");
  const diffHunks = useMemo(() => parseNotesSyncDiff(diffText), [diffText]);
  const diffSummary = useMemo(
    () => ({
      all: diffHunks.length,
      added: diffHunks.filter((hunk) => hunk.additions > 0).length,
      removed: diffHunks.filter((hunk) => hunk.removals > 0).length,
      sections: diffHunks.filter((hunk) => hunk.sectionLabel).length,
    }),
    [diffHunks],
  );
  const filteredHunks = useMemo(
    () =>
      diffHunks.filter((hunk) => {
        if (activeFilter === "added") return hunk.additions > 0;
        if (activeFilter === "removed") return hunk.removals > 0;
        if (activeFilter === "sections") return Boolean(hunk.sectionLabel);
        return true;
      }),
    [activeFilter, diffHunks],
  );

  const handleJumpToDiffHunk = (hunkId: string) => {
    document
      .getElementById(`notes-sync-diff-${hunkId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  if (!diffText.trim() || diffHunks.length === 0) {
    return (
      <p className="mt-2 rounded border border-border-dark bg-slate-950/70 p-3 text-xs text-text-secondary">
        No markdown changes.
      </p>
    );
  }

  const filters: Array<{ key: NotesDiffFilter; label: string; count: number }> = [
    { key: "all", label: "All", count: diffSummary.all },
    { key: "added", label: "Added", count: diffSummary.added },
    { key: "removed", label: "Removed", count: diffSummary.removed },
    { key: "sections", label: "Sections", count: diffSummary.sections },
  ];

  return (
    <div className="mt-2 max-h-72 space-y-3 overflow-auto rounded border border-border-dark bg-slate-950/70 p-3">
      <div className="rounded-lg border border-border-dark bg-background-dark/80 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-100/80">
            Diff summary
          </p>
          <div className="flex flex-wrap gap-1.5">
            {filters.map((filter) => (
              <Button
                key={filter.key}
                type="button"
                size="sm"
                variant="ghost"
                aria-pressed={activeFilter === filter.key}
                onClick={() => setActiveFilter(filter.key)}
                className={cn(
                  "h-6 border px-2 text-[10px]",
                  activeFilter === filter.key
                    ? "border-cyan-300/50 bg-cyan-300/15 text-cyan-50"
                    : "border-border-dark text-text-secondary hover:bg-cyan-300/10 hover:text-cyan-50",
                )}
              >
                {filter.label} ({filter.count})
              </Button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {filteredHunks.map((hunk) => (
            <Button
              key={`summary-${hunk.id}`}
              type="button"
              size="sm"
              variant="ghost"
              aria-label={`Jump to diff hunk: ${hunk.sectionLabel ?? hunk.header}`}
              onClick={() => handleJumpToDiffHunk(hunk.id)}
              className="h-6 border border-border-dark px-2 text-[10px] text-text-secondary hover:bg-cyan-300/10 hover:text-cyan-50"
            >
              {hunk.sectionLabel ?? "Unmapped"} +{hunk.additions} / -{hunk.removals}
            </Button>
          ))}
        </div>
      </div>
      {filteredHunks.length === 0 ? (
        <p className="rounded border border-border-dark bg-background-dark/70 p-3 text-xs text-text-secondary">
          No hunks match this filter.
        </p>
      ) : null}
      {filteredHunks.map((hunk) => (
        <section
          key={hunk.id}
          id={`notes-sync-diff-${hunk.id}`}
          className="overflow-hidden rounded-lg border border-border-dark bg-background-dark/70"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-dark px-3 py-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-100/80">
                Section: {hunk.sectionLabel ?? "Unmapped markdown"}
              </p>
              <p className="mt-1 font-mono text-[10px] text-text-secondary">
                {hunk.header}
              </p>
            </div>
            <div className="flex items-center gap-2 text-[11px] font-semibold">
              {hunk.sectionLabel && onJumpToSection ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Jump to preview section: ${hunk.sectionLabel}`}
                  onClick={() => onJumpToSection(hunk.sectionLabel!)}
                  className="h-6 border border-cyan-300/20 px-2 text-[10px] text-cyan-100 hover:bg-cyan-300/10 hover:text-cyan-50"
                >
                  Jump to preview
                </Button>
              ) : null}
              <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-emerald-100">
                +{hunk.additions}
              </span>
              <span className="rounded-full border border-red-400/30 bg-red-400/10 px-2 py-0.5 text-red-100">
                -{hunk.removals}
              </span>
            </div>
          </div>
          <div className="divide-y divide-border-dark/70">
            {hunk.lines.map((line, lineIndex) => (
              <div
                key={`${hunk.id}-${lineIndex}`}
                className={cn(
                  "grid grid-cols-[4.5rem_1rem_minmax(0,1fr)] items-start gap-2 px-3 py-1.5 text-left text-[11px] leading-5",
                  line.kind === "added" &&
                    "border-l-2 border-emerald-400/70 bg-emerald-400/10 text-emerald-50",
                  line.kind === "removed" &&
                    "border-l-2 border-red-400/70 bg-red-400/10 text-red-50",
                  line.kind === "context" && "text-text-secondary",
                )}
              >
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase tracking-[0.12em]",
                    line.kind === "added" && "bg-emerald-400/15 text-emerald-100",
                    line.kind === "removed" && "bg-red-400/15 text-red-100",
                    line.kind === "context" && "bg-slate-800/80 text-slate-300",
                  )}
                >
                  {line.kind === "added"
                    ? "Added"
                    : line.kind === "removed"
                      ? "Removed"
                      : "Context"}
                </span>
                <span className="font-mono text-text-muted">{line.marker}</span>
                <code className="min-w-0 whitespace-pre-wrap break-words font-mono">
                  {line.content || " "}
                </code>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function getServerDesktopBreakpointSnapshot(): boolean {
  return true;
}

function getProjectNotesLink(projectId: string, docId?: string | null): string {
  const basePath = `/projects/${projectId}/notes`;
  const trimmedDocId = docId?.trim();
  if (!trimmedDocId) {
    return basePath;
  }

  return `${basePath}?docId=${encodeURIComponent(trimmedDocId)}`;
}

type PreviewMode = "current" | "proposal";
type ComparisonDeltaKind = "command" | "node" | "edge";
type NotesAutoSyncStatus = "idle" | "scheduled" | "syncing" | "synced" | "failed";

function readNotesAutoSyncPreference(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(REPORTS_NOTES_AUTO_SYNC_STORAGE_KEY) === "enabled";
}

function writeNotesAutoSyncPreference(enabled: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    REPORTS_NOTES_AUTO_SYNC_STORAGE_KEY,
    enabled ? "enabled" : "disabled",
  );
}

function formatReportProfile(profile: string | null | undefined): string {
  if (!profile) {
    return "Hybrid";
  }
  return REPORT_PROFILE_LABELS[profile] ?? profile.replace(/_/g, " ");
}

function sanitizeDownloadName(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "report";
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function pluralizeCount(value: number, label: string): string {
  return `${value} ${label}${value === 1 ? "" : "s"}`;
}

function formatArtifactStats(artifact: ReportBundleArtifact): string {
  return [
    pluralizeCount(artifact.acceptedCommandCount, "command"),
    pluralizeCount(artifact.graphNodeCount, "node"),
    pluralizeCount(artifact.graphEdgeCount, "edge"),
  ].join(" · ");
}

function formatSignedDelta(value: number, label: string): string {
  const sign = value >= 0 ? "+" : "-";
  const absoluteValue = Math.abs(value);
  return `${sign}${absoluteValue} ${label}${absoluteValue === 1 ? "" : "s"}`;
}

function formatComparisonSummary(
  summary: ReportBundleArtifactCompareResponse["summary"],
): string {
  return [
    formatSignedDelta(summary.addedCommands - summary.removedCommands, "command"),
    formatSignedDelta(summary.addedNodes - summary.removedNodes, "node"),
    formatSignedDelta(summary.addedEdges - summary.removedEdges, "edge"),
  ].join(" · ");
}

function getComparisonDeltaHref(
  projectId: string,
  kind: ComparisonDeltaKind,
  id: string,
  comparison?: ReportBundleArtifactCompareResponse | null,
): string {
  const encodedProjectId = encodeURIComponent(projectId);
  const encodedId = encodeURIComponent(id);
  if (kind === "command") {
    return `/projects/${encodedProjectId}/timeline?commandId=${encodedId}`;
  }
  if (comparison) {
    return buildGraphComparisonHref(projectId, comparison, {
      kind,
      id,
    });
  }
  if (kind === "edge") {
    return `/projects/${encodedProjectId}?graphEdgeId=${encodedId}`;
  }
  return `/projects/${encodedProjectId}?graphNodeId=${encodedId}`;
}

function appendIdListSearchParam(
  params: URLSearchParams,
  key: string,
  ids: string[],
): void {
  if (ids.length === 0) return;
  params.set(key, ids.join(","));
}

function buildGraphComparisonOverlay(
  comparison: ReportBundleArtifactCompareResponse,
): AttackGraphComparisonOverlay {
  return {
    source: "report-bundle",
    baseArtifactId: comparison.base.id,
    targetArtifactId: comparison.target.id,
    baseRevision: comparison.base.reportRevision,
    targetRevision: comparison.target.reportRevision,
    addedNodeIds: comparison.graph.addedNodeIds,
    removedNodeIds: comparison.graph.removedNodeIds,
    addedEdgeIds: comparison.graph.addedEdgeIds,
    removedEdgeIds: comparison.graph.removedEdgeIds,
    addedNodes: comparison.graph.addedNodes,
    removedNodes: comparison.graph.removedNodes,
    addedEdges: comparison.graph.addedEdges,
    removedEdges: comparison.graph.removedEdges,
  };
}

function buildGraphComparisonHref(
  projectId: string,
  comparison: ReportBundleArtifactCompareResponse,
  focus?: { kind: Exclude<ComparisonDeltaKind, "command">; id: string },
): string {
  const params = new URLSearchParams();
  const overlay = buildGraphComparisonOverlay(comparison);

  params.set("graphComparison", overlay.source);
  if (overlay.baseArtifactId) {
    params.set("graphBaseArtifactId", overlay.baseArtifactId);
  }
  if (overlay.targetArtifactId) {
    params.set("graphTargetArtifactId", overlay.targetArtifactId);
  }
  if (overlay.baseRevision !== null) {
    params.set("graphBaseRevision", String(overlay.baseRevision));
  }
  if (overlay.targetRevision !== null) {
    params.set("graphTargetRevision", String(overlay.targetRevision));
  }
  appendIdListSearchParam(params, "graphAddedNodeIds", overlay.addedNodeIds);
  appendIdListSearchParam(params, "graphRemovedNodeIds", overlay.removedNodeIds);
  appendIdListSearchParam(params, "graphAddedEdgeIds", overlay.addedEdgeIds);
  appendIdListSearchParam(params, "graphRemovedEdgeIds", overlay.removedEdgeIds);

  if (focus?.kind === "node") {
    params.set("graphNodeId", focus.id);
  }
  if (focus?.kind === "edge") {
    params.set("graphEdgeId", focus.id);
  }

  return `/projects/${encodeURIComponent(projectId)}?${params.toString()}`;
}

function getComparisonDeltaAriaLabel(
  state: "added" | "removed",
  kind: ComparisonDeltaKind,
  id: string,
): string {
  if (kind === "command") {
    return `Open ${state} command ${id} in history`;
  }
  if (kind === "edge") {
    return `Open ${state} graph edge ${id}`;
  }
  return `Open ${state} graph node ${id}`;
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  return `${(sizeBytes / 1024).toFixed(1)} KB`;
}

function graphPngFilename(artifact: ReportBundleArtifact): string {
  return artifact.filename.replace(/\.zip$/i, "") + "-attack-graph.png";
}

function sortSections(sections: ReportSection[]): ReportSection[] {
  return [...sections].sort((left, right) => left.position - right.position);
}

function mergePreviewSections(
  sections: ReportSection[],
  proposal: ReportProposal | null,
  previewMode: PreviewMode,
): ReportSection[] {
  const baseSections = sortSections(sections);
  if (previewMode !== "proposal" || !proposal) {
    return baseSections;
  }

  const byKey = new Map(baseSections.map((section) => [section.key, section]));
  const mergedSections = [...baseSections];

  for (const patch of proposal.sectionPatches) {
    const existing = byKey.get(patch.sectionKey);
    if (existing) {
      const replacement = {
        ...existing,
        title: patch.sectionTitle || existing.title,
        contentMd: patch.contentMd,
      };
      const index = mergedSections.findIndex((section) => section.key === patch.sectionKey);
      mergedSections[index] = replacement;
      byKey.set(patch.sectionKey, replacement);
      continue;
    }

    const appended: ReportSection = {
      id: patch.id,
      key: patch.sectionKey,
      title: patch.sectionTitle,
      contentMd: patch.contentMd,
      position: mergedSections.length,
      updatedAt: patch.createdAt,
    };
    mergedSections.push(appended);
    byKey.set(patch.sectionKey, appended);
  }

  return sortSections(mergedSections);
}

function buildReportMarkdown(title: string, sections: ReportSection[]): string {
  const markdownLines = [`# ${title}`];

  for (const section of sections) {
    markdownLines.push(`## ${section.title}`);
    markdownLines.push(section.contentMd.trim().length > 0 ? section.contentMd : "_No content yet._");
  }

  return markdownLines.join("\n\n");
}

function appendAttackGraphVisualReference(markdown: string): string {
  if (/attack-graph\.svg/i.test(markdown) || /^#{2,6}\s+attack path\s*$/im.test(markdown)) {
    return markdown.trimEnd();
  }

  return `${markdown.trimEnd()}\n\n## Attack Graph\n\n![Attack Graph](attack-graph.svg)`;
}

function buildPreviewDoc(
  report: Report | undefined,
  currentProjectId: string,
  currentProjectName: string,
  markdown: string,
  previewMode: PreviewMode,
  proposalId: string | null,
): KBDocDetail {
  const reportId = report?.id ?? "report-preview";
  return {
    id: `${reportId}-${previewMode}-${proposalId ?? "current"}`,
    source_id: "report-preview",
    title: report?.title ?? currentProjectName,
    relative_path: "report.md",
    tags: null,
    content_hash: null,
    wikilinks: null,
    frontmatter: null,
    created_at: report?.createdAt ?? new Date(0).toISOString(),
    updated_at: report?.updatedAt ?? new Date(0).toISOString(),
    body: markdown,
    backlinks: [],
    source: {
      id: `${reportId}-preview-source`,
      name: `${currentProjectName} Report Preview`,
      source_type: "local",
      origin: null,
      path: report?.markdownPath ?? "report.md",
      remote_url: null,
      read_only: true,
      include_paths: null,
      user_id: "report-preview",
      project_id: currentProjectId,
      sync_status: null,
      opsec_warning: null,
      opsec_acknowledged: true,
      last_synced_at: report?.updatedAt ?? null,
      created_at: report?.createdAt ?? new Date(0).toISOString(),
      updated_at: report?.updatedAt ?? new Date(0).toISOString(),
    },
  };
}

function formatPreviewModeLabel(previewMode: PreviewMode, proposal: ReportProposal | null): string {
  if (previewMode === "proposal" && proposal) {
    return "Previewing selected update";
  }
  return "Previewing current markdown";
}

function ProposalPatchCard({ patch }: { patch: ReportProposalSectionPatch }) {
  return (
    <section className="rounded-lg border border-border-dark/80 bg-background-dark/50 p-4">
      <h4 className="text-sm font-semibold text-text-primary">{patch.sectionTitle}</h4>
      {patch.summary ? (
        <p className="mt-1 text-sm text-text-secondary">{patch.summary}</p>
      ) : null}

      <div className="mt-4 space-y-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
            Markdown Preview
          </p>
          <p className="mt-2 text-sm text-text-secondary">
            Rendered in the main preview pane for the full report context.
          </p>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
            Markdown Source
          </p>
          <pre className="mt-2 min-w-0 whitespace-pre-wrap break-words rounded-md border border-border-dark bg-card-dark/80 p-3 text-sm leading-6 text-text-primary">
            {patch.contentMd || "No markdown proposed."}
          </pre>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
            Exact Diff
          </p>
          <pre className="mt-2 min-w-0 whitespace-pre-wrap break-all rounded-md border border-border-dark bg-card-dark/80 p-3 text-xs leading-5 text-text-secondary">
            {patch.diffText || "No diff available."}
          </pre>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
            Evidence
          </p>
          <ReportEvidenceList evidenceLinks={patch.evidenceLinks} />
        </div>
      </div>
    </section>
  );
}

function ReportComparisonDeltaLinks({
  title,
  kind,
  addedIds,
  removedIds,
  projectId,
  comparison,
}: {
  title: string;
  kind: ComparisonDeltaKind;
  addedIds: string[];
  removedIds: string[];
  projectId: string;
  comparison?: ReportBundleArtifactCompareResponse | null;
}) {
  const renderLinks = (state: "added" | "removed", ids: string[]) => {
    if (ids.length === 0) {
      return (
        <span className="rounded border border-border-dark bg-background-dark/50 px-2 py-1 text-[11px] text-text-secondary">
          No {state} IDs
        </span>
      );
    }

    return ids.map((id) => (
      <Link
        key={`${state}:${id}`}
        to={getComparisonDeltaHref(projectId, kind, id, comparison)}
        aria-label={getComparisonDeltaAriaLabel(state, kind, id)}
        className="max-w-full truncate rounded border border-primary/30 bg-primary/10 px-2 py-1 font-mono text-[11px] text-primary transition-colors hover:border-primary/70 hover:bg-primary/15"
      >
        {id}
      </Link>
    ));
  };

  return (
    <div className="rounded-md border border-border-dark bg-background-dark/50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-secondary">
        {title}
      </p>
      <div className="mt-2 space-y-2">
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-emerald-300">
            Added
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {renderLinks("added", addedIds)}
          </div>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-red-300">
            Removed
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {renderLinks("removed", removedIds)}
          </div>
        </div>
      </div>
    </div>
  );
}

function SidebarContent({
  currentProjectId,
  report,
  proposals,
  selectedProposal,
  selectedProposalId,
  onSelectProposal,
  previewMode,
  onPreviewModeChange,
  onEvaluate,
  onEvaluateSection,
  onSeedDemo,
  onAcceptProposal,
  onRejectProposal,
  onDownloadArtifact,
  onDownloadGraphPng,
  onToggleGraphPreview,
  onCompareArtifacts,
  canGenerateWriteup,
  isEvaluationPending,
  isProviderSetupMissing,
  noProviderMessage,
  activityMessage,
  actionFeedback,
  flowHeadline,
  flowSummary,
  hasAcceptedRevision,
  hasSectionContent,
  seedPending,
  acceptPending,
  rejectPending,
  artifacts,
  artifactsLoading,
  artifactsError,
  downloadingArtifactId,
  downloadingGraphPngArtifactId,
  graphPreviewArtifactId,
  graphPreviewSvg,
  graphPreviewLoading,
  graphPreviewError,
  comparison,
  comparisonPendingTargetId,
  comparisonError,
}: {
  currentProjectId: string;
  report: Report | undefined;
  proposals: ReportProposal[];
  selectedProposal: ReportProposal | null;
  selectedProposalId: string | null;
  onSelectProposal: (proposalId: string) => void;
  previewMode: PreviewMode;
  onPreviewModeChange: (mode: PreviewMode) => void;
  onEvaluate: () => void;
  onEvaluateSection: (sectionKey: string) => void;
  onSeedDemo: () => void;
  onAcceptProposal: (proposalId: string) => void;
  onRejectProposal: (proposalId: string) => void;
  onDownloadArtifact: (artifact: ReportBundleArtifact) => void;
  onDownloadGraphPng: (artifact: ReportBundleArtifact) => void;
  onToggleGraphPreview: (artifact: ReportBundleArtifact) => void;
  onCompareArtifacts: (base: ReportBundleArtifact, target: ReportBundleArtifact) => void;
  canGenerateWriteup: boolean;
  isEvaluationPending: boolean;
  isProviderSetupMissing: boolean;
  noProviderMessage: string;
  activityMessage: string | null;
  actionFeedback: ActionFeedback | null;
  flowHeadline: string;
  flowSummary: string;
  hasAcceptedRevision: boolean;
  hasSectionContent: boolean;
  seedPending: boolean;
  acceptPending: boolean;
  rejectPending: boolean;
  artifacts: ReportBundleArtifact[];
  artifactsLoading: boolean;
  artifactsError: boolean;
  downloadingArtifactId: string | null;
  downloadingGraphPngArtifactId: string | null;
  graphPreviewArtifactId: string | null;
  graphPreviewSvg: string | null;
  graphPreviewLoading: boolean;
  graphPreviewError: boolean;
  comparison: ReportBundleArtifactCompareResponse | null;
  comparisonPendingTargetId: string | null;
  comparisonError: boolean;
}) {
  const isStartState = !hasAcceptedRevision && !hasSectionContent && proposals.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-border-dark bg-card-dark shadow-sm">
      <div className="border-b border-border-dark/80 px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-text-secondary">
          Workflow &amp; Review
        </p>
        <h2 className="mt-2 text-xl font-black tracking-tight text-text-primary">
          {flowHeadline}
        </h2>
        <p className="mt-2 text-sm leading-6 text-text-secondary">{flowSummary}</p>
        {activityMessage ? (
          <p className="mt-3 text-sm text-text-secondary">{activityMessage}</p>
        ) : null}
        {actionFeedback ? (
          <div className="mt-4 rounded-lg border border-red-400/20 bg-red-500/10 p-4">
            <p className="text-sm font-semibold text-red-100">
              {actionFeedback.title}
            </p>
            <p className="mt-2 break-words text-sm text-red-100/90">
              {actionFeedback.message}
            </p>
            <p className="mt-2 text-xs leading-5 text-red-100/70">
              {actionFeedback.hint}
            </p>
            <div className="mt-3">
              <AIQuickSettings label="Open AI Settings" variant="secondary" />
            </div>
          </div>
        ) : null}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-6 p-5">
          <section className="rounded-lg border border-border-dark/80 bg-background-dark/60 p-4">
            <div className="flex flex-wrap gap-2">
              {isStartState ? (
                <>
                  <Button
                    onClick={onEvaluate}
                    disabled={isEvaluationPending || !canGenerateWriteup}
                  >
                    Generate First Draft
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={onSeedDemo}
                    disabled={seedPending || isEvaluationPending}
                  >
                    Load Demo Flow
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  onClick={onEvaluate}
                  disabled={seedPending || isEvaluationPending || !canGenerateWriteup}
                >
                  Evaluate Now
                </Button>
              )}
            </div>

            {isProviderSetupMissing ? (
              <div className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/10 p-4">
                <p className="text-sm text-amber-100">{noProviderMessage}</p>
                <div className="mt-3">
                  <AIQuickSettings label="Open AI Settings" variant="secondary" />
                </div>
              </div>
            ) : null}
          </section>

          <section className="rounded-lg border border-border-dark/80 bg-background-dark/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
                  Preview Mode
                </p>
                <p className="mt-2 text-sm text-text-secondary">
                  Switch between the synced markdown and the selected pending update.
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                variant={previewMode === "current" ? "default" : "outline"}
                onClick={() => onPreviewModeChange("current")}
              >
                Current Markdown
              </Button>
              <Button
                type="button"
                variant={previewMode === "proposal" ? "default" : "outline"}
                onClick={() => onPreviewModeChange("proposal")}
                disabled={!selectedProposal}
              >
                Selected Update
              </Button>
            </div>
          </section>

          <section
            data-testid="report-artifact-history"
            className="rounded-lg border border-border-dark/80 bg-background-dark/60 p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
                  Export History
                </p>
                <h3 className="mt-2 text-base font-semibold text-text-primary">
                  {artifacts.length} bundle{artifacts.length === 1 ? "" : "s"}
                </h3>
              </div>
            </div>

            {artifactsLoading ? (
              <div className="mt-4 rounded-lg border border-dashed border-border-dark px-4 py-6 text-sm text-text-secondary">
                Loading export history.
              </div>
            ) : artifactsError ? (
              <div className="mt-4 rounded-lg border border-red-400/20 bg-red-400/10 px-4 py-6 text-sm text-red-200">
                Export history failed to load.
              </div>
            ) : artifacts.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-border-dark px-4 py-6 text-sm text-text-secondary">
                No report bundles exported yet.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {artifacts.map((artifact, artifactIndex) => {
                  const previousArtifact = artifacts[artifactIndex + 1] ?? null;
                  return (
                    <article
                      key={artifact.id}
                      className="rounded-lg border border-border-dark bg-card-dark/70 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-text-primary">
                            Revision {artifact.reportRevision}
                          </p>
                          <p className="mt-1 break-all text-xs text-text-secondary">
                            {artifact.filename}
                          </p>
                          <p className="mt-3 text-xs text-text-secondary">
                            {formatArtifactStats(artifact)}
                          </p>
                          <p className="mt-1 text-[11px] uppercase tracking-[0.16em] text-text-secondary">
                            {formatBytes(artifact.sizeBytes)} · sha256 {artifact.sha256.slice(0, 12)}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant={
                              graphPreviewArtifactId === artifact.id
                                ? "secondary"
                                : "ghost"
                            }
                            aria-label={`Preview graph for artifact ${artifact.filename}`}
                            onClick={() => onToggleGraphPreview(artifact)}
                          >
                            {graphPreviewArtifactId === artifact.id
                              ? "Hide graph"
                              : "Preview graph"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Download graph PNG for artifact ${artifact.filename}`}
                            onClick={() => onDownloadGraphPng(artifact)}
                            disabled={downloadingGraphPngArtifactId === artifact.id}
                          >
                            {downloadingGraphPngArtifactId === artifact.id
                              ? "Downloading graph..."
                              : "Download graph PNG"}
                          </Button>
                          {previousArtifact ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`Compare with previous export: ${artifact.filename}`}
                              onClick={() => onCompareArtifacts(previousArtifact, artifact)}
                              disabled={comparisonPendingTargetId === artifact.id}
                            >
                              {comparisonPendingTargetId === artifact.id
                                ? "Comparing..."
                                : "Compare with previous"}
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`Download artifact ${artifact.filename}`}
                            onClick={() => onDownloadArtifact(artifact)}
                            disabled={downloadingArtifactId === artifact.id}
                          >
                            {downloadingArtifactId === artifact.id ? "Downloading..." : "Download artifact"}
                          </Button>
                        </div>
                      </div>
                      {graphPreviewArtifactId === artifact.id ? (
                        <div className="mt-4 rounded-lg border border-cyan-400/20 bg-slate-950/60 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-200">
                              Attack Graph Preview
                            </p>
                            <span className="text-[11px] text-text-secondary">
                              Revision {artifact.reportRevision}
                            </span>
                          </div>
                          {graphPreviewLoading ? (
                            <div className="mt-3 rounded-md border border-dashed border-border-dark px-4 py-8 text-sm text-text-secondary">
                              Loading graph preview.
                            </div>
                          ) : graphPreviewError ? (
                            <div className="mt-3 rounded-md border border-red-400/20 bg-red-400/10 px-4 py-4 text-sm text-red-200">
                              Graph preview failed to load.
                            </div>
                          ) : graphPreviewSvg ? (
                            <div
                              data-testid="artifact-graph-preview"
                              className="mt-3 max-h-[420px] overflow-auto rounded-md border border-border-dark bg-[#08111f] p-3 [&_svg]:h-auto [&_svg]:max-w-none"
                              dangerouslySetInnerHTML={{ __html: graphPreviewSvg }}
                            />
                          ) : null}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}

            {comparisonPendingTargetId ? (
              <div className="mt-4 rounded-lg border border-border-dark bg-card-dark/70 px-4 py-3 text-sm text-text-secondary">
                Comparing exports...
              </div>
            ) : null}

            {comparisonError ? (
              <div className="mt-4 rounded-lg border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">
                Export comparison failed.
              </div>
            ) : null}

            {comparison ? (
              <section
                data-testid="report-artifact-comparison"
                className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                  Export Comparison
                </p>
                <h4 className="mt-2 text-sm font-semibold text-text-primary">
                  Revision {comparison.base.reportRevision} -&gt; Revision{" "}
                  {comparison.target.reportRevision}
                </h4>
                <p className="mt-2 text-sm text-text-secondary">
                  {formatComparisonSummary(comparison.summary)}
                </p>
                <p className="mt-1 text-xs text-text-secondary">
                  {comparison.summary.reportChanged
                    ? "Report markdown changed"
                    : "Report markdown unchanged"}
                </p>
                <div className="mt-4">
                  <Link
                    to={buildGraphComparisonHref(currentProjectId, comparison)}
                    className={cn(
                      "inline-flex h-8 items-center justify-center rounded-md border px-3 text-xs font-medium transition-colors",
                      "border-primary/40 bg-primary/10 text-primary hover:border-primary/70 hover:bg-primary/15",
                    )}
                  >
                    Open comparison in Attack Graph
                  </Link>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-md border border-border-dark bg-background-dark/60 p-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-text-secondary">
                      Commands
                    </p>
                    <p className="mt-1 text-sm text-text-primary">
                      +{comparison.commands.addedIds.length} / -{comparison.commands.removedIds.length}
                    </p>
                  </div>
                  <div className="rounded-md border border-border-dark bg-background-dark/60 p-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-text-secondary">
                      Nodes
                    </p>
                    <p className="mt-1 text-sm text-text-primary">
                      +{comparison.graph.addedNodeIds.length} / -{comparison.graph.removedNodeIds.length}
                    </p>
                  </div>
                  <div className="rounded-md border border-border-dark bg-background-dark/60 p-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-text-secondary">
                      Edges
                    </p>
                    <p className="mt-1 text-sm text-text-primary">
                      +{comparison.graph.addedEdgeIds.length} / -{comparison.graph.removedEdgeIds.length}
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-3">
                  <ReportComparisonDeltaLinks
                    title="Command IDs"
                    kind="command"
                    addedIds={comparison.commands.addedIds}
                    removedIds={comparison.commands.removedIds}
                    projectId={currentProjectId}
                    comparison={comparison}
                  />
                  <ReportComparisonDeltaLinks
                    title="Graph Node IDs"
                    kind="node"
                    addedIds={comparison.graph.addedNodeIds}
                    removedIds={comparison.graph.removedNodeIds}
                    projectId={currentProjectId}
                    comparison={comparison}
                  />
                  <ReportComparisonDeltaLinks
                    title="Graph Edge IDs"
                    kind="edge"
                    addedIds={comparison.graph.addedEdgeIds}
                    removedIds={comparison.graph.removedEdgeIds}
                    projectId={currentProjectId}
                    comparison={comparison}
                  />
                </div>
                <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border-dark bg-background-dark/80 p-3 text-xs leading-5 text-text-secondary">
                  {comparison.reportDiff.diffText || "No markdown diff."}
                </pre>
              </section>
            ) : null}
          </section>

          <section
            data-testid="report-sections-panel"
            className="rounded-lg border border-border-dark/80 bg-background-dark/60 p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
                  Sections
                </p>
                <h3 className="mt-2 text-base font-semibold text-text-primary">
                  Generate section updates
                </h3>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {(report?.sections ?? []).map((section) => (
                <article
                  key={section.id}
                  className="rounded-lg border border-border-dark bg-card-dark/70 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold text-text-primary">
                        {section.title}
                      </h4>
                      <p className="mt-2 text-sm leading-6 text-text-secondary">
                        {section.contentMd.trim().length > 0 ? section.contentMd : "No content yet."}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onEvaluateSection(section.key)}
                      disabled={isEvaluationPending || !canGenerateWriteup}
                    >
                      {section.contentMd.trim().length > 0
                        ? "Regenerate section"
                        : "Generate update"}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-border-dark/80 bg-background-dark/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
                  Pending Updates
                </p>
                <h3 className="mt-2 text-base font-semibold text-text-primary">
                  {proposals.length} pending
                </h3>
              </div>
            </div>

            {proposals.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-border-dark px-4 py-6 text-sm text-text-secondary">
                No report proposals pending.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {proposals.map((proposal) => (
                  <button
                    key={proposal.id}
                    type="button"
                    onClick={() => {
                      onSelectProposal(proposal.id);
                      onPreviewModeChange("proposal");
                    }}
                    className={cn(
                      "block w-full rounded-lg border p-4 text-left transition-colors",
                      selectedProposalId === proposal.id
                        ? "border-primary/60 bg-primary/10"
                        : "border-border-dark bg-card-dark/70 hover:border-primary/30",
                    )}
                  >
                    <p className="text-sm font-semibold text-text-primary">
                      {proposal.summary || "Pending report update"}
                    </p>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-text-secondary">
                      {proposal.triggerType}
                    </p>
                    <p className="mt-3 text-xs text-text-secondary">
                      {proposal.sectionPatches.length} section
                      {proposal.sectionPatches.length === 1 ? "" : "s"} touched
                    </p>
                  </button>
                ))}
              </div>
            )}
          </section>

          {selectedProposal ? (
            <section className="rounded-lg border border-border-dark/80 bg-background-dark/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
                    Selected Proposal
                  </p>
                  <h3 className="mt-2 text-base font-semibold text-text-primary">
                    {selectedProposal.summary || "Pending report update"}
                  </h3>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => onAcceptProposal(selectedProposal.id)}
                    disabled={acceptPending}
                  >
                    Accept update
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onRejectProposal(selectedProposal.id)}
                    disabled={rejectPending}
                  >
                    Reject update
                  </Button>
                </div>
              </div>

              <div className="mt-4 space-y-4">
                {selectedProposal.sectionPatches.map((patch) => (
                  <ProposalPatchCard key={patch.id} patch={patch} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}

export function ReportsPage() {
  const queryClient = useQueryClient();
  const currentProject = useProjectStore((state) => state.currentProject);
  const fetchProject = useProjectStore((state) => state.fetchProject);
  const projectId = currentProject?.id ?? null;
  const [evaluationTaskSeed, setEvaluationTaskSeed] = useState<{
    projectId: string;
    task: ReportEvaluationTask;
  } | null>(null);
  const hasAttemptedProjectRestoreRef = useRef(false);
  const lastFinalizedEvaluationTaskRef = useRef<string | null>(null);
  const previewPanelRef = useRef<HTMLDivElement | null>(null);
  const previewHighlightTimerRef = useRef<number | null>(null);
  const highlightedPreviewHeadingRef = useRef<HTMLElement | null>(null);
  const [manualSelectedProposal, setManualSelectedProposal] = useState<{
    projectId: string;
    proposalId: string;
  } | null>(null);
  const [previewModePreference, setPreviewModePreference] = useState<{
    projectId: string;
    mode: PreviewMode;
  } | null>(null);
  const [selectedGraphPreviewArtifact, setSelectedGraphPreviewArtifact] =
    useState<{
      projectId: string;
      artifactId: string;
    } | null>(null);
  const [folderExportResult, setFolderExportResult] = useState<{
    projectId: string;
    result: ReportFolderExportResponse;
  } | null>(null);
  const [notesSyncResult, setNotesSyncResult] = useState<{
    projectId: string;
    result: ReportNotesSyncResponse;
  } | null>(null);
  const [notesDiffOpenProjectId, setNotesDiffOpenProjectId] = useState<string | null>(
    null,
  );
  const [folderPathCopyStatus, setFolderPathCopyStatus] = useState<
    "copied" | "failed" | null
  >(null);
  const [notesAutoSyncEnabled, setNotesAutoSyncEnabled] = useState(
    readNotesAutoSyncPreference,
  );
  const [notesAutoSyncStatus, setNotesAutoSyncStatus] =
    useState<NotesAutoSyncStatus>("idle");
  const notesAutoSyncTimerRef = useRef<number | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedProposalId = searchParams.get("proposal")?.trim() || null;
  const isDesktop = useSyncExternalStore(
    subscribeToDesktopBreakpoint,
    getDesktopBreakpointSnapshot,
    getServerDesktopBreakpointSnapshot,
  );
  const activeEvaluationTaskId =
    evaluationTaskSeed?.projectId === projectId
      ? evaluationTaskSeed.task.taskId
      : null;

  const reportQuery = useQuery({
    queryKey: projectId ? reportQueryKeys.detail(projectId) : ["report", "idle"],
    queryFn: () => fetchProjectReport(projectId!),
    enabled: Boolean(projectId),
  });
  const proposalsQuery = useQuery({
    queryKey: projectId ? reportQueryKeys.proposals(projectId) : ["report", "proposals", "idle"],
    queryFn: () => fetchReportProposals(projectId!),
    enabled: Boolean(projectId),
  });
  const artifactsQuery = useQuery({
    queryKey: projectId ? reportQueryKeys.artifacts(projectId) : ["report", "artifacts", "idle"],
    queryFn: () => fetchReportBundleArtifacts(projectId!),
    enabled: Boolean(projectId),
  });
  const notesSyncStatusQuery = useQuery({
    queryKey: projectId
      ? reportQueryKeys.notesSyncStatus(projectId)
      : ["report", "notes-sync-status", "idle"],
    queryFn: () => fetchReportNotesSyncStatus(projectId!),
    enabled: Boolean(projectId),
  });
  const notesDiffOpen = notesDiffOpenProjectId === projectId;
  const notesSyncDiffQuery = useQuery({
    queryKey: projectId
      ? reportQueryKeys.notesSyncDiff(projectId)
      : ["report", "notes-sync-diff", "idle"],
    queryFn: () => fetchReportNotesSyncDiff(projectId!),
    enabled: Boolean(projectId && notesDiffOpen),
  });
  const activeGraphPreviewArtifactId =
    selectedGraphPreviewArtifact?.projectId === projectId
      ? selectedGraphPreviewArtifact.artifactId
      : null;
  const graphPreviewQuery = useQuery({
    queryKey:
      projectId && activeGraphPreviewArtifactId
        ? reportQueryKeys.artifactGraphPreview(projectId, activeGraphPreviewArtifactId)
        : ["report", "artifact-graph-preview", "idle"],
    queryFn: () =>
      fetchReportBundleArtifactGraphSvg(projectId!, activeGraphPreviewArtifactId!),
    enabled: Boolean(projectId && activeGraphPreviewArtifactId),
  });
  const providersQuery = useQuery({
    queryKey: ["ai", "providers"],
    queryFn: () => aiApi.listProviders(),
    enabled: Boolean(projectId),
  });
  const evaluationTaskQuery = useQuery({
    queryKey:
      projectId && activeEvaluationTaskId
        ? reportQueryKeys.evaluationTask(projectId, activeEvaluationTaskId)
        : ["report", "evaluation-task", "idle"],
    queryFn: () => fetchReportEvaluationTask(projectId!, activeEvaluationTaskId!),
    enabled: Boolean(projectId && activeEvaluationTaskId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status || status === "queued" || status === "running") {
        return 200;
      }
      return false;
    },
    refetchIntervalInBackground: true,
  });

  const invalidateReportQueries = async () => {
    if (!projectId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: reportQueryKeys.detail(projectId) }),
      queryClient.invalidateQueries({ queryKey: reportQueryKeys.proposals(projectId) }),
    ]);
  };

  const handleEvaluationTaskCreated = (task: ReportEvaluationTask) => {
    if (!projectId) return;
    setEvaluationTaskSeed({ projectId, task });
  };

  const evaluateMutation = useMutation({
    mutationFn: () => evaluateProjectReport(projectId!),
    onSuccess: handleEvaluationTaskCreated,
  });
  const evaluateSectionMutation = useMutation({
    mutationFn: (sectionKey: string) => evaluateReportSection(projectId!, sectionKey),
    onSuccess: handleEvaluationTaskCreated,
  });
  const syncNotesMutation = useMutation({
    mutationFn: async () => {
      const activeProjectId = projectId!;
      return {
        projectId: activeProjectId,
        result: await syncReportToNotes(activeProjectId),
      };
    },
    onMutate: () => {
      setNotesAutoSyncStatus("syncing");
    },
    onSuccess: ({ projectId: syncedProjectId, result }) => {
      setNotesSyncResult({ projectId: syncedProjectId, result });
      setNotesDiffOpenProjectId(null);
      setNotesAutoSyncStatus("synced");
      void queryClient.invalidateQueries({
        queryKey: reportQueryKeys.notesSyncStatus(syncedProjectId),
      });
      void queryClient.invalidateQueries({ queryKey: ["kb"] });
    },
    onError: () => {
      setNotesAutoSyncStatus("failed");
    },
  });

  const clearScheduledNotesAutoSync = () => {
    if (notesAutoSyncTimerRef.current === null) return;
    window.clearTimeout(notesAutoSyncTimerRef.current);
    notesAutoSyncTimerRef.current = null;
  };

  const scheduleNotesAutoSync = () => {
    if (!projectId || !notesAutoSyncEnabled) return;
    clearScheduledNotesAutoSync();
    setNotesAutoSyncStatus("scheduled");
    notesAutoSyncTimerRef.current = window.setTimeout(() => {
      notesAutoSyncTimerRef.current = null;
      syncNotesMutation.mutate();
    }, REPORTS_NOTES_AUTO_SYNC_DEBOUNCE_MS);
  };

  const handleNotesAutoSyncToggle = (enabled: boolean) => {
    setNotesAutoSyncEnabled(enabled);
    writeNotesAutoSyncPreference(enabled);
    if (!enabled) {
      clearScheduledNotesAutoSync();
    }
    setNotesAutoSyncStatus("idle");
  };

  const seedDemoMutation = useMutation({
    mutationFn: () => seedMockReportDemoCtf(projectId!),
    onSuccess: async () => {
      await invalidateReportQueries();
      scheduleNotesAutoSync();
    },
  });
  const acceptMutation = useMutation({
    mutationFn: (proposalId: string) => acceptReportProposal(projectId!, proposalId),
    onSuccess: async () => {
      await invalidateReportQueries();
      scheduleNotesAutoSync();
    },
  });
  const rejectMutation = useMutation({
    mutationFn: (proposalId: string) => rejectReportProposal(projectId!, proposalId),
    onSuccess: invalidateReportQueries,
  });
  const exportBundleMutation = useMutation({
    mutationFn: () => downloadReportBundle(projectId!),
    onSuccess: (blob) => {
      downloadBlob(
        blob,
        `${sanitizeDownloadName(currentProject?.name ?? report?.title ?? "report")}-report-bundle.zip`,
      );
      if (projectId) {
        void queryClient.invalidateQueries({ queryKey: reportQueryKeys.artifacts(projectId) });
      }
    },
  });
  const exportFolderMutation = useMutation({
    mutationFn: async () => {
      const activeProjectId = projectId!;
      return {
        projectId: activeProjectId,
        result: await exportReportFolder(activeProjectId),
      };
    },
    onSuccess: ({ projectId: exportedProjectId, result }) => {
      setFolderExportResult({ projectId: exportedProjectId, result });
      setFolderPathCopyStatus(null);
    },
  });
  const downloadArtifactMutation = useMutation({
    mutationFn: async (artifact: ReportBundleArtifact) => ({
      artifact,
      blob: await downloadReportBundleArtifact(projectId!, artifact.id),
    }),
    onSuccess: ({ artifact, blob }) => {
      downloadBlob(blob, artifact.filename);
    },
  });
  const downloadGraphPngMutation = useMutation({
    mutationFn: async (artifact: ReportBundleArtifact) => ({
      artifact,
      blob: await downloadReportBundleArtifactGraphPng(projectId!, artifact.id),
    }),
    onSuccess: ({ artifact, blob }) => {
      downloadBlob(blob, graphPngFilename(artifact));
    },
  });
  const compareArtifactsMutation = useMutation({
    mutationFn: ({
      base,
      target,
    }: {
      base: ReportBundleArtifact;
      target: ReportBundleArtifact;
    }) => compareReportBundleArtifacts(projectId!, base.id, target.id),
  });

  const handleToggleGraphPreview = (artifact: ReportBundleArtifact) => {
    if (!projectId) return;
    setSelectedGraphPreviewArtifact((current) =>
      current?.projectId === projectId && current.artifactId === artifact.id
        ? null
        : { projectId, artifactId: artifact.id },
    );
  };

  const handleCopyFolderPath = async () => {
    if (!activeFolderExportResult?.path || !navigator.clipboard) {
      setFolderPathCopyStatus("failed");
      return;
    }

    try {
      await navigator.clipboard.writeText(activeFolderExportResult.path);
      setFolderPathCopyStatus("copied");
    } catch {
      setFolderPathCopyStatus("failed");
    }
  };

  const handleJumpToPreviewSection = (sectionLabel: string) => {
    const previewPanel = previewPanelRef.current;
    if (!previewPanel) return;

    const targetLabel = normalizeMarkdownHeadingLabel(sectionLabel);
    const targetHeading = Array.from(
      previewPanel.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"),
    ).find(
      (heading) =>
        normalizeMarkdownHeadingLabel(heading.textContent ?? "") === targetLabel,
    );

    if (!targetHeading) return;

    if (previewHighlightTimerRef.current !== null) {
      window.clearTimeout(previewHighlightTimerRef.current);
      previewHighlightTimerRef.current = null;
    }

    highlightedPreviewHeadingRef.current?.classList.remove(
      ...REPORT_PREVIEW_HIGHLIGHT_CLASSES,
    );
    targetHeading.classList.add(...REPORT_PREVIEW_HIGHLIGHT_CLASSES);
    highlightedPreviewHeadingRef.current = targetHeading;
    targetHeading.scrollIntoView({ behavior: "smooth", block: "start" });

    previewHighlightTimerRef.current = window.setTimeout(() => {
      targetHeading.classList.remove(...REPORT_PREVIEW_HIGHLIGHT_CLASSES);
      if (highlightedPreviewHeadingRef.current === targetHeading) {
        highlightedPreviewHeadingRef.current = null;
      }
      previewHighlightTimerRef.current = null;
    }, REPORT_PREVIEW_HIGHLIGHT_MS);
  };

  useEffect(() => {
    if (typeof window === "undefined" || !projectId) {
      return;
    }

    window.localStorage.setItem(REPORTS_LAST_PROJECT_STORAGE_KEY, projectId);
  }, [projectId]);

  useEffect(() => {
    return () => {
      if (notesAutoSyncTimerRef.current !== null) {
        window.clearTimeout(notesAutoSyncTimerRef.current);
        notesAutoSyncTimerRef.current = null;
      }
      if (previewHighlightTimerRef.current !== null) {
        window.clearTimeout(previewHighlightTimerRef.current);
        previewHighlightTimerRef.current = null;
      }
      highlightedPreviewHeadingRef.current?.classList.remove(
        ...REPORT_PREVIEW_HIGHLIGHT_CLASSES,
      );
      highlightedPreviewHeadingRef.current = null;
    };
  }, [projectId]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      projectId ||
      hasAttemptedProjectRestoreRef.current
    ) {
      return;
    }

    hasAttemptedProjectRestoreRef.current = true;
    const lastProjectId = window.localStorage.getItem(REPORTS_LAST_PROJECT_STORAGE_KEY);
    if (!lastProjectId) {
      return;
    }

    void fetchProject(lastProjectId).catch(() => {
      window.localStorage.removeItem(REPORTS_LAST_PROJECT_STORAGE_KEY);
    });
  }, [fetchProject, projectId]);

  useEffect(() => {
    seedDemoMutation.reset();
  }, [projectId]);

  const report = reportQuery.data;
  const proposals = proposalsQuery.data?.items ?? [];
  const artifacts = artifactsQuery.data?.items ?? [];
  const activeFolderExportResult =
    folderExportResult?.projectId === projectId ? folderExportResult.result : null;
  const activeNotesSyncResult =
    notesSyncResult?.projectId === projectId
      ? notesSyncResult.result
      : (notesSyncStatusQuery.data ?? null);
  const syncedReportRevision = activeNotesSyncResult?.reportRevision ?? null;
  const currentReportRevision = report?.currentRevision ?? null;
  const notesSyncIsStale =
    syncedReportRevision !== null &&
    currentReportRevision !== null &&
    syncedReportRevision < currentReportRevision;
  const notesSyncFreshnessLabel =
    activeNotesSyncResult && syncedReportRevision !== null && currentReportRevision !== null
      ? notesSyncIsStale
        ? `Notes stale: revision ${syncedReportRevision} synced, report is revision ${currentReportRevision}`
        : `Notes synced: revision ${syncedReportRevision}`
      : null;
  const evaluationTask =
    evaluationTaskSeed?.projectId === projectId
      ? evaluationTaskQuery.data ?? evaluationTaskSeed.task
      : null;

  useEffect(() => {
    if (!projectId || !evaluationTask) return;
    if (
      evaluationTask.status !== "completed" &&
      evaluationTask.status !== "failed"
    ) {
      return;
    }

    const taskKey = `${projectId}:${evaluationTask.taskId}:${evaluationTask.status}`;
    if (lastFinalizedEvaluationTaskRef.current === taskKey) return;

    lastFinalizedEvaluationTaskRef.current = taskKey;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: reportQueryKeys.detail(projectId) }),
      queryClient.invalidateQueries({ queryKey: reportQueryKeys.proposals(projectId) }),
    ]).then(() => {
      if (evaluationTask.status === "completed") {
        scheduleNotesAutoSync();
      }
    });
  }, [evaluationTask, projectId, queryClient]);

  const activeManualSelectedProposalId =
    manualSelectedProposal?.projectId === projectId
      ? manualSelectedProposal.proposalId
      : null;
  const selectedProposalId = useMemo(() => {
    if (proposals.length === 0) {
      return null;
    }

    if (
      requestedProposalId &&
      proposals.some((proposal) => proposal.id === requestedProposalId)
    ) {
      return requestedProposalId;
    }

    if (
      activeManualSelectedProposalId &&
      proposals.some((proposal) => proposal.id === activeManualSelectedProposalId)
    ) {
      return activeManualSelectedProposalId;
    }

    return proposals[0]?.id ?? null;
  }, [activeManualSelectedProposalId, proposals, requestedProposalId]);

  const activePreviewModePreference =
    previewModePreference?.projectId === projectId
      ? previewModePreference.mode
      : null;
  const previewMode: PreviewMode =
    proposals.length > 0 ? activePreviewModePreference ?? "proposal" : "current";

  const handleSelectProposal = (proposalId: string) => {
    if (projectId) {
      setManualSelectedProposal({ projectId, proposalId });
      setPreviewModePreference({ projectId, mode: "proposal" });
    }
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("proposal", proposalId);
        return next;
      },
      { replace: true }
    );
  };

  const handlePreviewModeChange = (mode: PreviewMode) => {
    if (!projectId) return;
    setPreviewModePreference({ projectId, mode });
  };

  const selectedProposal = useMemo(
    () => proposals.find((proposal) => proposal.id === selectedProposalId) ?? proposals[0] ?? null,
    [proposals, selectedProposalId],
  );

  const enabledProviders = (providersQuery.data ?? []).filter((provider) => provider.is_enabled);
  const canGenerateWriteup = !providersQuery.isLoading && enabledProviders.length > 0;
  const isProviderSetupMissing =
    !providersQuery.isLoading && !providersQuery.isError && enabledProviders.length === 0;
  const hasAcceptedRevision = (report?.currentRevision ?? 0) > 0;
  const hasSectionContent =
    report?.sections.some((section) => section.contentMd.trim().length > 0) ?? false;
  const evaluationStatus = evaluationTask?.status ?? null;
  const isEvaluationTaskPending =
    evaluationStatus === "queued" || evaluationStatus === "running";
  const isEvaluationPending =
    evaluateMutation.isPending ||
    evaluateSectionMutation.isPending ||
    isEvaluationTaskPending;
  const isStartState = !hasAcceptedRevision && !hasSectionContent && proposals.length === 0;
  const isReviewState = proposals.length > 0;
  const flowHeadline = isStartState
    ? "Start the write-up"
    : isReviewState
      ? "Review pending updates"
      : "Write-up synced";
  const flowSummary = isStartState
    ? "Generate the first draft from project evidence or load a demo flow."
    : isReviewState
      ? `${proposals.length} update${proposals.length === 1 ? "" : "s"} waiting for review.`
      : "The current report is synced. Run another evaluation after meaningful progress.";
  const evaluationMessage =
    evaluationStatus === "queued"
      ? "Evaluation queued..."
      : evaluationStatus === "running"
        ? "Evaluation in progress..."
        : evaluationStatus === "completed"
          ? evaluationTask?.proposalId
            ? "Evaluation complete. Review the new proposal below."
            : "Evaluation complete. No new write-up update was proposed."
          : evaluationStatus === "failed"
            ? null
            : null;
  const evaluationStartError =
    evaluateMutation.isError
      ? getUserFacingErrorMessage(
          evaluateMutation.error,
          "Could not start report evaluation.",
        )
      : evaluateSectionMutation.isError
        ? getUserFacingErrorMessage(
            evaluateSectionMutation.error,
            "Could not start section evaluation.",
          )
        : null;
  const evaluationFailureMessage =
    evaluationStatus === "failed"
      ? evaluationTask?.error || "The AI provider did not return a usable update."
      : evaluationStartError;
  const exportBundleErrorMessage = exportBundleMutation.isError
    ? getUserFacingErrorMessage(
        exportBundleMutation.error,
        "Could not export the report bundle.",
      )
    : null;
  const exportFolderErrorMessage = exportFolderMutation.isError
    ? getUserFacingErrorMessage(
        exportFolderMutation.error,
        "Could not export the report folder.",
      )
    : null;
  const syncNotesErrorMessage = syncNotesMutation.isError
    ? getUserFacingErrorMessage(
        syncNotesMutation.error,
        "Could not sync the write-up into Notes.",
      )
    : null;
  const actionFeedback: ActionFeedback | null = evaluationFailureMessage
    ? {
        title: "Report evaluation failed",
        message: evaluationFailureMessage,
        hint: "Check the report AI routing and provider health, then run Evaluate Now again.",
      }
    : null;
  const noProviderMessage =
    "No AI provider configured for this account. Add one before generating or updating the write-up.";
  const seedMessage = seedDemoMutation.isSuccess
    ? `Demo flow loaded. Accepted revision ${seedDemoMutation.data?.acceptedRevisionCount ?? 0}; review the pending update below.`
    : null;
  const activityMessage = evaluationMessage ?? seedMessage;

  const previewSections = useMemo(
    () => mergePreviewSections(report?.sections ?? [], selectedProposal, previewMode),
    [previewMode, report, selectedProposal],
  );
  const previewMarkdown = useMemo(
    () => {
      const markdown = buildReportMarkdown(
        report?.title ?? currentProject?.name ?? "Living Write-Up",
        previewSections,
      );
      return hasAcceptedRevision || hasSectionContent
        ? appendAttackGraphVisualReference(markdown)
        : markdown;
    },
    [currentProject, hasAcceptedRevision, hasSectionContent, previewSections, report],
  );
  const previewDoc = useMemo(
    () =>
      buildPreviewDoc(
        report,
        currentProject?.id ?? "",
        currentProject?.name ?? "Living Write-Up",
        previewMarkdown,
        previewMode,
        selectedProposal?.id ?? null,
      ),
    [currentProject, previewMarkdown, previewMode, report, selectedProposal],
  );

  if (!currentProject || !projectId) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background-dark">
        <div className="rounded-md border border-border-dark bg-card-dark px-6 py-4 text-sm text-text-secondary">
          Open a project to review its living write-up.
        </div>
      </div>
    );
  }

  if (reportQuery.isLoading || proposalsQuery.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background-dark">
        <div className="rounded-md border border-border-dark bg-card-dark px-6 py-4 text-sm text-text-secondary">
          Loading report…
        </div>
      </div>
    );
  }

  const previewPane = (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-border-dark bg-card-dark shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border-dark/80 px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-text-secondary">
            Write-up Preview
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-text-primary">
            {report?.title ?? currentProject.name}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-border-dark bg-background-dark/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
              {formatReportProfile(report?.profile)}
            </span>
            <p className="text-sm text-text-secondary">
              Revision {report?.currentRevision ?? 0}
            </p>
            <p className="text-sm text-text-secondary">
              {formatPreviewModeLabel(previewMode, selectedProposal)}
            </p>
          </div>
        </div>
        <div className="flex max-w-full flex-col items-start gap-2 sm:items-end">
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => exportBundleMutation.mutate()}
              disabled={exportBundleMutation.isPending}
            >
              {exportBundleMutation.isPending ? "Exporting..." : "Export Bundle"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => exportFolderMutation.mutate()}
              disabled={exportFolderMutation.isPending}
            >
              {exportFolderMutation.isPending ? "Exporting folder..." : "Export Folder"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => syncNotesMutation.mutate()}
              disabled={syncNotesMutation.isPending}
            >
              {syncNotesMutation.isPending ? "Syncing notes..." : "Sync to Notes"}
            </Button>
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1.5 text-xs font-medium text-cyan-100">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-cyan-400"
              checked={notesAutoSyncEnabled}
              onChange={(event) => {
                handleNotesAutoSyncToggle(event.currentTarget.checked);
              }}
            />
            <span>Auto-sync Notes</span>
          </label>
          {notesAutoSyncEnabled && notesAutoSyncStatus === "scheduled" ? (
            <p className="text-xs text-cyan-200">Auto-sync scheduled.</p>
          ) : null}
          {notesAutoSyncEnabled && notesAutoSyncStatus === "syncing" ? (
            <p className="text-xs text-cyan-200">Auto-sync running...</p>
          ) : null}
          {notesAutoSyncEnabled && notesAutoSyncStatus === "synced" ? (
            <p className="text-xs text-emerald-200">Auto-sync completed.</p>
          ) : null}
          {notesAutoSyncEnabled && notesAutoSyncStatus === "failed" ? (
            <p className="text-xs text-red-200">Auto-sync failed.</p>
          ) : null}
          {exportBundleErrorMessage ? (
            <InlineActionError
              title="Bundle export failed."
              message={exportBundleErrorMessage}
            />
          ) : null}
          {exportFolderErrorMessage ? (
            <InlineActionError
              title="Folder export failed."
              message={exportFolderErrorMessage}
            />
          ) : null}
          {syncNotesErrorMessage ? (
            <InlineActionError
              title="Notes sync failed."
              message={syncNotesErrorMessage}
            />
          ) : null}
          {activeFolderExportResult ? (
            <div className="max-w-full rounded-md border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-left text-xs text-emerald-100 sm:text-right">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">Write-up folder exported.</p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label="Copy folder path"
                  onClick={() => {
                    void handleCopyFolderPath();
                  }}
                  className="h-7 border border-emerald-300/20 px-2 text-[11px] text-emerald-100 hover:bg-emerald-300/10 hover:text-emerald-50"
                >
                  Copy path
                </Button>
              </div>
              <p className="mt-1 break-all font-mono text-emerald-100/80">
                {activeFolderExportResult.path}
              </p>
              {folderPathCopyStatus === "copied" ? (
                <p className="mt-1 text-emerald-100/80">Folder path copied.</p>
              ) : null}
              {folderPathCopyStatus === "failed" ? (
                <p className="mt-1 text-red-200">Folder path copy failed.</p>
              ) : null}
            </div>
          ) : null}
          {activeNotesSyncResult ? (
            <div className="max-w-full rounded-md border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-left text-xs text-cyan-100 sm:text-right">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">Write-up synced to Notes.</p>
                <Button
                  asChild
                  size="sm"
                  variant="ghost"
                  className="h-7 border border-cyan-300/20 px-2 text-[11px] text-cyan-100 hover:bg-cyan-300/10 hover:text-cyan-50"
                >
                  <Link to={getProjectNotesLink(projectId, activeNotesSyncResult.docId)}>
                    Open Notes
                  </Link>
                </Button>
              </div>
              <p className="mt-1 break-all font-mono text-cyan-100/80">
                {activeNotesSyncResult.sourceName} / {activeNotesSyncResult.docPath}
              </p>
              {notesSyncFreshnessLabel ? (
                <div className="mt-1 flex flex-wrap items-center gap-2 sm:justify-end">
                  <p
                    className={cn(
                      "text-[11px] font-semibold",
                      notesSyncIsStale ? "text-amber-200" : "text-cyan-100/80",
                    )}
                  >
                    {notesSyncFreshnessLabel}
                  </p>
                  {notesSyncIsStale ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setNotesDiffOpenProjectId(notesDiffOpen ? null : projectId)
                        }
                        className="h-6 border border-cyan-300/20 px-2 text-[11px] text-cyan-100 hover:bg-cyan-300/10 hover:text-cyan-50"
                      >
                        {notesDiffOpen ? "Close diff" : "Open diff"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => syncNotesMutation.mutate()}
                        disabled={syncNotesMutation.isPending}
                        className="h-6 border border-amber-300/30 px-2 text-[11px] text-amber-100 hover:bg-amber-300/10 hover:text-amber-50"
                      >
                        {syncNotesMutation.isPending ? "Updating..." : "Update Notes"}
                      </Button>
                    </>
                  ) : null}
                </div>
              ) : null}
              {notesDiffOpen ? (
                <div className="mt-3 rounded-md border border-border-dark bg-background-dark/80 p-3 text-left">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-100/80">
                    Notes sync diff
                  </p>
                  {notesSyncDiffQuery.isLoading ? (
                    <p className="mt-2 text-xs text-text-secondary">Loading diff...</p>
                  ) : notesSyncDiffQuery.isError ? (
                    <p className="mt-2 text-xs text-red-200">Diff failed to load.</p>
                  ) : (
                    <NotesSyncDiffViewer
                      diffText={notesSyncDiffQuery.data?.diffText ?? ""}
                      onJumpToSection={handleJumpToPreviewSection}
                    />
                  )}
                </div>
              ) : null}
              <p className="mt-1 break-all font-mono text-cyan-100/70">
                {activeNotesSyncResult.sourcePath}
              </p>
            </div>
          ) : null}
          {report?.markdownPath ? (
            <p className="max-w-full break-all text-left text-xs text-text-secondary sm:text-right">
              {report.markdownPath}
            </p>
          ) : null}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div ref={previewPanelRef} data-testid="report-preview-panel" className="min-h-full">
          <MarkdownViewer doc={previewDoc} />
        </div>
      </ScrollArea>
    </div>
  );

  const sidebarPane = (
    <SidebarContent
      currentProjectId={projectId}
      report={report}
      proposals={proposals}
      selectedProposal={selectedProposal}
      selectedProposalId={selectedProposalId}
      onSelectProposal={handleSelectProposal}
      previewMode={previewMode}
      onPreviewModeChange={handlePreviewModeChange}
      onEvaluate={() => evaluateMutation.mutate()}
      onEvaluateSection={(sectionKey) => evaluateSectionMutation.mutate(sectionKey)}
      onSeedDemo={() => seedDemoMutation.mutate()}
      onAcceptProposal={(proposalId) => acceptMutation.mutate(proposalId)}
      onRejectProposal={(proposalId) => rejectMutation.mutate(proposalId)}
      onDownloadArtifact={(artifact) => downloadArtifactMutation.mutate(artifact)}
      onDownloadGraphPng={(artifact) => downloadGraphPngMutation.mutate(artifact)}
      onToggleGraphPreview={handleToggleGraphPreview}
      onCompareArtifacts={(base, target) => compareArtifactsMutation.mutate({ base, target })}
      canGenerateWriteup={canGenerateWriteup}
      isEvaluationPending={isEvaluationPending}
      isProviderSetupMissing={isProviderSetupMissing}
      noProviderMessage={noProviderMessage}
      activityMessage={activityMessage}
      actionFeedback={actionFeedback}
      flowHeadline={flowHeadline}
      flowSummary={flowSummary}
      hasAcceptedRevision={hasAcceptedRevision}
      hasSectionContent={hasSectionContent}
      seedPending={seedDemoMutation.isPending}
      acceptPending={acceptMutation.isPending}
      rejectPending={rejectMutation.isPending}
      artifacts={artifacts}
      artifactsLoading={artifactsQuery.isLoading}
      artifactsError={artifactsQuery.isError}
      downloadingArtifactId={
        downloadArtifactMutation.isPending
          ? downloadArtifactMutation.variables?.id ?? null
          : null
      }
      downloadingGraphPngArtifactId={
        downloadGraphPngMutation.isPending
          ? downloadGraphPngMutation.variables?.id ?? null
          : null
      }
      graphPreviewArtifactId={activeGraphPreviewArtifactId}
      graphPreviewSvg={graphPreviewQuery.data ?? null}
      graphPreviewLoading={graphPreviewQuery.isLoading}
      graphPreviewError={graphPreviewQuery.isError}
      comparison={compareArtifactsMutation.data ?? null}
      comparisonPendingTargetId={
        compareArtifactsMutation.isPending
          ? compareArtifactsMutation.variables?.target.id ?? null
          : null
      }
      comparisonError={compareArtifactsMutation.isError}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background-dark">
      <div className="min-h-0 flex-1 px-4 py-4 md:px-6 md:py-5">
        {isDesktop ? (
          <div className="h-full min-h-0">
            <Group orientation="horizontal">
              <Panel defaultSize={68} minSize={45}>
                <div className="h-full min-h-0 pr-2">{previewPane}</div>
              </Panel>

              <ResizeHandle />

              <Panel defaultSize={32} minSize={28}>
                <div className="h-full min-h-0 pl-2">{sidebarPane}</div>
              </Panel>
            </Group>
          </div>
        ) : (
          <div className="flex min-h-0 flex-col gap-4">
            <div className="min-h-[45vh]">{previewPane}</div>
            <div className="min-h-[40vh]">{sidebarPane}</div>
          </div>
        )}
      </div>
    </div>
  );
}
