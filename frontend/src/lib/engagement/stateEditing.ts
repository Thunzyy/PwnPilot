import type {
  EngagementGraphEdge,
  EngagementGraphNode,
  ProjectEngagementStateUpdate,
} from "@/types/engagement";

type GraphNodePatch = Partial<
  Pick<
    EngagementGraphNode,
    "title" | "subtitle" | "icon" | "sectionId" | "itemId" | "status" | "position"
  >
>;

type AddGraphNodeOptions = {
  afterNodeId?: string | null;
  sectionId?: string | null;
  title?: string;
  subtitle?: string;
};

type GraphPosition = EngagementGraphNode["position"];

const PHASE_CENTER_X: Record<string, number> = {
  recon: 18,
  exploitation: 43,
  privesc: 66,
  postexp: 86,
};

const clampPercent = (value: number): number => Math.max(4, Math.min(96, value));

const parsePercent = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseFloat((value ?? "").replace("%", ""));
  return Number.isFinite(parsed) ? clampPercent(parsed) : fallback;
};

const toPercent = (value: number): string => `${Math.round(clampPercent(value))}%`;

const graphTypeForStatus = (
  currentType: EngagementGraphNode["type"],
  status: EngagementGraphNode["status"] | undefined | null
): EngagementGraphNode["type"] => {
  if (status === "failure") return "failure";
  if (status === "success") {
    return currentType === "initial" ? "initial" : "success";
  }
  return currentType === "initial" ? "initial" : "action";
};

const createNodeId = (nodes: EngagementGraphNode[]): string => {
  let next = nodes.length + 1;
  while (nodes.some((node) => node.id === `manual-node-${next}`)) {
    next += 1;
  }
  return `manual-node-${next}`;
};

const rebuildEdges = (nodes: EngagementGraphNode[]): EngagementGraphEdge[] => {
  const edges: EngagementGraphEdge[] = [];

  for (let index = 1; index < nodes.length; index += 1) {
    const previous = nodes[index - 1];
    const current = nodes[index];
    const branch = current.status ?? "success";

    edges.push({
      id: `${previous.id}->${current.id}`,
      sourceId: previous.id,
      targetId: current.id,
      kind: "sequence",
      branch,
    });

    if (previous.sectionId !== current.sectionId) {
      edges.push({
        id: `${previous.id}->${current.id}::phase-transition`,
        sourceId: previous.id,
        targetId: current.id,
        kind: "phase-transition",
        branch,
      });
    }
  }

  return edges;
};

const nextPositionForSection = (
  nodes: EngagementGraphNode[],
  sectionId: string | null | undefined
): GraphPosition => {
  const normalizedSectionId = sectionId ?? "recon";
  const sameLane = nodes.filter((node) => (node.sectionId ?? "recon") === normalizedSectionId);
  const laneIndex = sameLane.length;
  const centerX = PHASE_CENTER_X[normalizedSectionId] ?? PHASE_CENTER_X.recon;

  return {
    x: toPercent(centerX + (laneIndex % 2 === 0 ? 0 : 6)),
    y: toPercent(28 + laneIndex * 12),
  };
};

const withGraph = (
  state: ProjectEngagementStateUpdate,
  nodes: EngagementGraphNode[]
): ProjectEngagementStateUpdate => ({
  ...state,
  graph: {
    nodes,
    edges: rebuildEdges(nodes),
  },
});

export function addGraphNode(
  state: ProjectEngagementStateUpdate,
  options: AddGraphNodeOptions = {}
): ProjectEngagementStateUpdate {
  const nodes = [...state.graph.nodes];
  const insertAfterIndex = options.afterNodeId
    ? nodes.findIndex((node) => node.id === options.afterNodeId)
    : nodes.length - 1;
  const afterNode = insertAfterIndex >= 0 ? nodes[insertAfterIndex] : nodes.at(-1);
  const sectionId = options.sectionId ?? afterNode?.sectionId ?? "recon";

  const newNode: EngagementGraphNode = {
    id: createNodeId(nodes),
    type: "action",
    status: "success",
    title: options.title ?? "Manual step",
    subtitle: options.subtitle ?? "Operator-defined map note",
    icon: "edit",
    position: nextPositionForSection(nodes, sectionId),
    sectionId,
    itemId: null,
  };

  const nextNodes = [...nodes];
  nextNodes.splice(insertAfterIndex + 1, 0, newNode);
  return withGraph(state, nextNodes);
}

export function updateGraphNode(
  state: ProjectEngagementStateUpdate,
  nodeId: string,
  patch: GraphNodePatch
): ProjectEngagementStateUpdate {
  const nextNodes = state.graph.nodes.map((node) => {
    if (node.id !== nodeId) {
      return node;
    }

    const status = patch.status ?? node.status ?? null;
    const sectionChanged =
      patch.sectionId !== undefined && patch.sectionId !== node.sectionId;

    return {
      ...node,
      ...patch,
      itemId:
        patch.itemId !== undefined
          ? patch.itemId
          : sectionChanged
            ? null
            : node.itemId ?? null,
      type: graphTypeForStatus(node.type, status),
      status,
    };
  });

  return withGraph(state, nextNodes);
}

export function moveGraphNode(
  state: ProjectEngagementStateUpdate,
  nodeId: string,
  position: GraphPosition
): ProjectEngagementStateUpdate {
  return updateGraphNode(state, nodeId, {
    position: {
      x: toPercent(parsePercent(position.x, 50)),
      y: toPercent(parsePercent(position.y, 50)),
    },
  });
}

export function deleteGraphNode(
  state: ProjectEngagementStateUpdate,
  nodeId: string
): ProjectEngagementStateUpdate {
  const nextNodes = state.graph.nodes.filter((node) => node.id !== nodeId);
  return withGraph(state, nextNodes);
}
