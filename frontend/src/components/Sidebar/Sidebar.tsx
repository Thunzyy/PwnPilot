import { useState } from "react";
import {
  FolderOpen,
  Folder,
  ChevronRight,
  ChevronDown,
  Search,
  Activity,
  CheckCircle2,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  EngagementChecklistItem,
  EngagementChecklistSection,
  EngagementGraphNode,
} from "@/types/engagement";

type ChecklistSection = EngagementChecklistSection;
type SidebarViewMode = "observed" | "methodology";
type InsightTone = "action" | "gap";
type EvidenceConfidence = "confirmed" | "likely" | "weak";

interface MethodologyInsight {
  id: string;
  text: string;
}

export interface SidebarEvidenceSelection {
  sectionId: string;
  itemId: string;
}

interface EvidenceProfile {
  confidence: EvidenceConfidence;
  source: string;
  evidenceCount: number;
  successCount: number;
  failureCount: number;
  lastSeenAt: string | null;
}

interface SidebarProps {
  projectId?: string;
  sections: ChecklistSection[];
  graphNodes: EngagementGraphNode[];
  onToggleItem: (sectionId: string, itemId: string) => void;
  onToggleSection: (sectionId: string) => void;
  progress: number;
  isLoading: boolean;
  errorMessage: string | null;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  selectedEvidenceItem?: SidebarEvidenceSelection | null;
  onSelectedEvidenceItemChange?: (
    selectedEvidenceItem: SidebarEvidenceSelection | null
  ) => void;
}

const MAX_LINKED_GRAPH_EVIDENCE = 5;

const getExactLinkedGraphNodes = (
  graphNodes: EngagementGraphNode[],
  item: EngagementChecklistItem
): EngagementGraphNode[] =>
  graphNodes.filter((node) => node.itemId === item.id || node.id === item.id);

const getLinkedGraphNodes = (
  graphNodes: EngagementGraphNode[],
  section: ChecklistSection,
  item: EngagementChecklistItem
): EngagementGraphNode[] => {
  const exactMatches = getExactLinkedGraphNodes(graphNodes, item);
  if (exactMatches.length > 0) {
    return exactMatches.slice(0, MAX_LINKED_GRAPH_EVIDENCE);
  }

  return graphNodes
    .filter((node) => node.sectionId === section.id && !node.itemId)
    .slice(0, MAX_LINKED_GRAPH_EVIDENCE);
};

const isAttackGraphNode = (node: EngagementGraphNode): boolean => {
  const haystack = `${node.id} ${node.subtitle} ${node.icon}`.toLowerCase();
  return node.id.startsWith("graph-node:") || haystack.includes("attack graph node");
};

const inferGraphNodeSource = (node: EngagementGraphNode): string => {
  const haystack = `${node.id} ${node.subtitle} ${node.icon}`.toLowerCase();
  if (isAttackGraphNode(node)) return "Attack Graph";
  if (haystack.includes("timeline")) return "Timeline";
  if (
    haystack.includes("ai assistant") ||
    haystack.includes("ai operator") ||
    haystack.includes("ai memory")
  ) {
    return "AI";
  }
  return "Command History";
};

const formatGraphNodeStatus = (node: EngagementGraphNode): string =>
  formatSource(node.status ?? node.type);

const getCommandHistoryHref = (
  projectId: string | undefined,
  node: EngagementGraphNode
): string | null => {
  if (
    !projectId ||
    node.id.startsWith("manual-node-") ||
    inferGraphNodeSource(node) !== "Command History"
  ) {
    return null;
  }
  return `/projects/${projectId}/timeline?commandId=${encodeURIComponent(node.id)}`;
};

const isObservedItem = (
  item: EngagementChecklistItem,
  linkedGraphNodes: EngagementGraphNode[] = []
): boolean =>
  (item.evidenceCount ?? 0) > 0 ||
  (item.successCount ?? 0) > 0 ||
  (item.failureCount ?? 0) > 0 ||
  Boolean(item.lastSeenAt) ||
  linkedGraphNodes.length > 0;

