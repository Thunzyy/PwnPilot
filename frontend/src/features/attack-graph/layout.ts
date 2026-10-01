import type {
  AttackGraphEdge,
  AttackGraphNode,
  AttackGraphPosition,
} from "./types";

export const ATTACK_GRAPH_NODE_WIDTH = 280;
export const ATTACK_GRAPH_NODE_HEIGHT = 104;

type LayoutResult = Record<string, AttackGraphPosition>;

const LAYOUT_MARGIN_X = 80;
const LAYOUT_MARGIN_Y = 80;
const COLUMN_GAP = 220;
const NODE_VERTICAL_GAP = 44;
const LANE_PADDING_Y = 96;

const SESSION_ELEVATED_TERMS = ["root", "system", "administrator", "nt authority\\system"];
const RECON_TERMS = [
  "nmap",
  "ffuf",
  "gobuster",
  "dirsearch",
  "nikto",
  "recon",
  "enum",
  "enumerate",
  "scan",
  "http",
  "ftp",
  "tshark",
  "pcap",
  "curl",
  "wget",
];
const ACCESS_TERMS = [
  "credential",
  "login",
  "password",
  "user.txt",
  "foothold",
  "ssh",
  "ftp",
  "token",
];
const LATERAL_TERMS = [
  "pivot",
  "lateral",
  "netexec",
  "smb",
  "winrm",
  "psexec",
  "wmi",
  "rdp",
  "forensic",
];
const PRIVESC_TERMS = [
  "privesc",
  "privilege escalation",
  "cap_setuid",
  "getcap",
  "sudo",
  "setuid",
  "seimpersonate",
  "token::elevate",
  "kernel",
  "root session",
  "root@",
  "root shell",
];
const OBJECTIVE_TERMS = ["root.txt", "proof.txt", "flag", "loot", "secret", "dump"];

const NODE_ORDER_BY_PHASE: Record<number, Record<AttackGraphNode["type"], number>> = {
  0: {
    host: 0,
    service: 1,
    finding: 2,
    action: 3,
    artifact: 4,
    credential: 5,
    user: 6,
    session: 7,
    loot: 8,
  },
  1: {
    credential: 0,
    user: 1,
    session: 2,
    action: 3,
    artifact: 4,
    finding: 5,
    host: 6,
    service: 7,
    loot: 8,
  },
  2: {
    host: 0,
    service: 1,
    credential: 2,
    user: 3,
    session: 4,
    action: 5,
    artifact: 6,
    finding: 7,
    loot: 8,
  },
  3: {
    finding: 0,
    artifact: 1,
    action: 2,
    session: 3,
    credential: 4,
    user: 5,
    host: 6,
    service: 7,
    loot: 8,
  },
  4: {
    loot: 0,
    artifact: 1,
    action: 2,
    session: 3,
    credential: 4,
    user: 5,
    host: 6,
    service: 7,
    finding: 8,
  },
};

function isPinned(node: AttackGraphNode): boolean {
  return node.meta.position_pinned === true && node.position !== null;
}

function normalizeText(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).toLowerCase();
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).join(" ");
  }
  if (typeof value === "object") {
    return Object.values(value).map((item) => normalizeText(item)).join(" ");
  }
  return "";
}

