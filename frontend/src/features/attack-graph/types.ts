export type AttackGraphSource = "stored" | "derived";

export type AttackGraphNodeType =
  | "host"
  | "service"
  | "credential"
  | "session"
  | "finding"
  | "loot"
  | "user"
  | "action"
  | "artifact";

export type AttackGraphEdgeKind =
  | "runs_on"
  | "discovered_by"
  | "exploited_via"
  | "obtained"
  | "authenticates_to"
  | "opens_session_on"
  | "escalated_to"
  | "pivots_to"
  | "in_network"
  | "related_to"
  | "member_of";

export interface AttackGraphPosition {
  x: number;
  y: number;
}

export interface AttackGraphNode {
  id: string;
  projectId: string;
  type: AttackGraphNodeType;
  label: string;
  createdAt: string;
  updatedAt: string;
  createdBy: "user" | "ai" | "rule" | "import";
  confidence: number;
  sourceStepIds: string[];
  tags: string[];
  notes: string | null;
  position: AttackGraphPosition | null;
  meta: Record<string, unknown>;
}

export interface AttackGraphEdge {
  id: string;
  projectId: string;
  sourceId: string;
  targetId: string;
  kind: AttackGraphEdgeKind;
  sourceStepId: string | null;
  command: string | null;
  tool: string | null;
  createdAt: string;
  confidence: number;
  label: string | null;
  meta: Record<string, unknown>;
}

export interface AttackGraphScenario {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  color: string;
  isActive: boolean;
  nodeIds: string[];
  edgeIds: string[];
}

export interface AttackGraphData {
  projectId: string;
  source: AttackGraphSource;
  nodes: AttackGraphNode[];
  edges: AttackGraphEdge[];
  scenarios: AttackGraphScenario[];
  activeScenarioId: string | null;
}

export type AttackGraphComparisonState = "added" | "removed";

export interface AttackGraphComparisonOverlay {
  source: "report-bundle";
  baseArtifactId?: string | null;
  targetArtifactId?: string | null;
  baseRevision: number | null;
  targetRevision: number | null;
  addedNodeIds: string[];
  removedNodeIds: string[];
  addedEdgeIds: string[];
  removedEdgeIds: string[];
  addedNodes?: AttackGraphNode[];
  removedNodes?: AttackGraphNode[];
  addedEdges?: AttackGraphEdge[];
  removedEdges?: AttackGraphEdge[];
}

export interface AttackGraphProposalPayload {
  sourceStepId: string | null;
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
}

export interface AttackGraphProposal {
  id: string;
  projectId: string;
  sourceType: "command_history";
  sourceId: string | null;
  proposedBy: "rule" | "ai" | "user";
  status: "pending" | "accepted" | "rejected";
  title: string | null;
  summary: string | null;
  payload: AttackGraphProposalPayload;
  createdAt: string;
  resolvedAt: string | null;
}

export interface AttackGraphProposalListResponse {
  items: AttackGraphProposal[];
  total: number;
}

export interface AttackGraphProposalAcceptResponse {
  proposal: AttackGraphProposal;
  graphBatch: {
    createdNodeIds: string[];
    createdEdgeIds: string[];
  };
}

export interface AttackGraphPath {
  nodeIds: string[];
  edgeIds: string[];
  nodes: AttackGraphNode[];
  edges: AttackGraphEdge[];
}
