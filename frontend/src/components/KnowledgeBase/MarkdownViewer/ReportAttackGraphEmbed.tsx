import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { AlertTriangle, GitBranch, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { TypedGraphNode } from "@/features/attack-graph/TypedGraphNode";
import { layoutAttackGraph } from "@/features/attack-graph/layout";
import { useProjectGraph } from "@/features/attack-graph/useProjectGraph";
import type { AttackGraphEdge, AttackGraphNode } from "@/features/attack-graph/types";

type FlowNode = Node<
  {
    node: AttackGraphNode;
    highlighted: boolean;
  },
  "typed"
>;

type PhaseHeaderFlowNode = Node<
  {
    label: string;
    count: number;
  },
  "phaseHeader"
>;

type ReportFlowNode = FlowNode | PhaseHeaderFlowNode;

const PHASE_GROUP_X_TOLERANCE = 180;
const PHASE_HEADER_Y_OFFSET = 72;
const PHASE_HEADER_MIN_Y = 28;

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

function buildLayoutSignature(nodes: AttackGraphNode[], edges: AttackGraphEdge[]): string {
  return JSON.stringify({
    nodes: nodes.map((node) => [
      node.id,
      node.label,
      node.type,
      node.position?.x ?? null,
      node.position?.y ?? null,
    ]),
    edges: edges.map((edge) => [edge.id, edge.sourceId, edge.targetId, edge.kind]),
  });
}

function buildFlowEdges(edges: AttackGraphEdge[]): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.sourceId,
    target: edge.targetId,
    type: "smoothstep",
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: "rgba(148, 163, 184, 0.75)",
    },
    style: {
      stroke: "rgba(148, 163, 184, 0.75)",
      strokeWidth: 1.5,
    },
  }));
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
  baseNodes: FlowNode[]
): PhaseHeaderFlowNode[] {
  if (baseNodes.length === 0) {
    return [];
  }

  const sortedNodes = [...baseNodes].sort((a, b) => a.position.x - b.position.x);
  const groups: Array<{
    x: number;
    minY: number;
    nodes: FlowNode[];
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

function ReportAttackGraphEmbedContent({ projectId }: { projectId: string }) {
  const { graph, isLoading, error } = useProjectGraph(projectId);
  const [layoutState, setLayoutState] = useState<{
    signature: string;
    positions: Record<string, { x: number; y: number }>;
  }>({
    signature: "",
    positions: {},
  });

  const layoutSignature = useMemo(
    () => buildLayoutSignature(graph.nodes, graph.edges),
    [graph.nodes, graph.edges],
  );
  const positions =
    layoutState.signature === layoutSignature ? layoutState.positions : {};
  const layoutPending =
    graph.nodes.length > 0 && layoutState.signature !== layoutSignature;

  useEffect(() => {
    let cancelled = false;

    if (graph.nodes.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    void layoutAttackGraph(graph.nodes, graph.edges).then((nextPositions) => {
      if (cancelled) {
        return;
      }
      setLayoutState({
        signature: layoutSignature,
        positions: nextPositions,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [graph.nodes, graph.edges, layoutSignature]);

  const baseNodes = useMemo<FlowNode[]>(() => {
    return graph.nodes.map((node, index) => ({
      id: node.id,
      type: "typed",
      position:
        positions[node.id] ??
        node.position ?? {
          x: index * 320,
          y: 0,
        },
      data: {
        node,
        highlighted: false,
      },
      draggable: false,
      selectable: false,
    }));
  }, [graph.nodes, positions]);

  const flowNodes = useMemo<ReportFlowNode[]>(
    () => [...buildPhaseHeaderNodes(baseNodes), ...baseNodes],
    [baseNodes]
  );

  const flowEdges = useMemo(() => buildFlowEdges(graph.edges), [graph.edges]);

  return (
    <section
      data-testid="report-attack-graph-embed"
      className="my-5 overflow-hidden rounded-2xl border border-border-dark bg-background-dark/70 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-dark/80 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <GitBranch className="h-4 w-4 text-cyan-300" />
            Attack graph visual
          </div>
          <p className="mt-1 text-xs text-text-secondary">
            {graph.nodes.length} nodes, {graph.edges.length} edges rendered from the live project graph.
          </p>
        </div>
      </div>

      {error ? (
        <div className="flex items-center gap-3 px-4 py-6 text-sm text-amber-100">
          <AlertTriangle className="h-4 w-4 text-amber-300" />
          <span>Unable to load the attack graph: {error}</span>
        </div>
      ) : null}

      {!error && (isLoading || layoutPending) ? (
        <div className="flex h-[420px] items-center justify-center gap-3 text-sm text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin text-cyan-300" />
          <span>Rendering the attack graph…</span>
        </div>
      ) : null}

      {!error && !isLoading && !layoutPending && graph.nodes.length === 0 ? (
        <div className="px-4 py-6 text-sm text-text-secondary">
          No attack graph data has been accepted for this project yet.
        </div>
      ) : null}

      {!error && !isLoading && !layoutPending && graph.nodes.length > 0 ? (
        <div className="h-[420px] w-full bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.08),transparent_42%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))]">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnDrag
            zoomOnPinch
            minZoom={0.25}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
            className={cn("bg-transparent")}
          >
            <Background color="rgba(148, 163, 184, 0.16)" gap={28} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      ) : null}
    </section>
  );
}

export function ReportAttackGraphEmbed({ projectId }: { projectId: string }) {
  return (
    <ReactFlowProvider>
      <ReportAttackGraphEmbedContent projectId={projectId} />
    </ReactFlowProvider>
  );
}
