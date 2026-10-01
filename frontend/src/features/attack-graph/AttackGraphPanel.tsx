import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  Background,
  Controls,
  MarkerType,
  type Node,
  type NodeProps,
  type NodeMouseHandler,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
} from "@xyflow/react";
import { useQuery } from "@tanstack/react-query";
import { GripHorizontal, Lock, Maximize2, Minimize2, Unlock } from "lucide-react";

import { aiApi } from "@/api/ai";
import { fetchReportEvidenceUsage, reportQueryKeys } from "@/api/report";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CommandHistory } from "@/types/ai";
import type {
  CreateReportProposalPayload,
  CreateReportProposalResponse,
  ReportEvidenceUsageItem,
  ReportEvidenceUsageTarget,
} from "@/types/report";
import { useProjectGraph } from "./useProjectGraph";
import { layoutAttackGraph, ATTACK_GRAPH_NODE_WIDTH, ATTACK_GRAPH_NODE_HEIGHT } from "./layout";
import { TypedGraphNode } from "./TypedGraphNode";
import { GraphSearchPalette } from "./GraphSearchPalette";
import type {
  AttackGraphComparisonOverlay,
  AttackGraphComparisonState,
  AttackGraphData,
  AttackGraphEdge,
  AttackGraphNode,
  AttackGraphPosition,
  AttackGraphProposal,
} from "./types";

const typeOrder: AttackGraphNode["type"][] = [
  "host",
  "service",
  "credential",
  "session",
  "finding",
  "loot",
  "user",
  "action",
  "artifact",
];

const edgeLabels: Record<AttackGraphEdge["kind"], string> = {
  runs_on: "runs on",
  discovered_by: "discovered by",
  exploited_via: "exploited via",
  obtained: "obtained",
  authenticates_to: "authenticates to",
  opens_session_on: "opens session",
  escalated_to: "escalated to",
  pivots_to: "pivots to",
  in_network: "same network",
  related_to: "related",
  member_of: "member of",
};

const emptyPath = { nodeIds: [], edgeIds: [] };
const dragUnlockStoragePrefix = "pwnpilot:project:";
const DEFAULT_PANEL_HEIGHT = 512;
const MIN_PANEL_HEIGHT = 260;
const ALL_SCENARIOS_VALUE = "__all__";
const PHASE_GROUP_X_TOLERANCE = 180;
const PHASE_HEADER_Y_OFFSET = 72;
const PHASE_HEADER_MIN_Y = 28;
type GraphFlowNode = Node<{
  node: AttackGraphNode;
  highlighted: boolean;
  isDropAnimating?: boolean;
  comparisonState?: AttackGraphComparisonState;
}, "typed">;

type PhaseHeaderFlowNode = Node<{
  label: string;
  count: number;
}, "phaseHeader">;

type AttackGraphFlowNode = GraphFlowNode | PhaseHeaderFlowNode;

type HistoryEvidenceLink = {
  commandId: string;
  command: string | null;
  tool: string | null;
};

type HistoryEvidenceDetailState = {
  signature: string;
  commandsById: Record<string, CommandHistory | null>;
};

type ReportEvidenceActionStatus = "pending" | "added" | "duplicate" | "error";

type ReportEvidenceActionState = {
  status: ReportEvidenceActionStatus;
  proposalId?: string | null;
  proposalStatus?: string | null;
  patchId?: string | null;
};

function getComparisonState(
  id: string,
  addedIds: Set<string>,
  removedIds: Set<string>,
): AttackGraphComparisonState | undefined {
  if (addedIds.has(id)) return "added";
  if (removedIds.has(id)) return "removed";
  return undefined;
}

function formatComparisonRevisionLabel(
  overlay: AttackGraphComparisonOverlay,
): string {
  if (overlay.baseRevision !== null && overlay.targetRevision !== null) {
    return `Revision ${overlay.baseRevision} -> ${overlay.targetRevision}`;
  }
  return "Report bundle delta";
}

function hasComparisonDelta(overlay: AttackGraphComparisonOverlay | null): boolean {
  if (!overlay) return false;
  return (
    overlay.addedNodeIds.length > 0 ||
    overlay.removedNodeIds.length > 0 ||
    overlay.addedEdgeIds.length > 0 ||
    overlay.removedEdgeIds.length > 0
  );
}

function mergeComparisonSnapshots<T extends { id: string }>(
  currentItems: T[],
  snapshotGroups: Array<T[] | undefined>,
): T[] {
  const existingIds = new Set(currentItems.map((item) => item.id));
  const mergedItems = [...currentItems];

  for (const snapshots of snapshotGroups) {
    for (const snapshot of snapshots ?? []) {
      if (existingIds.has(snapshot.id)) continue;
      existingIds.add(snapshot.id);
      mergedItems.push(snapshot);
    }
  }

  return mergedItems;
}

const phaseObjectiveTerms = [
  "flag",
  "root.txt",
  "user.txt",
  "loot",
  "proof",
  "objective",
];

const phasePrivEscTerms = [
  "privesc",
  "privilege escalation",
  "cap_setuid",
  "sudo",
  "setuid",
  "linpeas",
  "getcap",
  "root session",
  "root@",
  "root shell",
];

const phaseLateralTerms = [
  "pivot",
  "lateral",
  "rdesktop",
  "smb",
  "winrm",
  "rdp",
  "psexec",
];

function PhaseHeaderNode({ data }: NodeProps<PhaseHeaderFlowNode>) {
  return (
    <div className="pointer-events-none min-w-[180px] rounded-full border border-cyan-400/25 bg-slate-950/85 px-4 py-2 text-center shadow-[0_0_0_1px_rgba(14,165,233,0.08)] backdrop-blur-sm">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
        {data.label}
      </div>
      <div className="mt-1 text-[11px] text-slate-400">
        {data.count} node{data.count === 1 ? "" : "s"}
      </div>
    </div>
  );
}

const nodeTypes = {
  typed: TypedGraphNode,
  phaseHeader: PhaseHeaderNode,
};

type StableLayoutInput = {
  nodes: AttackGraphNode[];
  edges: AttackGraphEdge[];
};

function clampPanelHeight(nextHeight: number): number {
  const viewportHeight =
    typeof window === "undefined" ? DEFAULT_PANEL_HEIGHT + 200 : window.innerHeight;
  const maxHeight = Math.max(DEFAULT_PANEL_HEIGHT, viewportHeight - 120);
  return Math.min(Math.max(nextHeight, MIN_PANEL_HEIGHT), maxHeight);
}

function readStoredDragUnlock(storageKey: string | null): boolean {
  if (!storageKey || typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(storageKey) === "true";
  } catch {
    return false;
  }
}

function createLayoutInputStabilizer() {
  let lastSignature: string | null = null;
  let lastValue: StableLayoutInput = {
    nodes: [],
    edges: [],
  };

  return (
    signature: string,
    nodes: AttackGraphNode[],
    edges: AttackGraphEdge[]
  ): StableLayoutInput => {
    if (signature !== lastSignature) {
      lastSignature = signature;
      lastValue = { nodes, edges };
    }

    return lastValue;
  };
}

function normalizePhaseText(value: string | null | undefined): string {
  return value?.toLowerCase().trim() ?? "";
}

function nodePhaseText(node: AttackGraphNode): string {
  return [
    node.label,
    node.notes,
    node.meta.command,
    node.meta.title,
    node.meta.description,
    node.meta.kind,
    node.meta.path,
    node.meta.value_masked,
    node.meta.phase,
    node.meta.hostname,
    node.meta.service_name,
  ]
    .map((value) =>
      value === undefined || value === null ? "" : String(value)
    )
    .join(" ")
    .toLowerCase();
}

function includesPhaseTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function inferPhaseHeaderLabel(
  nodes: AttackGraphNode[],
  groupIndex: number,
  groupCount: number
): string {
  const types = new Set(nodes.map((node) => node.type));
  const combinedText = nodes.map((node) => nodePhaseText(node)).join(" ");
  const hasObjectiveSignals =
    includesPhaseTerm(combinedText, phaseObjectiveTerms) || types.has("loot");
  const hasPrivEscSignals =
    includesPhaseTerm(combinedText, phasePrivEscTerms) ||
    nodes.some((node) => {
      if (node.type !== "session") {
        return false;
      }
      const privilege = normalizePhaseText(String(node.meta.privilege ?? ""));
      return privilege === "root" || privilege === "system" || privilege === "administrator";
    }) ||
    (types.has("finding") &&
      nodes.some(
        (node) => normalizePhaseText(String(node.meta.severity ?? "")) === "high"
      ));
  const hasSession = types.has("session");
  const hasCredential = types.has("credential") || types.has("user");
  const allNodesAreObjectiveAdjacency = nodes.every((node) =>
    node.type === "loot" || node.type === "action" || node.type === "artifact"
  );

  if (hasPrivEscSignals) {
    return "Privilege Escalation";
  }
  if (includesPhaseTerm(combinedText, phaseLateralTerms)) {
    return "Lateral Movement";
  }
  if (hasSession) {
    return "Foothold";
  }
  if (hasCredential) {
    return "Credential Access";
  }
  if (
    hasObjectiveSignals &&
    (groupIndex === groupCount - 1 || allNodesAreObjectiveAdjacency)
  ) {
    return "Loot / Objectives";
  }
  if (groupIndex === 0) {
    return "Enumeration";
  }
  if (hasObjectiveSignals || groupIndex === groupCount - 1) {
    return "Loot / Objectives";
  }
  return "Enumeration";
}

function buildPhaseHeaderNodes(
  baseNodes: GraphFlowNode[]
): PhaseHeaderFlowNode[] {
  if (baseNodes.length === 0) {
    return [];
  }

  const sortedNodes = [...baseNodes].sort((a, b) => a.position.x - b.position.x);
  const groups: Array<{
    x: number;
    minY: number;
    nodes: GraphFlowNode[];
  }> = [];

  for (const node of sortedNodes) {
    const currentGroup = groups.at(-1);
    if (
      !currentGroup ||
      Math.abs(node.position.x - currentGroup.x) > PHASE_GROUP_X_TOLERANCE
    ) {
      groups.push({
        x: node.position.x,
        minY: node.position.y,
        nodes: [node],
      });
      continue;
    }

    currentGroup.nodes.push(node);
    currentGroup.minY = Math.min(currentGroup.minY, node.position.y);
  }

  return groups.map((group, index) => ({
    id: `phase-header-${index}`,
    type: "phaseHeader",
    position: {
      x: group.x,
      y: Math.max(PHASE_HEADER_MIN_Y, group.minY - PHASE_HEADER_Y_OFFSET),
    },
    data: {
      label: inferPhaseHeaderLabel(
        group.nodes.map((node) => node.data.node),
        index,
        groups.length
      ),
      count: group.nodes.length,
    },
    draggable: false,
    selectable: false,
  }));
}

function isPinnedPositionCorrupted(
  node: AttackGraphNode,
  totalNodes: number
): boolean {
  if (node.meta.position_pinned !== true || !node.position) {
    return false;
  }

  const horizontalLimit = Math.max(
    totalNodes * (ATTACK_GRAPH_NODE_WIDTH + 120),
    4000
  );
  const verticalLimit = Math.max(
    totalNodes * (ATTACK_GRAPH_NODE_HEIGHT + 120),
    3000
  );

  return (
    Math.abs(node.position.x) > horizontalLimit ||
    Math.abs(node.position.y) > verticalLimit
  );
}

function sanitizeGraphNodePosition(
  node: AttackGraphNode,
  totalNodes: number
): AttackGraphNode {
  if (!isPinnedPositionCorrupted(node, totalNodes)) {
    return node;
  }

  return {
    ...node,
    position: null,
    meta: {
      ...node.meta,
      position_pinned: false,
    },
  };
}

function formatMeta(node: AttackGraphNode): Array<[string, string]> {
  const meta = node.meta;
  if (node.type === "host") {
    return [
      ["IP", String(meta.ip ?? "n/a")],
      ["Hostname", String(meta.hostname ?? "n/a")],
      ["OS", String(meta.os ?? "n/a")],
      [
        "Open ports",
        Array.isArray(meta.ports_open) ? meta.ports_open.join(", ") : "n/a",
      ],
    ];
  }
  if (node.type === "service") {
    return [
      ["Port", String(meta.port ?? "n/a")],
      ["Service", String(meta.service_name ?? "n/a")],
      ["Product", String(meta.product ?? "n/a")],
    ];
  }
  if (node.type === "credential") {
    return [
      ["Username", String(meta.username ?? "n/a")],
      ["Domain", String(meta.domain ?? "n/a")],
      ["Secret", String(meta.password_masked ?? "masked")],
    ];
  }
  if (node.type === "session") {
    return [
      ["User", String(meta.user ?? "n/a")],
      ["Privilege", String(meta.privilege ?? "n/a")],
      ["Shell", String(meta.shell_type ?? "n/a")],
    ];
  }
  if (node.type === "finding") {
    return [
      ["Severity", String(meta.severity ?? "n/a")],
      ["Title", String(meta.title ?? node.label)],
      ["Description", String(meta.description ?? "n/a")],
    ];
  }
  if (node.type === "loot") {
    return [
      ["Kind", String(meta.kind ?? "n/a")],
      ["Value", String(meta.value_masked ?? "n/a")],
      ["Location", String(meta.location ?? "n/a")],
    ];
  }
  if (node.type === "user") {
    return [
      ["Username", String(meta.username ?? "n/a")],
      ["Domain", String(meta.domain ?? "n/a")],
      ["Group", String(meta.group ?? "n/a")],
    ];
  }
  if (node.type === "action") {
    return [
      ["Tool", String(meta.tool ?? "n/a")],
      ["Phase", String(meta.phase ?? "n/a")],
      ["Command", String(meta.command ?? node.label)],
    ];
  }
  if (node.type === "artifact") {
    return [
      ["Kind", String(meta.kind ?? "n/a")],
      ["Path", String(meta.path ?? "n/a")],
      ["Description", String(meta.description ?? "n/a")],
    ];
  }
  return [];
}

function normalizeCommandId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function collectNodeHistoryEvidence(
  node: AttackGraphNode,
  edges: AttackGraphEdge[]
): HistoryEvidenceLink[] {
  const byCommandId = new Map<string, HistoryEvidenceLink>();

  const addCommand = (
    commandId: string | null | undefined,
    evidence?: Pick<AttackGraphEdge, "command" | "tool">
  ) => {
    const normalizedCommandId = normalizeCommandId(commandId);
    if (!normalizedCommandId) return;

    const current = byCommandId.get(normalizedCommandId);
    byCommandId.set(normalizedCommandId, {
      commandId: normalizedCommandId,
      command: current?.command ?? evidence?.command ?? null,
      tool: current?.tool ?? evidence?.tool ?? null,
    });
  };

  node.sourceStepIds.forEach((commandId) => addCommand(commandId));
  edges.forEach((edge) => {
    if (edge.sourceId !== node.id && edge.targetId !== node.id) return;
    addCommand(edge.sourceStepId, edge);
  });

  return Array.from(byCommandId.values());
}