const toEvidenceProfile = (
  item: EngagementChecklistItem,
  linkedGraphNodes: EngagementGraphNode[] = []
): EvidenceProfile => {
  const graphEvidenceCount = linkedGraphNodes.length;
  const graphSuccessCount = linkedGraphNodes.filter(
    (node) => node.status === "success" || node.type === "success"
  ).length;
  const graphFailureCount = linkedGraphNodes.filter(
    (node) => node.status === "failure" || node.type === "failure"
  ).length;
  const evidenceCount = Math.max(item.evidenceCount ?? 0, graphEvidenceCount);
  const successCount = Math.max(item.successCount ?? 0, graphSuccessCount);
  const failureCount = Math.max(item.failureCount ?? 0, graphFailureCount);
  const normalized = `${item.id} ${item.label}`.toLowerCase();
  const source = normalized.includes("attack_graph") ||
    normalized.includes("attack graph") ||
    linkedGraphNodes.some(isAttackGraphNode)
    ? "attack graph"
    : linkedGraphNodes.length > 0
    ? "graph evidence"
    : evidenceCount > 0 || successCount > 0 || failureCount > 0 || item.lastSeenAt
    ? "history"
    : "manual";
  const confidence: EvidenceConfidence =
    successCount > 0 || (item.status === "done" && evidenceCount > 0)
      ? "confirmed"
      : failureCount > 0 && successCount === 0
      ? "weak"
      : evidenceCount > 0 || item.status === "active" || Boolean(item.lastSeenAt)
      ? "likely"
      : "weak";

  return {
    confidence,
    source,
    evidenceCount,
    successCount,
    failureCount,
    lastSeenAt: item.lastSeenAt ?? null,
  };
};

const formatSource = (source: string): string =>
  source.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

const formatEvidenceDate = (value: string | null): string => {
  if (!value) return "n/a";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Date(timestamp)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, " UTC");
};

const findSelectedEvidenceItem = (
  sections: ChecklistSection[],
  selected: SidebarEvidenceSelection | null
): { section: ChecklistSection; item: EngagementChecklistItem } | null => {
  if (!selected) return null;
  const section = sections.find((candidate) => candidate.id === selected.sectionId);
  const item = section?.items.find((candidate) => candidate.id === selected.itemId);
  if (!section || !item) return null;
  return { section, item };
};

const matchesAny = (item: EngagementChecklistItem, patterns: RegExp[]): boolean => {
  const haystack = `${item.id} ${item.label}`.toLowerCase();
  return patterns.some((pattern) => pattern.test(haystack));
};

const getSection = (
  sections: ChecklistSection[],
  sectionId: string
): ChecklistSection | undefined => sections.find((section) => section.id === sectionId);

const getObservedItems = (
  sections: ChecklistSection[],
  sectionId: string,
  graphNodes: EngagementGraphNode[] = []
): EngagementChecklistItem[] =>
  getSection(sections, sectionId)?.items.filter((item) =>
    isObservedItem(item, getExactLinkedGraphNodes(graphNodes, item))
  ) ?? [];

const hasObservedSection = (
  sections: ChecklistSection[],
  sectionId: string,
  graphNodes: EngagementGraphNode[] = []
): boolean => getObservedItems(sections, sectionId, graphNodes).length > 0;