function nodeText(node: AttackGraphNode): string {
  return `${node.label} ${normalizeText(node.meta)}`.toLowerCase();
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function isElevatedSession(node: AttackGraphNode): boolean {
  if (node.type !== "session") {
    return false;
  }
  const privilege = normalizeText(node.meta.privilege);
  const user = normalizeText(node.meta.user);
  const text = nodeText(node);
  return SESSION_ELEVATED_TERMS.some(
    (term) => privilege.includes(term) || user.includes(term) || text.includes(term),
  );
}

function inferBasePhase(node: AttackGraphNode): number {
  const text = nodeText(node);

  if (node.type === "host" || node.type === "service") {
    return 0;
  }

  if (node.type === "credential" || node.type === "user") {
    return includesAny(text, LATERAL_TERMS) ? 2 : 1;
  }

  if (node.type === "session") {
    if (isElevatedSession(node)) {
      return 3;
    }
    return includesAny(text, LATERAL_TERMS) ? 2 : 2;
  }

  if (node.type === "loot") {
    if (text.includes("user.txt")) {
      return 2;
    }
    if (includesAny(text, OBJECTIVE_TERMS) || text.includes("root.txt")) {
      return 4;
    }
    return 4;
  }

  if (includesAny(text, OBJECTIVE_TERMS)) {
    return 4;
  }
  if (includesAny(text, PRIVESC_TERMS)) {
    return 3;
  }
  if (includesAny(text, LATERAL_TERMS)) {
    return 2;
  }
  if (includesAny(text, ACCESS_TERMS)) {
    return 1;
  }
  if (includesAny(text, RECON_TERMS)) {
    return 0;
  }

  return node.type === "artifact" ? 2 : 0;
}

function edgePhaseDelta(edge: AttackGraphEdge, _source: AttackGraphNode, target: AttackGraphNode): number {
  switch (edge.kind) {
    case "opens_session_on":
    case "escalated_to":
    case "pivots_to":
      return 1;
    case "exploited_via":
      return target.type === "finding" ? 1 : 0;
    case "obtained":
      if (target.type === "loot" || target.type === "user") {
        return 1;
      }
      if (target.type === "session") {
        return 1;
      }
      return 0;
    case "authenticates_to":
    case "runs_on":
    case "discovered_by":
    case "member_of":
    case "in_network":
      return 0;
    case "related_to":
      return target.type === "loot" ? 1 : 0;
    default:
      return 0;
  }
}

class UnionFind {
  private readonly parent = new Map<string, string>();

  add(id: string) {
    if (!this.parent.has(id)) {
      this.parent.set(id, id);
    }
  }

  find(id: string): string {
    const current = this.parent.get(id);
    if (!current) {
      this.parent.set(id, id);
      return id;
    }
    if (current === id) {
      return id;
    }
    const root = this.find(current);
    this.parent.set(id, root);
    return root;
  }

  union(left: string, right: string) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) {
      this.parent.set(rightRoot, leftRoot);
    }
  }
}

type LayoutModel = {
  positions: LayoutResult;
};

function buildRunsOnClusters(
  nodes: AttackGraphNode[],
  edges: AttackGraphEdge[],
): {
  clusterByNodeId: Map<string, string>;
  membersByClusterId: Map<string, string[]>;
} {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const unionFind = new UnionFind();

  for (const node of nodes) {
    if (node.type === "host" || node.type === "service") {
      unionFind.add(node.id);
    }
  }

  for (const edge of edges) {
    if (edge.kind !== "runs_on") {
      continue;
    }
    const source = nodeById.get(edge.sourceId);
    const target = nodeById.get(edge.targetId);
    if (!source || !target) {
      continue;
    }
    if (
      (source.type === "host" || source.type === "service") &&
      (target.type === "host" || target.type === "service")
    ) {
      unionFind.union(source.id, target.id);
    }
  }

  const clusterByNodeId = new Map<string, string>();
  const membersByClusterId = new Map<string, string[]>();

  for (const node of nodes) {
    if (node.type !== "host" && node.type !== "service") {
      continue;
    }
    const clusterId = unionFind.find(node.id);
    clusterByNodeId.set(node.id, clusterId);
    const members = membersByClusterId.get(clusterId) ?? [];
    members.push(node.id);
    membersByClusterId.set(clusterId, members);
  }

  return { clusterByNodeId, membersByClusterId };
}

function buildAdjacency(edges: AttackGraphEdge[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const sourceNeighbors = adjacency.get(edge.sourceId) ?? [];
    sourceNeighbors.push(edge.targetId);
    adjacency.set(edge.sourceId, sourceNeighbors);

    const targetNeighbors = adjacency.get(edge.targetId) ?? [];
    targetNeighbors.push(edge.sourceId);
    adjacency.set(edge.targetId, targetNeighbors);
  }
  return adjacency;
}

function findNearestClusterId(
  nodeId: string,
  adjacency: Map<string, string[]>,
  clusterByNodeId: Map<string, string>,
): string | null {
  const visited = new Set<string>([nodeId]);
  const queue: string[] = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const clusterId = clusterByNodeId.get(current);
    if (clusterId) {
      return clusterId;
    }
    for (const neighbor of adjacency.get(current) ?? []) {
      if (visited.has(neighbor)) {
        continue;
      }
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }

  return null;
}

function clusterLabel(
  clusterId: string,
  membersByClusterId: Map<string, string[]>,
  nodeById: Map<string, AttackGraphNode>,
): string {
  const members = membersByClusterId.get(clusterId) ?? [];
  const host = members
    .map((memberId) => nodeById.get(memberId))
    .find((node) => node?.type === "host");
  if (host) {
    return host.label;
  }
  return members
    .map((memberId) => nodeById.get(memberId)?.label ?? memberId)
    .sort()[0] ?? clusterId;
}