function getHistoryCommandHref(projectId: string, commandId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/timeline?commandId=${encodeURIComponent(commandId)}`;
}

function formatCommandDuration(durationMs: number | null | undefined): string {
  if (durationMs == null) return "n/a";
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function getCommandOutputPreview(command: CommandHistory | null): string | null {
  const output = command?.output_preview ?? command?.output ?? null;
  const trimmed = output?.trim();
  if (!trimmed) return null;
  return trimmed.length > 420 ? `${trimmed.slice(0, 420)}...` : trimmed;
}

function buildGraphEvidencePrompt({
  node,
  evidence,
  command,
}: {
  node: AttackGraphNode;
  evidence: HistoryEvidenceLink;
  command: CommandHistory | null;
}): string {
  const commandText = command?.command ?? evidence.command ?? evidence.commandId;
  const lines = [
    "Attack graph evidence",
    `Node: ${node.label} (${node.type})`,
    `Command ID: ${evidence.commandId}`,
    `Command: ${commandText}`,
  ];

  if (command) {
    lines.push(
      `Exit code: ${command.exit_code}`,
      `Duration: ${formatCommandDuration(command.duration_ms)}`,
      `Session: ${command.session_name ?? command.session_id}`,
      `CWD: ${command.cwd}`,
      `Source: ${command.source}`
    );
  } else if (evidence.tool) {
    lines.push(`Tool: ${evidence.tool}`);
  }

  const outputPreview = getCommandOutputPreview(command);
  if (outputPreview) {
    lines.push("Output preview:", "```", outputPreview, "```");
  }

  return lines.join("\n");
}

function textIncludesAny(value: string, terms: string[]): boolean {
  const lower = value.toLowerCase();
  return terms.some((term) => lower.includes(term));
}

function getGraphEvidenceSearchText({
  node,
  evidence,
  command,
}: {
  node: AttackGraphNode;
  evidence: HistoryEvidenceLink;
  command: CommandHistory | null;
}): string {
  return [
    node.label,
    node.type,
    node.notes,
    node.tags.join(" "),
    Object.values(node.meta).map(String).join(" "),
    evidence.command,
    evidence.tool,
    command?.command,
    command?.output_preview,
    command?.output,
  ]
    .filter(Boolean)
    .join(" ");
}

function inferReportSectionHint({
  node,
  evidence,
  command,
}: {
  node: AttackGraphNode;
  evidence: HistoryEvidenceLink;
  command: CommandHistory | null;
}): string {
  const text = getGraphEvidenceSearchText({ node, evidence, command });

  if (
    node.type === "loot" ||
    textIncludesAny(text, ["user.txt", "root.txt", "flag", "proof", "loot"])
  ) {
    return "flags_evidence";
  }

  if (
    textIncludesAny(text, [
      "privesc",
      "privilege escalation",
      "cap_setuid",
      "getcap",
      "sudo",
      "setuid",
      "root shell",
      "root@",
    ])
  ) {
    return "privilege_escalation";
  }

  if (
    node.type === "credential" ||
    textIncludesAny(text, ["credential", "password", "login", "ssh session", "ftp"])
  ) {
    return "foothold";
  }

  if (
    node.type === "host" ||
    node.type === "service" ||
    textIncludesAny(text, ["nmap", "ffuf", "gobuster", "dirsearch", "whatweb", "dns", "enum"])
  ) {
    return "enumeration";
  }

  if (node.type === "session") {
    return "foothold";
  }

  return "attack_path";
}

function buildGraphEvidenceReportPayload({
  node,
  evidence,
  command,
}: {
  node: AttackGraphNode;
  evidence: HistoryEvidenceLink;
  command: CommandHistory | null;
}): CreateReportProposalPayload {
  const commandText = command?.command ?? evidence.command ?? evidence.commandId;
  const outputPreview = getCommandOutputPreview(command);
  const lines = [
    `### ${node.label} evidence`,
    "",
    `- Attack graph node: \`${node.label}\` (\`${node.type}\`)`,
    `- Command ID: \`${evidence.commandId}\``,
    `- Command: \`${commandText}\``,
  ];

  if (command) {
    lines.push(
      `- Exit code: \`${command.exit_code}\``,
      `- Duration: \`${formatCommandDuration(command.duration_ms)}\``,
      `- Session: \`${command.session_name ?? command.session_id}\``,
      `- Working directory: \`${command.cwd}\``
    );
  } else if (evidence.tool) {
    lines.push(`- Tool: \`${evidence.tool}\``);
  }

  if (outputPreview) {
    lines.push("", "```text", outputPreview, "```");
  }

  return {
    sectionHint: inferReportSectionHint({ node, evidence, command }),
    triggerType: "graph_evidence",
    summary: `Add ${node.label} evidence from ${commandText}`,
    contentMd: lines.join("\n"),
    evidence: [
      { sourceType: "command_history", sourceId: evidence.commandId },
      { sourceType: "graph_node", sourceId: node.id },
    ],
  };
}

function formatProposalCounts(proposal: AttackGraphProposal): string {
  const nodeCount = proposal.payload.nodes.length;
  const edgeCount = proposal.payload.edges.length;
  const nodeLabel = nodeCount === 1 ? "node" : "nodes";
  const edgeLabel = edgeCount === 1 ? "edge" : "edges";
  return `${nodeCount} ${nodeLabel}, ${edgeCount} ${edgeLabel}`;
}