const deriveAdaptiveInsights = (
  sections: ChecklistSection[],
  progress: number,
  graphNodes: EngagementGraphNode[] = []
): { nextActions: MethodologyInsight[]; evidenceGaps: MethodologyInsight[] } => {
  const observedItems = sections.flatMap((section) =>
    section.items.filter((item) =>
      isObservedItem(item, getExactLinkedGraphNodes(graphNodes, item))
    )
  );
  const hasRecon = hasObservedSection(sections, "recon", graphNodes);
  const hasExploitation = hasObservedSection(sections, "exploitation", graphNodes);
  const hasPrivesc = hasObservedSection(sections, "privesc", graphNodes);
  const hasPostExploitation = hasObservedSection(sections, "postexp", graphNodes);
  const hasFoothold = getObservedItems(sections, "exploitation", graphNodes).some((item) =>
    matchesAny(item, [/foothold/, /remote login/, /session/, /shell/, /ssh/, /login/])
  );
  const activeItem = observedItems.find((item) => item.status === "active");
  const nextActions: MethodologyInsight[] = [];
  const evidenceGaps: MethodologyInsight[] = [];

  if (progress >= 100) {
    return {
      nextActions: [
        {
          id: "report-ready",
          text: "Review final write-up evidence and export the report.",
        },
      ],
      evidenceGaps,
    };
  }

  if (activeItem) {
    nextActions.push({
      id: "finish-active",
      text: `Finish active step: ${activeItem.label}.`,
    });
  }

  if (!hasRecon) {
    nextActions.push({
      id: "start-recon",
      text: "Run initial service discovery and fingerprint the target.",
    });
  } else if (!hasExploitation) {
    nextActions.push({
      id: "find-foothold",
      text: "Probe exposed services for a foothold path.",
    });
    evidenceGaps.push({
      id: "gap-initial-access",
      text: "Initial access is not evidenced yet.",
    });
  } else if (!hasPrivesc) {
    nextActions.push({
      id: hasFoothold ? "local-privesc" : "stabilize-session",
      text: hasFoothold
        ? "Run local privilege escalation enumeration from the obtained session."
        : "Convert exploitation findings into a stable session.",
    });
    evidenceGaps.push({
      id: hasFoothold ? "gap-privesc" : "gap-foothold",
      text: hasFoothold
        ? "Privilege escalation evidence is missing."
        : "Foothold or session evidence is missing.",
    });
  } else if (!hasPostExploitation) {
    nextActions.push({
      id: "collect-loot",
      text: "Collect flags, loot, and proof artifacts for the report.",
    });
    evidenceGaps.push({
      id: "gap-loot",
      text: "Flag or loot collection is not evidenced yet.",
    });
  } else {
    nextActions.push({
      id: "prepare-writeup",
      text: "Review unresolved evidence gaps and prepare the write-up.",
    });
  }

  for (const item of observedItems) {
    if ((item.failureCount ?? 0) > 0 && (item.successCount ?? 0) === 0) {
      evidenceGaps.push({
        id: `gap-failed-${item.id}`,
        text: `${item.label} has failed evidence to review.`,
      });
    }
  }

  if (observedItems.length > 0 && evidenceGaps.length === 0) {
    evidenceGaps.push({
      id: "gap-none",
      text: "No obvious evidence gaps from current signals.",
    });
  }

  return {
    nextActions: nextActions.slice(0, 3),
    evidenceGaps: evidenceGaps.slice(0, 3),
  };
};