function nodeOrderForPhase(node: AttackGraphNode, phase: number): number {
  const phaseMap = NODE_ORDER_BY_PHASE[phase] ?? NODE_ORDER_BY_PHASE[4];
  return phaseMap[node.type] ?? 99;
}

function shouldLiftClusterPhase(edge: AttackGraphEdge, source: AttackGraphNode): boolean {
  return edge.kind === "pivots_to" || (edge.kind === "related_to" && source.type === "session");
}

function buildLayoutModel(nodes: AttackGraphNode[], edges: AttackGraphEdge[]): LayoutModel {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const { clusterByNodeId, membersByClusterId } = buildRunsOnClusters(nodes, edges);
  const adjacency = buildAdjacency(edges);
  const basePhaseByNodeId = new Map(nodes.map((node) => [node.id, inferBasePhase(node)]));
  const phaseByNodeId = new Map<string, number>();
  const clusterPhaseById = new Map<string, number>();

  for (const node of nodes) {
    if (!clusterByNodeId.has(node.id)) {
      phaseByNodeId.set(node.id, basePhaseByNodeId.get(node.id) ?? 0);
    }
  }
  for (const clusterId of membersByClusterId.keys()) {
    clusterPhaseById.set(clusterId, 0);
  }

  const resolvePhase = (nodeId: string): number => {
    const clusterId = clusterByNodeId.get(nodeId);
    if (clusterId) {
      return clusterPhaseById.get(clusterId) ?? 0;
    }
    return phaseByNodeId.get(nodeId) ?? 0;
  };

  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;

    for (const edge of edges) {
      if (edge.kind === "runs_on") {
        continue;
      }

      const source = nodeById.get(edge.sourceId);
      const target = nodeById.get(edge.targetId);
      if (!source || !target) {
        continue;
      }

      const candidatePhase = resolvePhase(source.id) + edgePhaseDelta(edge, source, target);
      const targetClusterId = clusterByNodeId.get(target.id);

      if (targetClusterId && shouldLiftClusterPhase(edge, source)) {
        const nextPhase = Math.max(clusterPhaseById.get(targetClusterId) ?? 0, candidatePhase);
        if (nextPhase > (clusterPhaseById.get(targetClusterId) ?? 0)) {
          clusterPhaseById.set(targetClusterId, nextPhase);
          changed = true;
        }
        continue;
      }

      if (targetClusterId) {
        continue;
      }

      const currentPhase = phaseByNodeId.get(target.id) ?? basePhaseByNodeId.get(target.id) ?? 0;
      const nextPhase = Math.max(currentPhase, basePhaseByNodeId.get(target.id) ?? 0, candidatePhase);
      if (nextPhase > currentPhase) {
        phaseByNodeId.set(target.id, nextPhase);
        changed = true;
      }
    }

    if (!changed) {
      break;
    }
  }

  const effectivePhaseByNodeId = new Map<string, number>();
  for (const node of nodes) {
    effectivePhaseByNodeId.set(node.id, resolvePhase(node.id));
  }

  const usedPhases = Array.from(new Set(effectivePhaseByNodeId.values())).sort((left, right) => left - right);
  const compressedPhaseByValue = new Map(usedPhases.map((phase, index) => [phase, index]));

  for (const [nodeId, phase] of effectivePhaseByNodeId.entries()) {
    effectivePhaseByNodeId.set(nodeId, compressedPhaseByValue.get(phase) ?? phase);
  }

  const clusterIds = Array.from(membersByClusterId.keys()).sort((left, right) => {
    const leftPhase = Math.min(
      ...((membersByClusterId.get(left) ?? []).map((memberId) => effectivePhaseByNodeId.get(memberId) ?? 0)),
    );
    const rightPhase = Math.min(
      ...((membersByClusterId.get(right) ?? []).map((memberId) => effectivePhaseByNodeId.get(memberId) ?? 0)),
    );
    if (leftPhase !== rightPhase) {
      return leftPhase - rightPhase;
    }
    return clusterLabel(left, membersByClusterId, nodeById).localeCompare(
      clusterLabel(right, membersByClusterId, nodeById),
    );
  });
  const laneByClusterId = new Map(clusterIds.map((clusterId, index) => [clusterId, index]));

  const laneByNodeId = new Map<string, number>();
  for (const node of nodes) {
    const explicitHostId = typeof node.meta.host_id === "string" ? node.meta.host_id : null;
    const explicitClusterId = explicitHostId ? clusterByNodeId.get(explicitHostId) : null;
    const clusterId =
      clusterByNodeId.get(node.id) ??
      explicitClusterId ??
      findNearestClusterId(node.id, adjacency, clusterByNodeId);

    laneByNodeId.set(node.id, clusterId ? (laneByClusterId.get(clusterId) ?? 0) : 0);
  }

  const groupedNodeIds = new Map<string, string[]>();
  for (const node of nodes) {
    const phase = effectivePhaseByNodeId.get(node.id) ?? 0;
    const lane = laneByNodeId.get(node.id) ?? 0;
    const key = `${lane}:${phase}`;
    const current = groupedNodeIds.get(key) ?? [];
    current.push(node.id);
    groupedNodeIds.set(key, current);
  }

  const laneCount = Math.max(1, ...Array.from(laneByNodeId.values()).map((lane) => lane + 1));
  const maxRowsByLane = new Map<number, number>();
  for (let lane = 0; lane < laneCount; lane += 1) {
    let laneMax = 1;
    for (const [groupKey, groupNodeIds] of groupedNodeIds.entries()) {
      const [groupLane] = groupKey.split(":").map(Number);
      if (groupLane === lane) {
        laneMax = Math.max(laneMax, groupNodeIds.length);
      }
    }
    maxRowsByLane.set(lane, laneMax);
  }

  const laneTopByIndex = new Map<number, number>();
  let currentTop = LAYOUT_MARGIN_Y;
  for (let lane = 0; lane < laneCount; lane += 1) {
    laneTopByIndex.set(lane, currentTop);
    const laneHeight =
      (maxRowsByLane.get(lane) ?? 1) * (ATTACK_GRAPH_NODE_HEIGHT + NODE_VERTICAL_GAP) +
      LANE_PADDING_Y;
    currentTop += laneHeight;
  }

  const positions: LayoutResult = {};
  for (const [groupKey, groupNodeIds] of groupedNodeIds.entries()) {
    const [lane, phase] = groupKey.split(":").map(Number);
    const sortedIds = [...groupNodeIds].sort((leftId, rightId) => {
      const leftNode = nodeById.get(leftId)!;
      const rightNode = nodeById.get(rightId)!;
      const leftOrder = nodeOrderForPhase(leftNode, phase);
      const rightOrder = nodeOrderForPhase(rightNode, phase);
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return leftNode.label.localeCompare(rightNode.label);
    });

    const laneTop = laneTopByIndex.get(lane) ?? LAYOUT_MARGIN_Y;
    const groupHeight =
      sortedIds.length * ATTACK_GRAPH_NODE_HEIGHT +
      Math.max(0, sortedIds.length - 1) * NODE_VERTICAL_GAP;
    const laneHeight =
      (maxRowsByLane.get(lane) ?? 1) * (ATTACK_GRAPH_NODE_HEIGHT + NODE_VERTICAL_GAP) +
      LANE_PADDING_Y;
    const startY = laneTop + Math.max(0, (laneHeight - groupHeight) / 2);
    const x = LAYOUT_MARGIN_X + phase * (ATTACK_GRAPH_NODE_WIDTH + COLUMN_GAP);

    sortedIds.forEach((nodeId, index) => {
      positions[nodeId] = {
        x,
        y: Math.round(startY + index * (ATTACK_GRAPH_NODE_HEIGHT + NODE_VERTICAL_GAP)),
      };
    });
  }

  return { positions };
}