function GraphProposalQueue({
  proposals,
  isLoading,
  acceptingProposalId,
  onAccept,
}: {
  proposals: AttackGraphProposal[];
  isLoading: boolean;
  acceptingProposalId: string | null;
  onAccept: (proposalId: string) => Promise<unknown>;
}) {
  return (
    <div className="mt-6 rounded-xl border border-white/10 bg-slate-950/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
            Pending Proposals
          </div>
          <div className="mt-2 text-sm text-slate-200">
            {isLoading ? "Loading..." : `${proposals.length} ready from History`}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="mt-3 text-sm text-slate-400">Loading graph proposals...</div>
      ) : proposals.length === 0 ? (
        <div className="mt-3 text-sm text-slate-400">
          No pending graph proposals from History yet.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {proposals.map((proposal) => {
            const isAccepting = acceptingProposalId === proposal.id;
            return (
              <div
                key={proposal.id}
                className="rounded-lg border border-white/10 bg-white/5 p-3"
              >
                <div className="text-sm font-semibold text-white">
                  {proposal.title ?? "History graph proposal"}
                </div>
                {proposal.summary ? (
                  <div className="mt-2 text-sm text-slate-300">{proposal.summary}</div>
                ) : null}
                <div className="mt-2 text-xs text-slate-400">
                  {formatProposalCounts(proposal)}
                  {proposal.sourceId ? ` | source ${proposal.sourceId}` : ""}
                </div>
                <div className="mt-3">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={acceptingProposalId !== null}
                    onClick={() => void onAccept(proposal.id)}
                    aria-label={`Accept proposal ${proposal.title ?? proposal.id}`}
                  >
                    {isAccepting ? "Accepting..." : "Accept proposal"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AttackGraphContent({
  projectId,
  dragUnlocked,
  dragResetRef,
  selectedGraphNodeId,
  selectedGraphEdgeId,
  fallbackGraph,
  comparisonOverlay,
  onSendEvidenceToAI,
  onAddEvidenceToReport,
  onOpenReportEvidence,
}: {
  projectId?: string;
  dragUnlocked: boolean;
  dragResetRef: MutableRefObject<(() => void) | null>;
  selectedGraphNodeId?: string | null;
  selectedGraphEdgeId?: string | null;
  fallbackGraph?: AttackGraphData | null;
  comparisonOverlay?: AttackGraphComparisonOverlay | null;
  onSendEvidenceToAI?: (text: string) => void;
  onAddEvidenceToReport?: (
    payload: CreateReportProposalPayload
  ) => Promise<CreateReportProposalResponse>;
  onOpenReportEvidence?: (target: ReportEvidenceUsageTarget) => void;
}) {
  const {
    graph: canonicalGraph,
    isLoading,
    error,
    proposals,
    isProposalsLoading,
    seedDemoCtf,
    isSeeding,
    loadShortestPath,
    isPathLoading,
    pathResult,
    acceptingProposalId,
    acceptProposal,
    updateNodePosition,
  } = useProjectGraph(projectId);
  const graph =
    canonicalGraph.nodes.length > 0 ? canonicalGraph : fallbackGraph ?? canonicalGraph;
  const isUsingFallbackGraph =
    canonicalGraph.nodes.length === 0 && (fallbackGraph?.nodes.length ?? 0) > 0;
  const effectiveDragUnlocked = dragUnlocked && !isUsingFallbackGraph;
  const { fitView, setCenter, setNodes: setRfNodes } = useReactFlow();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [selectedNodeIdOverride, setSelectedNodeIdOverride] = useState<
    string | null
  >(null);
  const [scenarioSelection, setScenarioSelection] = useState<string | null>(null);
  const [visibleTypes, setVisibleTypes] = useState<Set<AttackGraphNode["type"]>>(
    () => new Set(typeOrder)
  );
  const [pathFrom, setPathFrom] = useState("");
  const [pathTo, setPathTo] = useState("");
  const lastFitSignature = useRef<string | null>(null);
  const [dropAnimatingNodeId, setDropAnimatingNodeId] = useState<string | null>(
    null
  );
  const [historyEvidenceDetails, setHistoryEvidenceDetails] =
    useState<HistoryEvidenceDetailState>({
      signature: "",
      commandsById: {},
    });
  const [reportEvidenceStateByCommandId, setReportEvidenceStateByCommandId] =
    useState<Record<string, ReportEvidenceActionState>>({});
  const [comparisonOnlyChangedRequested, setComparisonOnlyChangedRequested] =
    useState(false);
  const dropAnimationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const hasActiveComparisonOverlay = hasComparisonDelta(comparisonOverlay ?? null);
  const comparisonOnlyChanged =
    hasActiveComparisonOverlay && comparisonOnlyChangedRequested;
  const comparisonSets = useMemo(
    () => ({
      addedNodeIds: new Set(comparisonOverlay?.addedNodeIds ?? []),
      removedNodeIds: new Set(comparisonOverlay?.removedNodeIds ?? []),
      addedEdgeIds: new Set(comparisonOverlay?.addedEdgeIds ?? []),
      removedEdgeIds: new Set(comparisonOverlay?.removedEdgeIds ?? []),
    }),
    [comparisonOverlay],
  );
  const graphNodes = useMemo(
    () =>
      mergeComparisonSnapshots(graph.nodes, [
        comparisonOverlay?.addedNodes,
        comparisonOverlay?.removedNodes,
      ]),
    [comparisonOverlay?.addedNodes, comparisonOverlay?.removedNodes, graph.nodes],
  );
  const graphEdges = useMemo(() => {
    const mergedEdges = mergeComparisonSnapshots(graph.edges, [
      comparisonOverlay?.addedEdges,
      comparisonOverlay?.removedEdges,
    ]);
    const knownNodeIds = new Set(graphNodes.map((node) => node.id));
    return mergedEdges.filter(
      (edge) => knownNodeIds.has(edge.sourceId) && knownNodeIds.has(edge.targetId)
    );
  }, [
    comparisonOverlay?.addedEdges,
    comparisonOverlay?.removedEdges,
    graph.edges,
    graphNodes,
  ]);
  const comparisonChangedNodeIds = useMemo(() => {
    const next = new Set<string>([
      ...comparisonSets.addedNodeIds,
      ...comparisonSets.removedNodeIds,
    ]);

    for (const edge of graphEdges) {
      if (
        comparisonSets.addedEdgeIds.has(edge.id) ||
        comparisonSets.removedEdgeIds.has(edge.id)
      ) {
        next.add(edge.sourceId);
        next.add(edge.targetId);
      }
    }

    return next;
  }, [comparisonSets, graphEdges]);
  const comparisonChangedEdgeIds = useMemo(
    () =>
      new Set<string>([
        ...comparisonSets.addedEdgeIds,
        ...comparisonSets.removedEdgeIds,
      ]),
    [comparisonSets],
  );
  const activeScenarioId =
    scenarioSelection === null
      ? graph.activeScenarioId
      : scenarioSelection === ALL_SCENARIOS_VALUE
        ? null
        : scenarioSelection;
  const selectedNodeId = graphNodes.some(
    (node) => node.id === selectedGraphNodeId
  )
    ? selectedGraphNodeId
    : graphNodes.some((node) => node.id === selectedNodeIdOverride)
      ? selectedNodeIdOverride
      : graphNodes[0]?.id ?? null;
  const pendingProposals = proposals.filter((proposal) => proposal.status === "pending");
  const reportEvidenceUsageQuery = useQuery({
    queryKey: projectId
      ? reportQueryKeys.evidence(projectId)
      : ["report", "evidence", "idle"],
    queryFn: () => fetchReportEvidenceUsage(projectId!),
    enabled: Boolean(projectId && onAddEvidenceToReport),
  });
  const usedReportEvidenceByKey = useMemo<Map<string, ReportEvidenceUsageItem>>(() => {
    const items = reportEvidenceUsageQuery.data?.items ?? [];
    return new Map(
      items.map((item) => [`${item.sourceType}:${item.sourceId}`, item])
    );
  }, [reportEvidenceUsageQuery.data?.items]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    return () => {
      if (dropAnimationTimeoutRef.current) {
        clearTimeout(dropAnimationTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    dragResetRef.current = () => {
      setDropAnimatingNodeId(null);
      if (dropAnimationTimeoutRef.current) {
        clearTimeout(dropAnimationTimeoutRef.current);
        dropAnimationTimeoutRef.current = null;
      }
    };

    return () => {
      dragResetRef.current = null;
    };
  }, [dragResetRef]);

  const pathSelection = pathResult ?? emptyPath;
  const externallySelectedNode = selectedGraphNodeId
    ? graphNodes.find((node) => node.id === selectedGraphNodeId) ?? null
    : null;
  const externallySelectedEdge = selectedGraphEdgeId
    ? graphEdges.find((edge) => edge.id === selectedGraphEdgeId) ?? null
    : null;
  const activeScenario =
    graph.scenarios.find((scenario) => scenario.id === activeScenarioId) ?? null;
  const effectiveVisibleTypes = useMemo(() => {
    const next = new Set(visibleTypes);
    if (externallySelectedNode) {
      next.add(externallySelectedNode.type);
    }
    if (externallySelectedEdge) {
      for (const nodeId of [
        externallySelectedEdge.sourceId,
        externallySelectedEdge.targetId,
      ]) {
        const endpoint = graphNodes.find((node) => node.id === nodeId);
        if (endpoint) {
          next.add(endpoint.type);
        }
      }
    }
    if (hasActiveComparisonOverlay) {
      for (const node of graphNodes) {
        if (comparisonChangedNodeIds.has(node.id)) {
          next.add(node.type);
        }
      }
    }
    return next;
  }, [
    comparisonChangedNodeIds,
    externallySelectedEdge,
    externallySelectedNode,
    graphNodes,
    hasActiveComparisonOverlay,
    visibleTypes,
  ]);
  const forcedVisibleNodeIds = useMemo(() => {
    const next = new Set<string>();
    if (externallySelectedNode) {
      next.add(externallySelectedNode.id);
    }
    if (externallySelectedEdge) {
      next.add(externallySelectedEdge.sourceId);
      next.add(externallySelectedEdge.targetId);
    }
    if (hasActiveComparisonOverlay) {
      for (const nodeId of comparisonChangedNodeIds) {
        next.add(nodeId);
      }
    }
    return next;
  }, [
    comparisonChangedNodeIds,
    externallySelectedEdge,
    externallySelectedNode,
    hasActiveComparisonOverlay,
  ]);

  const filteredGraph = useMemo(() => {
    const scenarioNodeIds = activeScenario ? new Set(activeScenario.nodeIds) : null;
    const scenarioEdgeIds = activeScenario ? new Set(activeScenario.edgeIds) : null;

    const filteredNodes = graphNodes.filter((node) => {
      if (
        comparisonOnlyChanged &&
        !comparisonChangedNodeIds.has(node.id) &&
        node.id !== selectedGraphNodeId
      ) {
        return false;
      }
      if (forcedVisibleNodeIds.has(node.id)) return true;
      if (!effectiveVisibleTypes.has(node.type)) return false;
      if (scenarioNodeIds && !scenarioNodeIds.has(node.id)) return false;
      return true;
    });
    const allowedNodeIds = new Set(filteredNodes.map((node) => node.id));
    const filteredEdges = graphEdges.filter((edge) => {
      if (!allowedNodeIds.has(edge.sourceId) || !allowedNodeIds.has(edge.targetId)) {
        return false;
      }
      if (edge.id === selectedGraphEdgeId) return true;
      if (comparisonOnlyChanged && !comparisonChangedEdgeIds.has(edge.id)) {
        return false;
      }
      if (scenarioEdgeIds && !scenarioEdgeIds.has(edge.id)) return false;
      return true;
    });
    return { filteredNodes, filteredEdges };
  }, [
    activeScenario,
    comparisonChangedEdgeIds,
    comparisonChangedNodeIds,
    comparisonOnlyChanged,
    effectiveVisibleTypes,
    forcedVisibleNodeIds,
    graphEdges,
    graphNodes,
    selectedGraphEdgeId,
    selectedGraphNodeId,
  ]);

  const { filteredNodes, filteredEdges } = filteredGraph;
  const sanitizedFilteredNodes = useMemo(() => {
    const totalNodes = filteredNodes.length;
    return filteredNodes.map((node) => sanitizeGraphNodePosition(node, totalNodes));
  }, [filteredNodes]);

  const [layoutPositions, setLayoutPositions] = useState<
    Record<string, AttackGraphPosition>
  >({});
  const layoutSignature = useMemo(() => {
    const nodeSignature = filteredNodes.map((node) => node.id).join("|");
    const edgeSignature = filteredEdges
      .map((edge) => `${edge.id}:${edge.sourceId}:${edge.targetId}`)
      .join("|");
    return [
      projectId ?? "no-project",
      activeScenarioId ?? "all",
      Array.from(effectiveVisibleTypes).sort().join(","),
      nodeSignature,
      edgeSignature,
    ].join("::");
  }, [
    activeScenarioId,
    effectiveVisibleTypes,
    filteredEdges,
    filteredNodes,
    projectId,
  ]);
  const getStableLayoutInput = useMemo(() => createLayoutInputStabilizer(), []);
  const stableLayoutInput = getStableLayoutInput(
    layoutSignature,
    sanitizedFilteredNodes,
    filteredEdges
  );
  const externallySelectedNodeVisible = Boolean(
    selectedGraphNodeId &&
      sanitizedFilteredNodes.some((node) => node.id === selectedGraphNodeId)
  );
  const externallySelectedEdgeVisible = Boolean(
    selectedGraphEdgeId &&
      filteredEdges.some((edge) => edge.id === selectedGraphEdgeId)
  );

  useEffect(() => {
    let cancelled = false;
    layoutAttackGraph(stableLayoutInput.nodes, stableLayoutInput.edges).then((positions) => {
      if (!cancelled) setLayoutPositions(positions);
    });
    return () => {
      cancelled = true;
    };
  }, [stableLayoutInput]);

  const jumpToNode = (nodeId: string) => {
    const pos = layoutPositions[nodeId];
    if (!pos) return;
    const cx = pos.x + ATTACK_GRAPH_NODE_WIDTH / 2;
    const cy = pos.y + ATTACK_GRAPH_NODE_HEIGHT / 2;
    setCenter(cx, cy, { zoom: 1.1, duration: 600 });
    setSelectedNodeIdOverride(nodeId);
  };

  useEffect(() => {
    if (!selectedGraphNodeId || !externallySelectedNodeVisible) return;
    const pos = layoutPositions[selectedGraphNodeId];
    if (!pos) return;

    const cx = pos.x + ATTACK_GRAPH_NODE_WIDTH / 2;
    const cy = pos.y + ATTACK_GRAPH_NODE_HEIGHT / 2;
    setCenter(cx, cy, { zoom: 1.16, duration: 650 });
  }, [
    externallySelectedNodeVisible,
    layoutPositions,
    selectedGraphNodeId,
    setCenter,
  ]);

  useEffect(() => {
    if (!selectedGraphEdgeId || !externallySelectedEdgeVisible) return;
    const edge = graphEdges.find((candidate) => candidate.id === selectedGraphEdgeId);
    if (!edge) return;
    const sourcePos = layoutPositions[edge.sourceId];
    const targetPos = layoutPositions[edge.targetId];
    if (!sourcePos || !targetPos) return;

    const cx =
      (sourcePos.x + targetPos.x) / 2 + ATTACK_GRAPH_NODE_WIDTH / 2;
    const cy =
      (sourcePos.y + targetPos.y) / 2 + ATTACK_GRAPH_NODE_HEIGHT / 2;
    setCenter(cx, cy, { zoom: 1.08, duration: 650 });
  }, [
    externallySelectedEdgeVisible,
    graphEdges,
    layoutPositions,
    selectedGraphEdgeId,
    setCenter,
  ]);

  const baseNodes = useMemo<GraphFlowNode[]>(() => {
    const highlightedNodeIds = new Set(pathSelection.nodeIds);

    return sanitizedFilteredNodes.map((node) => {
      const isExternallySelected = node.id === selectedGraphNodeId;
      const isSelected = node.id === selectedNodeId;
      const comparisonState = getComparisonState(
        node.id,
        comparisonSets.addedNodeIds,
        comparisonSets.removedNodeIds,
      );

      return {
        id: node.id,
        type: "typed",
        position:
          node.meta.position_pinned === true && node.position
            ? node.position
            : layoutPositions[node.id] ?? node.position ?? { x: 120, y: 120 },
        selected: isSelected,
        data: {
          node,
          highlighted:
            highlightedNodeIds.has(node.id) ||
            isExternallySelected ||
            forcedVisibleNodeIds.has(node.id) ||
            Boolean(comparisonState),
          isDropAnimating: false,
          comparisonState,
        },
        draggable: effectiveDragUnlocked,
        selectable: true,
      };
    });
  }, [
    sanitizedFilteredNodes,
    layoutPositions,
    effectiveDragUnlocked,
    comparisonSets.addedNodeIds,
    comparisonSets.removedNodeIds,
    pathSelection.nodeIds,
    selectedGraphNodeId,
    selectedNodeId,
    forcedVisibleNodeIds,
  ]);

  const phaseHeaderNodes = useMemo(
    () => buildPhaseHeaderNodes(baseNodes),
    [baseNodes]
  );

  const flowNodes = useMemo<AttackGraphFlowNode[]>(
    () => [...phaseHeaderNodes, ...baseNodes],
    [phaseHeaderNodes, baseNodes]
  );

  // Push external data into React Flow's internal store. React Flow owns
  // node state (via defaultNodes), so we use setRfNodes with a function
  // updater that preserves live drag positions.
  useEffect(() => {
    setRfNodes((currentRfNodes) => {
      const currentById = new Map(
        currentRfNodes.map((node) => [node.id, node])
      );
      return flowNodes.map((base) => {
        const current = currentById.get(base.id);
        const isTypedNode = base.type === "typed";
        const isDragging = isTypedNode && current?.dragging === true;
        const isDropping = isTypedNode && dropAnimatingNodeId === base.id;
        return {
          ...base,
          position:
            isDragging || isDropping
              ? current?.position ?? base.position
              : base.position,
          dragging: isDragging,
          data: {
            ...base.data,
            ...(isTypedNode ? { isDropAnimating: isDropping } : {}),
          },
        };
      });
    });
  }, [flowNodes, dropAnimatingNodeId, setRfNodes]);

  const visibleEdges = useMemo<Edge[]>(() => {
    const highlightedEdgeIds = new Set(pathSelection.edgeIds);
    return filteredEdges.map((edge) => {
      const comparisonState = getComparisonState(
        edge.id,
        comparisonSets.addedEdgeIds,
        comparisonSets.removedEdgeIds,
      );
      const isSelected = edge.id === selectedGraphEdgeId;
      const isHighlighted = highlightedEdgeIds.has(edge.id);
      const comparisonStyle =
        comparisonState === "added"
          ? {
              stroke: "#34d399",
              strokeDasharray: "7 3",
              strokeWidth: 3,
            }
          : comparisonState === "removed"
            ? {
                stroke: "#fb7185",
                strokeDasharray: "4 4",
                strokeWidth: 3,
              }
            : undefined;

      return {
        id: edge.id,
        source: edge.sourceId,
        target: edge.targetId,
        label: comparisonState
          ? `${comparisonState} · ${edgeLabels[edge.kind]}`
          : edgeLabels[edge.kind],
        labelShowBg: true,
        labelStyle: {
          fill: comparisonState === "removed" ? "#fecdd3" : "#dbeafe",
          fontSize: 11,
          fontWeight: 600,
        },
        labelBgPadding: [6, 3],
        labelBgBorderRadius: 6,
        labelBgStyle: {
          fill: "rgba(8, 17, 31, 0.92)",
          stroke:
            comparisonState === "added"
              ? "rgba(52, 211, 153, 0.55)"
              : comparisonState === "removed"
                ? "rgba(251, 113, 133, 0.55)"
                : "rgba(14, 165, 233, 0.35)",
          strokeWidth: 1,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
        },
        animated: isSelected,
        style: isSelected
          ? {
              stroke: "#f59e0b",
              strokeDasharray: "6 4",
              strokeWidth: 3,
            }
          : comparisonStyle ??
            (isHighlighted
              ? {
                  stroke: "#0ea5e9",
                  strokeWidth: 2.4,
                }
              : undefined),
      };
    });
  }, [
    comparisonSets.addedEdgeIds,
    comparisonSets.removedEdgeIds,
    filteredEdges,
    pathSelection.edgeIds,
    selectedGraphEdgeId,
  ]);

  const selectedNode =
    graphNodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedNodeHistoryEvidence = useMemo(
    () =>
      selectedNode
        ? collectNodeHistoryEvidence(selectedNode, graphEdges)
        : [],
    [graphEdges, selectedNode]
  );
  const selectedNodeHistoryEvidenceSignature = useMemo(
    () =>
      selectedNodeHistoryEvidence
        .map((item) => item.commandId)
        .sort()
        .join("|"),
    [selectedNodeHistoryEvidence]
  );
  const selectedNodeCommandDetails =
    historyEvidenceDetails.signature === selectedNodeHistoryEvidenceSignature
      ? historyEvidenceDetails.commandsById
      : {};

  useEffect(() => {
    if (!projectId || !selectedNodeHistoryEvidenceSignature) return;

    let cancelled = false;
    const commandIds = selectedNodeHistoryEvidence.map((item) => item.commandId);

    void Promise.all(
      commandIds.map(async (commandId) => {
        try {
          return [commandId, await aiApi.getCommand(projectId, commandId)] as const;
        } catch {
          return [commandId, null] as const;
        }
      })
    ).then((entries) => {
      if (cancelled) return;
      setHistoryEvidenceDetails({
        signature: selectedNodeHistoryEvidenceSignature,
        commandsById: Object.fromEntries(entries),
      });
    });

    return () => {
      cancelled = true;
    };
  }, [projectId, selectedNodeHistoryEvidence, selectedNodeHistoryEvidenceSignature]);

  const addEvidenceToReport = async ({
    node,
    evidence,
    command,
  }: {
    node: AttackGraphNode;
    evidence: HistoryEvidenceLink;
    command: CommandHistory | null;
  }) => {
    if (!onAddEvidenceToReport) return;
    const stateKey = `${projectId ?? "no-project"}:${evidence.commandId}`;

    setReportEvidenceStateByCommandId((current) => ({
      ...current,
      [stateKey]: { status: "pending" },
    }));

    try {
      const result = await onAddEvidenceToReport(
        buildGraphEvidenceReportPayload({ node, evidence, command })
      );
      const matchingEvidenceLink = result.proposal?.evidenceLinks.find(
        (link) =>
          link.sourceType === "command_history" &&
          link.sourceId === evidence.commandId
      );
      setReportEvidenceStateByCommandId((current) => ({
        ...current,
        [stateKey]: {
          status: result.duplicate ? "duplicate" : "added",
          proposalId: result.proposal?.id ?? null,
          proposalStatus: result.proposal?.status ?? null,
          patchId:
            matchingEvidenceLink?.patchId ??
            result.proposal?.sectionPatches[0]?.id ??
            null,
        },
      }));
    } catch {
      setReportEvidenceStateByCommandId((current) => ({
        ...current,
        [stateKey]: { status: "error" },
      }));
    }
  };

  const handleNodeDragStop: NodeMouseHandler<AttackGraphFlowNode> = (
    _event,
    node
  ) => {
    if (!effectiveDragUnlocked || node.type !== "typed") return;
    const position = {
      x: Math.round(node.position.x),
      y: Math.round(node.position.y),
    };
    if (dropAnimationTimeoutRef.current) {
      clearTimeout(dropAnimationTimeoutRef.current);
    }
    setDropAnimatingNodeId(node.id);
    dropAnimationTimeoutRef.current = setTimeout(() => {
      setDropAnimatingNodeId((current) =>
        current === node.id ? null : current
      );
    }, 320);
    void updateNodePosition(node.id, position);
  };

  useEffect(() => {
    if (flowNodes.length === 0) return;

    const signature = [
      activeScenarioId ?? "all",
      flowNodes.length,
      visibleEdges.length,
      pathSelection.nodeIds.length,
      pathSelection.edgeIds.length,
      Array.from(effectiveVisibleTypes).sort().join(","),
    ].join("|");

    if (
      lastFitSignature.current === signature ||
      externallySelectedNodeVisible ||
      externallySelectedEdgeVisible
    ) {
      return;
    }
    lastFitSignature.current = signature;

    requestAnimationFrame(() => {
      fitView({ padding: 0.2, duration: 450 });
    });
  }, [
    activeScenarioId,
    fitView,
    flowNodes.length,
    externallySelectedEdgeVisible,
    externallySelectedNodeVisible,
    pathSelection.edgeIds.length,
    pathSelection.nodeIds.length,
    visibleEdges.length,
    effectiveVisibleTypes,
  ]);

  if (!projectId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
        Attack graph unavailable without a project.
      </div>
    );
  }

  if (error && !isUsingFallbackGraph) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="rounded-xl border border-rose-500/30 bg-slate-950/90 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      </div>
    );
  }

  if (isLoading && !isUsingFallbackGraph) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
        Loading attack graph...
      </div>
    );
  }

  if (graphNodes.length === 0) {
    return (
      <div className="flex min-h-0 flex-1">
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-xl rounded-2xl border border-white/10 bg-slate-950/90 p-6 shadow-xl">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">
              Attack Graph v2
            </div>
            <h3 className="mt-3 text-xl font-semibold text-white">
              {pendingProposals.length > 0
                ? "Review pending history proposals"
                : "Seed a realistic CTF workspace"}
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {pendingProposals.length > 0
                ? "History has already produced graph proposals. Accept them from the side panel to materialize the first nodes and edges in the canonical graph."
                : "This seeds command history, timeline notes, AI context, knowledge docs, and the typed attack graph for a full demo engagement."}
            </p>
            <div className="mt-5">
              <Button
                type="button"
                onClick={() => void seedDemoCtf()}
                disabled={isSeeding}
              >
                {isSeeding ? "Seeding..." : "Seed realistic CTF workspace"}
              </Button>
            </div>
          </div>
        </div>
        <aside className="flex w-[320px] shrink-0 flex-col bg-[#111827] p-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
              Graph Summary
            </div>
          <div className="mt-2 text-sm text-slate-200">0 nodes, 0 edges</div>
          </div>
          <GraphProposalQueue
            proposals={pendingProposals}
            isLoading={isProposalsLoading}
            acceptingProposalId={acceptingProposalId}
            onAccept={acceptProposal}
          />
        </aside>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden border-r border-white/10 bg-[#0e1522]">
        <div className="flex flex-wrap items-center gap-3 border-b border-white/10 bg-slate-950/60 px-4 py-3">
          <div className="min-w-[220px]">
            <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
              Scenario
            </div>
            <div className="mt-1 text-sm font-medium text-white">
              {activeScenario?.name ?? "Full project graph"}
            </div>
          </div>

          {graph.scenarios.length > 0 ? (
            <label className="text-xs text-slate-300">
              <span className="sr-only">Scenario</span>
              <select
                aria-label="Scenario"
                className="h-9 rounded-md border border-white/10 bg-slate-900 px-3 text-sm text-white"
                value={activeScenarioId ?? ALL_SCENARIOS_VALUE}
                onChange={(event) =>
                  setScenarioSelection(
                    event.target.value === ALL_SCENARIOS_VALUE
                      ? ALL_SCENARIOS_VALUE
                      : event.target.value
                  )
                }
              >
                <option value={ALL_SCENARIOS_VALUE}>All nodes</option>
                {graph.scenarios.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="text-xs text-slate-300">
            <span className="sr-only">Path from</span>
            <select
              aria-label="Path from"
              className="h-9 rounded-md border border-white/10 bg-slate-900 px-3 text-sm text-white"
              value={pathFrom}
              onChange={(event) => setPathFrom(event.target.value)}
            >
              <option value="">Path from</option>
              {graph.nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-slate-300">
            <span className="sr-only">Path to</span>
            <select
              aria-label="Path to"
              className="h-9 rounded-md border border-white/10 bg-slate-900 px-3 text-sm text-white"
              value={pathTo}
              onChange={(event) => setPathTo(event.target.value)}
            >
              <option value="">Path to</option>
              {graph.nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.label}
                </option>
              ))}
            </select>
          </label>

          <Button
            type="button"
            variant="secondary"
            disabled={isUsingFallbackGraph || !pathFrom || !pathTo || isPathLoading}
            onClick={() => void loadShortestPath(pathFrom, pathTo)}
          >
            {isPathLoading ? "Loading path..." : "Highlight shortest path"}
          </Button>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="ml-auto flex h-9 items-center gap-2 rounded-md border border-[#252b3a] bg-[#0b0f17] px-3 text-xs text-slate-400 hover:border-primary/40 hover:text-primary transition-colors"
            title="Search graph nodes (Ctrl+K)"
          >
            <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            Search
            <kbd className="ml-1 rounded border border-[#252b3a] bg-[#121722] px-1.5 py-0.5 font-mono text-[9px] text-slate-500">
              Ctrl+K
            </kbd>
          </button>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-white/10 bg-slate-950/40 px-4 py-2">
          {typeOrder.map((type) => {
            const enabled = effectiveVisibleTypes.has(type);
            return (
              <button
                key={type}
                type="button"
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  enabled
                    ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-200"
                    : "border-white/10 bg-white/5 text-slate-400"
                )}
                onClick={() =>
                  setVisibleTypes((prev) => {
                    const next = new Set(prev);
                    if (next.has(type)) {
                      next.delete(type);
                    } else {
                      next.add(type);
                    }
                    return next;
                  })
                }
              >
                {type}
              </button>
            );
          })}
        </div>

        {hasActiveComparisonOverlay && comparisonOverlay ? (
          <div className="flex flex-wrap items-center gap-3 border-b border-emerald-400/10 bg-emerald-500/5 px-4 py-3">
            <div className="min-w-[220px]">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-200">
                Report Bundle Comparison
              </div>
              <div className="mt-1 text-xs text-slate-300">
                {formatComparisonRevisionLabel(comparisonOverlay)}
              </div>
            </div>
            <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-100">
              {comparisonOverlay.addedNodeIds.length} added
            </span>
            <span className="rounded-full border border-rose-400/25 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold text-rose-100">
              {comparisonOverlay.removedNodeIds.length} removed
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300">
              {comparisonOverlay.addedEdgeIds.length} added edge
              {comparisonOverlay.addedEdgeIds.length === 1 ? "" : "s"}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300">
              {comparisonOverlay.removedEdgeIds.length} removed edge
              {comparisonOverlay.removedEdgeIds.length === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              onClick={() =>
                setComparisonOnlyChangedRequested((current) => !current)
              }
              aria-label={
                comparisonOnlyChanged
                  ? "Show all graph elements"
                  : "Show only changed graph elements"
              }
              className={cn(
                "ml-auto rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors",
                comparisonOnlyChanged
                  ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-100"
                  : "border-white/10 bg-slate-950/60 text-slate-300 hover:border-emerald-400/30 hover:text-emerald-100",
              )}
            >
              Only changed
            </button>
          </div>
        ) : null}

        <div className="min-h-0 flex-1">
          <ReactFlow
            defaultNodes={[]}
            edges={visibleEdges}
            nodeTypes={nodeTypes}
            autoPanOnNodeDrag={false}
            onNodeClick={(_, node) => {
              if (node.type === "typed") {
                setSelectedNodeIdOverride(node.id);
              }
            }}
            onNodeDragStop={handleNodeDragStop}
            proOptions={{ hideAttribution: true }}
            className="attack-graph-flow bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.08),transparent_30%),linear-gradient(180deg,#0e1522,#0b111a)]"
          >
            <Controls
              showFitView={false}
              showInteractive={false}
              className="attack-graph-controls"
            />
            <Background gap={24} size={1} color="rgba(148,163,184,0.12)" />
          </ReactFlow>
        </div>
      </div>

      <aside className="flex w-[320px] shrink-0 flex-col bg-[#111827] p-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
            Graph Summary
          </div>
          <div className="mt-2 text-sm text-slate-200">
            {graphNodes.length} nodes, {graphEdges.length} edges
          </div>
          {activeScenario ? (
            <div className="mt-2 text-xs text-slate-400">
              {activeScenario.description}
            </div>
          ) : null}
        </div>

        <GraphProposalQueue
          proposals={pendingProposals}
          isLoading={isProposalsLoading}
          acceptingProposalId={acceptingProposalId}
          onAccept={acceptProposal}
        />

        <div className="mt-6 rounded-xl border border-white/10 bg-slate-950/60 p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
            Selected Node
          </div>
          {selectedNode ? (
            <div className="mt-3 space-y-3">
              <div>
                <div className="text-sm font-semibold text-white">
                  {selectedNode.label}
                </div>
                <div className="text-xs text-slate-400">{selectedNode.type}</div>
              </div>

              {formatMeta(selectedNode).map(([label, value]) => (
                <div key={label} className="space-y-1">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    {label}
                  </div>
                  <div className="text-sm text-slate-200">{value}</div>
                </div>
              ))}

              {selectedNode.notes ? (
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    Notes
                  </div>
                  <div className="text-sm text-slate-200">{selectedNode.notes}</div>
                </div>
              ) : null}

              {selectedNodeHistoryEvidence.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    History Evidence
                  </div>
                  <div className="space-y-2">
                    {selectedNodeHistoryEvidence.map((item) => {
                      const commandDetail =
                        selectedNodeCommandDetails[item.commandId] ?? null;
                      const commandText =
                        commandDetail?.command ??
                        item.command ??
                        `Command ${item.commandId}`;
                      const outputPreview = getCommandOutputPreview(commandDetail);
                      const reportEvidenceStateKey = `${projectId ?? "no-project"}:${item.commandId}`;
                      const persistedReportEvidenceUsage = usedReportEvidenceByKey.get(
                        `command_history:${item.commandId}`
                      );
                      const localReportEvidenceState =
                        reportEvidenceStateByCommandId[reportEvidenceStateKey];
                      const reportEvidenceState = localReportEvidenceState?.status ??
                        (persistedReportEvidenceUsage ? "duplicate" : undefined);
                      const reportEvidenceTarget =
                        projectId &&
                        reportEvidenceState === "duplicate" &&
                        (localReportEvidenceState?.proposalId ||
                          persistedReportEvidenceUsage?.proposalId)
                          ? {
                              projectId,
                              commandId: item.commandId,
                              proposalId:
                                localReportEvidenceState?.proposalId ??
                                persistedReportEvidenceUsage?.proposalId ??
                                "",
                              proposalStatus:
                                localReportEvidenceState?.proposalStatus ??
                                persistedReportEvidenceUsage?.proposalStatus ??
                                "pending",
                              patchId:
                                localReportEvidenceState?.patchId ??
                                persistedReportEvidenceUsage?.patchId ??
                                null,
                            }
                          : null;
                      const isReportEvidencePending =
                        reportEvidenceState === "pending";
                      const reportButtonLabel =
                        reportEvidenceState === "added"
                          ? "Added"
                          : reportEvidenceState === "duplicate"
                            ? "Already"
                          : reportEvidenceState === "error"
                            ? "Retry"
                          : isReportEvidencePending
                              ? "Adding"
                              : "Report";
                      const reportButtonTitle = reportEvidenceTarget
                        ? `Already used by ${reportEvidenceTarget.proposalStatus} report proposal ${reportEvidenceTarget.proposalId}`
                        : undefined;
                      const reportButtonAriaLabel = reportEvidenceTarget
                        ? `Open report proposal ${reportEvidenceTarget.proposalId} for command ${item.commandId} evidence`
                        : `Add command ${item.commandId} evidence to report`;
                      const reportEvidenceHref = reportEvidenceTarget
                        ? `/projects/${reportEvidenceTarget.projectId}/reports?proposal=${encodeURIComponent(
                            reportEvidenceTarget.proposalId
                          )}`
                        : null;

                      return (
                        <div
                          key={item.commandId}
                          className="rounded-lg border border-cyan-400/20 bg-cyan-500/5 px-3 py-2"
                        >
                          <div className="flex items-start gap-2">
                            <a
                              href={getHistoryCommandHref(projectId, item.commandId)}
                              aria-label={`Open command ${item.commandId} in history`}
                              className="min-w-0 flex-1 text-left transition-colors hover:text-cyan-100"
                            >
                              <div className="truncate font-mono text-[11px] text-cyan-100">
                                {commandText}
                              </div>
                              <div className="mt-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                                <span className="truncate">
                                  {commandDetail?.source ?? item.tool ?? "history"}
                                </span>
                                <span className="font-mono normal-case tracking-normal text-slate-400">
                                  {item.commandId}
                                </span>
                              </div>
                            </a>
                            {onSendEvidenceToAI ? (
                              <Button
                                type="button"
                                variant="secondary"
                                className="h-7 shrink-0 px-2 text-[10px]"
                                aria-label={`Send command ${item.commandId} evidence to AI`}
                                onClick={() =>
                                  onSendEvidenceToAI(
                                    buildGraphEvidencePrompt({
                                      node: selectedNode,
                                      evidence: item,
                                      command: commandDetail,
                                    })
                                  )
                                }
                              >
                                AI
                              </Button>
                            ) : null}
                            {onAddEvidenceToReport ? (
                              <Button
                                type="button"
                                variant="outline"
                                className={cn(
                                  "h-7 shrink-0 px-2 text-[10px]",
                                  reportEvidenceTarget
                                    ? "border-emerald-400/40 text-emerald-200 hover:bg-emerald-500/10 hover:text-emerald-100"
                                    : ""
                                )}
                                aria-label={reportButtonAriaLabel}
                                title={reportButtonTitle}
                                disabled={isReportEvidencePending}
                                onClick={() => {
                                  if (reportEvidenceTarget) {
                                    if (onOpenReportEvidence) {
                                      onOpenReportEvidence(reportEvidenceTarget);
                                    } else if (reportEvidenceHref) {
                                      window.location.assign(reportEvidenceHref);
                                    }
                                    return;
                                  }
                                  void addEvidenceToReport({
                                    node: selectedNode,
                                    evidence: item,
                                    command: commandDetail,
                                  });
                                }}
                              >
                                {reportButtonLabel}
                              </Button>
                            ) : null}
                          </div>

                          {commandDetail ? (
                            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-slate-400">
                              <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5">
                                exit {commandDetail.exit_code}
                              </span>
                              <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5">
                                {formatCommandDuration(commandDetail.duration_ms)}
                              </span>
                              <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5">
                                {commandDetail.session_name ??
                                  commandDetail.session_id}
                              </span>
                            </div>
                          ) : selectedNodeCommandDetails[item.commandId] === undefined ? (
                            <div className="mt-2 text-[10px] text-slate-500">
                              Loading command details...
                            </div>
                          ) : null}

                          {outputPreview ? (
                            <pre className="mt-2 max-h-24 overflow-hidden whitespace-pre-wrap rounded-md border border-white/10 bg-slate-950/70 p-2 font-mono text-[10px] leading-4 text-slate-300">
                              {outputPreview}
                            </pre>
                          ) : null}
                          {reportEvidenceState === "error" ? (
                            <div className="mt-2 text-[10px] text-red-300">
                              Report proposal failed.
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {selectedNode.tags.length > 0 ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  {selectedNode.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-300"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-3 text-sm text-slate-400">
              Select a node to inspect it.
            </div>
          )}
        </div>
      </aside>

      <GraphSearchPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        nodes={graphNodes}
        onSelect={jumpToNode}
      />
    </div>
  );
}

export function AttackGraphPanel({
  projectId,
  isCollapsed = false,
  onToggle,
  selectedGraphNodeId = null,
  selectedGraphEdgeId = null,
  fallbackGraph = null,
  comparisonOverlay = null,
  onSendEvidenceToAI,
  onAddEvidenceToReport,
  onOpenReportEvidence,
}: {
  projectId?: string;
  isCollapsed?: boolean;
  onToggle?: () => void;
  selectedGraphNodeId?: string | null;
  selectedGraphEdgeId?: string | null;
  fallbackGraph?: AttackGraphData | null;
  comparisonOverlay?: AttackGraphComparisonOverlay | null;
  onSendEvidenceToAI?: (text: string) => void;
  onAddEvidenceToReport?: (
    payload: CreateReportProposalPayload
  ) => Promise<CreateReportProposalResponse>;
  onOpenReportEvidence?: (target: ReportEvidenceUsageTarget) => void;
}) {
  const { graph: canonicalGraph } = useProjectGraph(projectId);
  const graph =
    canonicalGraph.nodes.length > 0 ? canonicalGraph : fallbackGraph ?? canonicalGraph;
  const isUsingFallbackGraph =
    canonicalGraph.nodes.length === 0 && (fallbackGraph?.nodes.length ?? 0) > 0;
  const [isFullscreen, setIsFullscreen] = useState(false);
  const dragUnlockStorageKey = useMemo(
    () =>
      projectId
        ? `${dragUnlockStoragePrefix}${projectId}:graphDragUnlocked`
        : null,
    [projectId]
  );
  const [dragUnlocked, setDragUnlocked] = useState(() =>
    readStoredDragUnlock(dragUnlockStorageKey)
  );
  const [panelHeight, setPanelHeight] = useState(DEFAULT_PANEL_HEIGHT);
  const dragResetRef = useRef<(() => void) | null>(null);
  const resizeSession = useRef<{ startY: number; startHeight: number } | null>(
    null
  );

  useEffect(() => {
    if (!dragUnlockStorageKey) {
      return;
    }
    try {
      window.localStorage.setItem(dragUnlockStorageKey, String(dragUnlocked));
    } catch {
      return;
    }
  }, [dragUnlockStorageKey, dragUnlocked]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!resizeSession.current || isFullscreen) {
        return;
      }

      const delta = resizeSession.current.startY - event.clientY;
      setPanelHeight(clampPanelHeight(resizeSession.current.startHeight + delta));
    };

    const handleMouseUp = () => {
      resizeSession.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isFullscreen]);

  useEffect(() => {
    if (!isFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isFullscreen]);

  useEffect(() => {
    if (!isFullscreen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isFullscreen]);

  if (isCollapsed) {
    return (
      <button
        type="button"
        className="flex h-9 w-full items-center justify-between border-t border-border bg-card-dark px-4 text-left hover:bg-bg-tertiary transition-colors"
        onClick={onToggle}
        aria-label="Expand attack graph"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Maximize2 className="h-4 w-4 text-cyan-300" />
          Attack Graph v2
          <span className="ml-2 rounded bg-surface-highlight px-1.5 py-0.5 text-xs font-normal text-text-muted">
            {graph.nodes.length} Nodes
          </span>
        </div>
      </button>
    );
  }

  return (
    <section
      className={cn(
        "flex shrink-0 flex-col border-t border-border bg-card-dark",
        isFullscreen
          ? "fixed inset-0 z-50 h-full w-full"
          : ""
      )}
      style={isFullscreen ? undefined : { height: `${panelHeight}px` }}
      data-testid="attack-graph"
      data-fullscreen={isFullscreen ? "true" : "false"}
    >
      {!isFullscreen ? (
        <div
          className="flex h-3 shrink-0 cursor-row-resize items-center justify-center border-b border-border/60 bg-bg-tertiary/70 text-text-muted hover:text-white"
          data-testid="attack-graph-resize-handle"
          onMouseDown={(event) => {
            resizeSession.current = {
              startY: event.clientY,
              startHeight: panelHeight,
            };
            event.preventDefault();
          }}
        >
          <GripHorizontal className="h-3.5 w-3.5" />
        </div>
      ) : null}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-bg-tertiary px-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Maximize2 className="h-4 w-4 text-cyan-300" />
          Attack Graph v2
          <span className="ml-2 rounded bg-surface-highlight px-1.5 py-0.5 text-xs font-normal text-text-muted">
            {graph.nodes.length} Nodes
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setDragUnlocked((prev) => {
                const next = !prev;
                if (!next) {
                  dragResetRef.current?.();
                }
                return next;
              })
            }
            className={cn(
              "flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold transition-colors",
              dragUnlocked
                ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
                : "border-white/10 bg-white/5 text-slate-300"
            )}
            aria-label={dragUnlocked ? "Lock node dragging" : "Unlock node dragging"}
            title={dragUnlocked ? "Lock node dragging" : "Unlock node dragging"}
            disabled={graph.nodes.length === 0 || isUsingFallbackGraph}
          >
            {dragUnlocked ? (
              <Unlock className="h-3.5 w-3.5" />
            ) : (
              <Lock className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">
              {dragUnlocked ? "Dragging unlocked" : "Dragging locked"}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setIsFullscreen((prev) => !prev)}
            className="p-1 text-text-muted hover:text-white"
            aria-label={
              isFullscreen
                ? "Exit attack graph fullscreen"
                : "Enter attack graph fullscreen"
            }
          >
            {isFullscreen ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={onToggle}
            className="p-1 text-text-muted hover:text-white"
            aria-label="Collapse attack graph"
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "20px" }}
            >
              keyboard_arrow_down
            </span>
          </button>
        </div>
      </div>

      <ReactFlowProvider>
        <AttackGraphContent
          projectId={projectId}
          dragUnlocked={dragUnlocked}
          dragResetRef={dragResetRef}
          selectedGraphNodeId={selectedGraphNodeId}
          selectedGraphEdgeId={selectedGraphEdgeId}
          fallbackGraph={fallbackGraph}
          comparisonOverlay={comparisonOverlay}
          onSendEvidenceToAI={onSendEvidenceToAI}
          onAddEvidenceToReport={onAddEvidenceToReport}
          onOpenReportEvidence={onOpenReportEvidence}
        />
      </ReactFlowProvider>
    </section>
  );
}