function InsightPanel({
  title,
  items,
  tone,
}: {
  title: string;
  items: MethodologyInsight[];
  tone: InsightTone;
}) {
  if (items.length === 0) return null;

  return (
    <section
      className={cn(
        "rounded-lg border p-3 text-xs",
        tone === "action"
          ? "border-primary/20 bg-primary/[0.04]"
          : "border-amber-500/20 bg-amber-500/[0.04]"
      )}
      aria-label={title}
    >
      <div
        className={cn(
          "mb-2 text-[10px] font-bold uppercase tracking-widest",
          tone === "action" ? "text-primary" : "text-amber-300"
        )}
      >
        {title}
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="flex gap-2 text-slate-300">
            <span
              className={cn(
                "mt-1 size-1.5 shrink-0 rounded-full",
                tone === "action" ? "bg-primary" : "bg-amber-300"
              )}
            />
            <span className="leading-relaxed">{item.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function EvidenceBadges({ profile }: { profile: EvidenceProfile }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      <span
        className={cn(
          "rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
          profile.confidence === "confirmed"
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
            : profile.confidence === "likely"
            ? "border-primary/30 bg-primary/10 text-primary"
            : "border-amber-500/30 bg-amber-500/10 text-amber-300"
        )}
      >
        {profile.confidence}
      </span>
      <span className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">
        {formatSource(profile.source)}
      </span>
      <span className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">
        {profile.evidenceCount} evidence
      </span>
    </div>
  );
}

function EvidenceDetailsPanel({
  projectId,
  selected,
  graphNodes,
  onClose,
}: {
  projectId?: string;
  selected: { section: ChecklistSection; item: EngagementChecklistItem };
  graphNodes: EngagementGraphNode[];
  onClose: () => void;
}) {
  const linkedGraphNodes = getLinkedGraphNodes(
    graphNodes,
    selected.section,
    selected.item
  );
  const profile = toEvidenceProfile(selected.item, linkedGraphNodes);

  return (
    <section
      aria-label="Evidence Details"
      className="mb-4 rounded-lg border border-white/10 bg-black/25 p-3 text-xs"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-primary">
            Evidence Details
          </div>
          <div className="mt-1 text-sm font-semibold text-slate-100">
            {selected.item.label}
          </div>
        </div>
        <button
          type="button"
          aria-label="Close evidence details"
          onClick={onClose}
          className="rounded border border-white/10 px-2 py-1 text-[10px] text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
        >
          Close
        </button>
      </div>
      <div className="space-y-1.5 text-slate-300">
        <div>Source: {formatSource(profile.source)}</div>
        <div>Confidence: {formatSource(profile.confidence)}</div>
        <div>Evidence events: {profile.evidenceCount}</div>
        <div>Successful events: {profile.successCount}</div>
        <div>Failed events: {profile.failureCount}</div>
        <div>Last seen: {formatEvidenceDate(profile.lastSeenAt)}</div>
        <div className="text-slate-500">Section: {selected.section.label}</div>
      </div>
      {linkedGraphNodes.length > 0 && (
        <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-2">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Linked Graph Evidence
          </div>
          <div className="space-y-2">
            {linkedGraphNodes.map((node) => {
              const nodeSource = inferGraphNodeSource(node);
              const commandHistoryHref = getCommandHistoryHref(projectId, node);

              return (
                <div key={node.id} className="rounded-md bg-black/20 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] font-semibold text-slate-100">
                      {node.title}
                    </span>
                    <span className="shrink-0 rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-primary">
                      {nodeSource}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-500">
                    <span className="truncate">{node.subtitle}</span>
                    <span className="shrink-0">{formatGraphNodeStatus(node)}</span>
                  </div>
                  {commandHistoryHref && (
                    <a
                      href={commandHistoryHref}
                      className="mt-2 inline-flex rounded border border-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary transition-colors hover:border-primary/30 hover:bg-primary/10"
                    >
                      Open in History
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

export function Sidebar({
  projectId,
  sections = [],
  graphNodes = [],
  onToggleItem,
  onToggleSection,
  progress = 0,
  isLoading = false,
  errorMessage = null,
  collapsed,
  onCollapsedChange,
  selectedEvidenceItem,
  onSelectedEvidenceItemChange,
}: Partial<SidebarProps>) {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<SidebarViewMode>("observed");
  const [internalSelectedEvidenceItem, setInternalSelectedEvidenceItem] =
    useState<SidebarEvidenceSelection | null>(null);
  const isCollapsed = collapsed ?? internalCollapsed;
  const activeSelectedEvidenceItem =
    selectedEvidenceItem === undefined
      ? internalSelectedEvidenceItem
      : selectedEvidenceItem;
  const showMethodology = viewMode === "methodology";
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const displayedSections = showMethodology
    ? sections
    : sections
        .map((section) => ({
          ...section,
          items: section.items.filter((item) =>
            isObservedItem(item, getExactLinkedGraphNodes(graphNodes, item))
          ),
        }))
        .filter((section) => section.items.length > 0);
  const filteredSections = displayedSections
    .map((section) => {
      if (!normalizedSearch) return section;
      const sectionMatches = section.label.toLowerCase().includes(normalizedSearch);
      const items = section.items.filter((item) =>
        item.label.toLowerCase().includes(normalizedSearch)
      );
      return sectionMatches ? section : { ...section, items };
    })
    .filter((section) => {
      if (!normalizedSearch) return true;
      return (
        section.label.toLowerCase().includes(normalizedSearch) ||
        section.items.length > 0
      );
    });
  const hasAnyVisibleItems = filteredSections.some(
    (section) => section.items.length > 0
  );
  const shouldShowEmptyState = !normalizedSearch && !hasAnyVisibleItems;
  const isMissionComplete = progress >= 100;
  const adaptiveInsights = deriveAdaptiveInsights(sections, progress, graphNodes);
  const shouldShowAdaptiveInsights =
    !showMethodology && !normalizedSearch && !isLoading && !errorMessage;
  const selectedEvidence = findSelectedEvidenceItem(
    sections,
    activeSelectedEvidenceItem ?? null
  );

  const setCollapsed = (next: boolean) => {
    if (collapsed === undefined) {
      setInternalCollapsed(next);
    }
    onCollapsedChange?.(next);
  };

  const setEvidenceSelection = (
    next: SidebarEvidenceSelection | null
  ) => {
    if (selectedEvidenceItem === undefined) {
      setInternalSelectedEvidenceItem(next);
    }
    onSelectedEvidenceItemChange?.(next);
  };

  const selectEvidenceItem = (sectionId: string, itemId: string) => {
    setEvidenceSelection({ sectionId, itemId });
  };

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-border-dark bg-background-dark shrink-0 transition-all duration-300 ease-in-out",
        isCollapsed ? "w-14" : "w-72"
      )}
    >
      <div className="p-2 flex items-center justify-end shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(!isCollapsed)}
          className="h-8 w-8 text-slate-500 hover:text-primary hover:bg-white/5"
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? (
            <PanelLeft className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </Button>
      </div>

      {!isCollapsed && (
        <>
          <div className="px-4 pb-4 flex flex-col gap-4 shrink-0">
            <div className="relative group">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500 group-focus-within:text-primary transition-colors" />
              <Input
                placeholder="Search engagement..."
                className="pl-9 bg-black/20 border-white/10 h-9 transition-colors focus:ring-primary/20"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
              <div className="absolute right-2 top-2 h-5 flex items-center gap-1 text-[10px] text-slate-600 font-mono border border-white/10 rounded px-1.5 bg-black/20">
                <span>/</span>
              </div>
            </div>
          </div>

          <Separator className="bg-white/5" />

          <ScrollArea className="flex-1 px-2 py-4">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 px-3 flex items-center justify-between">
              <span>{showMethodology ? "Target Methodology" : "Observed Progress"}</span>
              <span className="text-primary/50">
                {showMethodology ? "v1.2" : "AI-backed"}
              </span>
            </div>

            <div className="mb-4 px-3">
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-black/20 p-1">
                <button
                  type="button"
                  aria-pressed={!showMethodology}
                  onClick={() => setViewMode("observed")}
                  className={cn(
                    "rounded-md px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors",
                    !showMethodology
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "text-slate-500 hover:text-slate-300 hover:bg-white/[0.03]"
                  )}
                >
                  Observed
                </button>
                <button
                  type="button"
                  aria-pressed={showMethodology}
                  onClick={() => setViewMode("methodology")}
                  className={cn(
                    "rounded-md px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors",
                    showMethodology
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "text-slate-500 hover:text-slate-300 hover:bg-white/[0.03]"
                  )}
                >
                  Methodology
                </button>
              </div>
            </div>

            {shouldShowAdaptiveInsights && (
              <div className="mb-4 px-3 space-y-2">
                <InsightPanel
                  title="Next Actions"
                  items={adaptiveInsights.nextActions}
                  tone="action"
                />
                <InsightPanel
                  title="Evidence Gaps"
                  items={adaptiveInsights.evidenceGaps}
                  tone="gap"
                />
              </div>
            )}

            {selectedEvidence && (
              <div className="px-3">
                <EvidenceDetailsPanel
                  projectId={projectId}
                  selected={selectedEvidence}
                  graphNodes={graphNodes}
                  onClose={() => setEvidenceSelection(null)}
                />
              </div>
            )}

            <nav className="space-y-1">
              {isLoading && (
                <div className="px-3 py-6 text-center text-xs text-slate-400">
                  Loading engagement checklist...
                </div>
              )}
              {!isLoading && errorMessage && (
                <div className="px-3 py-6 text-center text-xs text-red-300">
                  {errorMessage}
                </div>
              )}
              {!isLoading &&
                !errorMessage &&
                !shouldShowEmptyState &&
                filteredSections.map((section, idx) => (
                  <div key={section.id} className="space-y-1">
                    <div
                      className={cn(
                        "group flex items-center justify-between px-3 py-2 rounded-md transition-all cursor-pointer text-sm font-medium",
                        section.isOpen
                          ? "bg-white/[0.03] text-primary"
                          : "text-slate-400 hover:bg-white/[0.02] hover:text-slate-200"
                      )}
                      onClick={() => onToggleSection?.(section.id)}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            "flex items-center justify-center size-5 rounded",
                            section.isOpen ? "text-primary" : "text-slate-500"
                          )}
                        >
                          {section.isOpen ? (
                            <FolderOpen className="h-4 w-4" />
                          ) : (
                            <Folder className="h-4 w-4" />
                          )}
                        </div>
                        <span>
                          {idx + 1}. {section.label}
                        </span>
                      </div>
                      {section.isOpen ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                    </div>

                    {section.isOpen && (
                      <div className="ml-5 border-l border-white/5 pl-2 py-1 space-y-1">
                        {section.items.map((item) => {
                          const linkedGraphNodes = getExactLinkedGraphNodes(
                            graphNodes,
                            item
                          );
                          const evidenceProfile = toEvidenceProfile(
                            item,
                            linkedGraphNodes
                          );
                          const isSelected =
                            activeSelectedEvidenceItem?.sectionId === section.id &&
                            activeSelectedEvidenceItem?.itemId === item.id;

                          return (
                            <div
                              key={item.id}
                              role="button"
                              tabIndex={0}
                              className={cn(
                                "group flex items-start justify-between gap-2 p-2 rounded-md transition-all cursor-pointer text-xs",
                                item.status === "active"
                                  ? "bg-primary/5 text-primary border border-primary/10"
                                  : "text-slate-500 hover:text-slate-300 hover:bg-white/[0.02]",
                                isSelected && "bg-white/[0.05] text-slate-100"
                              )}
                              onClick={() => selectEvidenceItem(section.id, item.id)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  selectEvidenceItem(section.id, item.id);
                                }
                              }}
                            >
                              <div className="flex min-w-0 items-start gap-3">
                                <div
                                  className={cn(
                                    "mt-1.5 size-1.5 shrink-0 rounded-full transition-all",
                                    item.status === "done"
                                      ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                                      : item.status === "active"
                                      ? "bg-primary animate-pulse"
                                      : "bg-slate-700"
                                  )}
                                />
                                <div className="min-w-0">
                                  <span
                                    className={cn(
                                      "block leading-relaxed",
                                      item.status === "done" &&
                                        "line-through opacity-50 font-normal"
                                    )}
                                  >
                                    {item.label}
                                  </span>
                                  {isObservedItem(item, linkedGraphNodes) && (
                                    <EvidenceBadges profile={evidenceProfile} />
                                  )}
                                </div>
                              </div>

                              <button
                                type="button"
                                aria-label={`Cycle ${item.label} status`}
                                className="mt-0.5 shrink-0 rounded p-0.5 text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-slate-200"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onToggleItem?.(section.id, item.id);
                                }}
                              >
                                {item.status === "done" && (
                                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                                )}
                                {item.status === "active" && (
                                  <Activity className="h-3 w-3 text-primary animate-pulse" />
                                )}
                                {item.status === "pending" && (
                                  <span className="block size-3 rounded-full border border-slate-700" />
                                )}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              {!isLoading && !errorMessage && shouldShowEmptyState && (
                <div className="px-3 py-6 text-center text-xs text-slate-500">
                  {showMethodology
                    ? "No engagement data yet."
                    : "No observed progress yet."}
                </div>
              )}
            </nav>
          </ScrollArea>

          <div className="p-4 border-t border-white/5 bg-black/20">
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Mission Progress
                </span>
                <Badge
                  variant="outline"
                  className={cn(
                    "h-4 px-1 text-[8px]",
                    isMissionComplete
                      ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                      : "bg-primary/5 text-primary border-primary/20"
                  )}
                >
                  {isMissionComplete ? "COMPLETE" : "ALPHA"}
                </Badge>
              </div>
              <span className="text-xs font-mono font-bold text-slate-200">
                {progress}%
              </span>
            </div>
            <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden border border-white/[0.02]">
              <div
                className="h-full bg-gradient-to-r from-[#0ea5e9] to-[#0369a1] rounded-full transition-all duration-1000"
                style={{ width: `${progress}%` }}
              ></div>
            </div>
          </div>
        </>
      )}

      {isCollapsed && (
        <div className="flex-1 flex flex-col items-center py-4 gap-2">
          {displayedSections.map((section, idx) => (
            <Button
              key={section.id}
              variant="ghost"
              size="icon"
              className={cn(
                "h-8 w-8",
                section.isOpen
                  ? "text-primary bg-white/5"
                  : "text-slate-500 hover:text-slate-300"
              )}
              title={section.label}
              onClick={() => onToggleSection?.(section.id)}
            >
              <span className="text-xs font-bold">{idx + 1}</span>
            </Button>
          ))}
        </div>
      )}

      {isCollapsed && (
        <div className="p-2 border-t border-white/5 bg-black/20 flex justify-center">
          <div
            className="size-8 rounded-full bg-slate-900 border border-white/5 flex items-center justify-center"
            title={`${progress}% complete`}
          >
            <span className="text-[8px] font-mono font-bold text-slate-400">
              {progress}%
            </span>
          </div>
        </div>
      )}
    </aside>
  );
}