export async function layoutAttackGraph(
  nodes: AttackGraphNode[],
  edges: AttackGraphEdge[]
): Promise<LayoutResult> {
  if (nodes.length === 0) {
    return {};
  }

  const pinned: LayoutResult = {};
  const toLayout: AttackGraphNode[] = [];
  for (const node of nodes) {
    if (isPinned(node) && node.position) {
      pinned[node.id] = node.position;
    } else {
      toLayout.push(node);
    }
  }

  if (toLayout.length === 0) {
    return pinned;
  }

  try {
    const toLayoutIds = new Set(toLayout.map((node) => node.id));
    const filteredEdges = edges.filter(
      (edge) => toLayoutIds.has(edge.sourceId) && toLayoutIds.has(edge.targetId),
    );
    return {
      ...pinned,
      ...buildLayoutModel(toLayout, filteredEdges).positions,
    };
  } catch (error) {
    console.error("[attack-graph] Semantic layout failed", error);
    const positions: LayoutResult = { ...pinned };
    toLayout.forEach((node, idx) => {
      positions[node.id] = {
        x: LAYOUT_MARGIN_X,
        y: LAYOUT_MARGIN_Y + idx * (ATTACK_GRAPH_NODE_HEIGHT + NODE_VERTICAL_GAP),
      };
    });
    return positions;
  }
}
