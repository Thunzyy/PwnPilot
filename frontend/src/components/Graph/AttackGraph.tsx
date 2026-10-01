import { lazy, Suspense, useMemo } from "react";
import { Maximize2 } from "lucide-react";

import type { Project } from "@/types";
import type {
  EngagementGraphEdge,
  EngagementGraphNode,
  EngagementStateSource,
} from "@/types/engagement";
import type {
  CreateReportProposalPayload,
  CreateReportProposalResponse,
  ReportEvidenceUsageTarget,
} from "@/types/report";
import { useProjectGraph } from "@/features/attack-graph/useProjectGraph";
import type {
  AttackGraphComparisonOverlay,
  AttackGraphData,
  AttackGraphEdge,
  AttackGraphNode,
} from "@/features/attack-graph/types";

const AttackGraphPanel = lazy(async () => ({
  default: (await import("@/features/attack-graph/AttackGraphPanel"))
    .AttackGraphPanel,
}));

interface AttackGraphProps {
  projectId?: string;
  projectType?: Project["type"];
  isCollapsed?: boolean;
  onToggle?: () => void;
  nodes?: EngagementGraphNode[];
  edges?: EngagementGraphEdge[];
  source?: EngagementStateSource;
  isLoading?: boolean;
  errorMessage?: string | null;
  onLoadDemoScenario?: unknown;
  onUpdateNode?: unknown;
  onAddNode?: unknown;
  onDeleteNode?: unknown;
  onMoveNode?: unknown;
  isLoadingDemo?: boolean;
  selectedGraphNodeId?: string | null;
  selectedGraphEdgeId?: string | null;
  comparisonOverlay?: AttackGraphComparisonOverlay | null;
  onSendEvidenceToAI?: (text: string) => void;
  onAddEvidenceToReport?: (
    payload: CreateReportProposalPayload
  ) => Promise<CreateReportProposalResponse>;
  onOpenReportEvidence?: (target: ReportEvidenceUsageTarget) => void;
}

const timestamp = "1970-01-01T00:00:00.000Z";

const sectionPhaseLabels: Record<string, string> = {
  recon: "Reconnaissance",
  exploitation: "Exploitation",
  privesc: "Privilege Escalation",
  postexp: "Loot / Objectives",
};

const inferFallbackNodeType = (
  node: EngagementGraphNode
): AttackGraphNode["type"] => {
  const text = `${node.title} ${node.subtitle} ${node.sectionId ?? ""} ${
    node.itemId ?? ""
  }`.toLowerCase();

  if (text.includes("credential") || text.includes("password")) return "credential";
  if (
    text.includes("loot") ||
    text.includes("flag") ||
    text.includes("user.txt") ||
    text.includes("root.txt")
  ) {
    return "loot";
  }
  if (text.includes("session") || text.includes("shell") || text.includes("foothold")) {
    return "session";
  }
  if (text.includes("service") || text.includes("port ") || text.includes("nmap")) {
    return "service";
  }
  if (text.includes("host") || /\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(text)) {
    return "host";
  }
  if (
    text.includes("finding") ||
    text.includes("privesc") ||
    text.includes("privilege") ||
    text.includes("mitre")
  ) {
    return "finding";
  }
  return "action";
};

const toFallbackAttackGraph = ({
  projectId,
  nodes,
  edges,
  source,
}: {
  projectId: string;
  nodes: EngagementGraphNode[];
  edges: EngagementGraphEdge[];
  source?: EngagementStateSource;
}): AttackGraphData | null => {
  if (nodes.length === 0) return null;

  const nodeIds = new Set(nodes.map((node) => node.id));
  const attackNodes: AttackGraphNode[] = nodes.map((node) => {
    const phase = node.sectionId
      ? sectionPhaseLabels[node.sectionId] ?? node.sectionId
      : "Observed Activity";

    return {
      id: node.id,
      projectId,
      type: inferFallbackNodeType(node),
      label: node.title,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: source === "stored" ? "user" : "rule",
      confidence: node.status === "failure" ? 0.45 : 0.85,
      sourceStepIds: [node.id],
      tags: ["derived", phase],
      notes: node.subtitle,
      position: null,
      meta: {
        title: node.subtitle,
        phase,
        section_id: node.sectionId ?? null,
        item_id: node.itemId ?? null,
        derived_source: source ?? "derived",
        engagement_node_type: node.type,
        engagement_status: node.status ?? null,
      },
    };
  });

  const attackEdges: AttackGraphEdge[] = edges
    .filter((edge) => nodeIds.has(edge.sourceId) && nodeIds.has(edge.targetId))
    .map((edge) => ({
      id: edge.id,
      projectId,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      kind: "related_to",
      sourceStepId: edge.sourceId,
      command: null,
      tool: null,
      createdAt: timestamp,
      confidence: edge.branch === "failure" ? 0.45 : 0.8,
      label: edge.kind === "phase-transition" ? "phase transition" : null,
      meta: {
        derived_source: source ?? "derived",
        engagement_edge_kind: edge.kind ?? "sequence",
        engagement_branch: edge.branch ?? null,
      },
    }));

  return {
    projectId,
    source: source ?? "derived",
    nodes: attackNodes,
    edges: attackEdges,
    scenarios: [],
    activeScenarioId: null,
  };
};

export function AttackGraph({
  projectId,
  isCollapsed = false,
  onToggle,
  nodes = [],
  edges = [],
  source,
  selectedGraphNodeId = null,
  selectedGraphEdgeId = null,
  comparisonOverlay = null,
  onSendEvidenceToAI,
  onAddEvidenceToReport,
  onOpenReportEvidence,
}: AttackGraphProps) {
  const { graph } = useProjectGraph(projectId);
  const fallbackGraph = useMemo(
    () =>
      projectId
        ? toFallbackAttackGraph({
            projectId,
            nodes,
            edges,
            source,
          })
        : null,
    [edges, nodes, projectId, source]
  );
  const visibleNodeCount =
    graph.nodes.length > 0 ? graph.nodes.length : fallbackGraph?.nodes.length ?? 0;

  if (isCollapsed) {
    return (
      <button
        type="button"
        className="flex h-9 w-full items-center justify-between border-t border-border bg-card-dark px-4 text-left transition-colors hover:bg-bg-tertiary"
        onClick={onToggle}
        aria-label="Expand attack graph"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Maximize2 className="h-4 w-4 text-cyan-300" />
          Attack Graph v2
          <span className="ml-2 rounded bg-surface-highlight px-1.5 py-0.5 text-xs font-normal text-text-muted">
            {visibleNodeCount} Nodes
          </span>
        </div>
      </button>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="flex h-16 w-full items-center justify-center border-t border-border bg-card-dark text-sm text-slate-400">
          Loading attack graph...
        </div>
      }
    >
      <AttackGraphPanel
        key={projectId ?? "no-project"}
        projectId={projectId}
        isCollapsed={isCollapsed}
        onToggle={onToggle}
        selectedGraphNodeId={selectedGraphNodeId}
        selectedGraphEdgeId={selectedGraphEdgeId}
        fallbackGraph={fallbackGraph}
        comparisonOverlay={comparisonOverlay}
        onSendEvidenceToAI={onSendEvidenceToAI}
        onAddEvidenceToReport={onAddEvidenceToReport}
        onOpenReportEvidence={onOpenReportEvidence}
      />
    </Suspense>
  );
}
