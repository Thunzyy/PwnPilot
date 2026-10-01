import { api } from "@/api/client";
import type {
  AttackGraphData,
  AttackGraphEdge,
  AttackGraphNode,
  AttackGraphPath,
  AttackGraphProposal,
  AttackGraphProposalAcceptResponse,
  AttackGraphProposalListResponse,
  AttackGraphScenario,
} from "../types";

interface RawGraphProposal {
  id: string;
  project_id: string;
  source_type: "command_history";
  source_id?: string | null;
  proposed_by: "rule" | "ai" | "user";
  status: "pending" | "accepted" | "rejected";
  title?: string | null;
  summary?: string | null;
  payload: {
    source_step_id?: string;
    nodes?: Array<Record<string, unknown>>;
    edges?: Array<Record<string, unknown>>;
  };
  created_at: string;
  resolved_at?: string | null;
}

interface RawGraphProposalListResponse {
  items: RawGraphProposal[];
  total: number;
}

interface RawGraphProposalAcceptResponse {
  proposal: RawGraphProposal;
  graph_batch: {
    created_node_ids?: string[];
    created_edge_ids?: string[];
  };
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

interface RawAttackGraphScenario {
  id: string;
  project_id: string;
  name: string;
  description?: string | null;
  color: string;
  is_active: boolean;
  node_ids?: string[];
  edge_ids?: string[];
}

interface RawAttackGraphResponse {
  project_id: string;
  source: AttackGraphData["source"];
  nodes: RawAttackGraphNode[];
  edges: RawAttackGraphEdge[];
  scenarios: RawAttackGraphScenario[];
  active_scenario_id?: string | null;
}

interface RawAttackGraphPath {
  node_ids: string[];
  edge_ids: string[];
  nodes: RawAttackGraphNode[];
  edges: RawAttackGraphEdge[];
}

interface RawAttackGraphPathsResponse {
  project_id: string;
  paths: RawAttackGraphPath[];
}

const toNode = (node: RawAttackGraphNode): AttackGraphNode => ({
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

const toEdge = (edge: RawAttackGraphEdge): AttackGraphEdge => ({
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

const toScenario = (scenario: RawAttackGraphScenario): AttackGraphScenario => ({
  id: scenario.id,
  projectId: scenario.project_id,
  name: scenario.name,
  description: scenario.description ?? null,
  color: scenario.color,
  isActive: scenario.is_active,
  nodeIds: scenario.node_ids ?? [],
  edgeIds: scenario.edge_ids ?? [],
});

const toProposal = (proposal: RawGraphProposal): AttackGraphProposal => ({
  id: proposal.id,
  projectId: proposal.project_id,
  sourceType: proposal.source_type,
  sourceId: proposal.source_id ?? null,
  proposedBy: proposal.proposed_by,
  status: proposal.status,
  title: proposal.title ?? null,
  summary: proposal.summary ?? null,
  payload: {
    sourceStepId: proposal.payload?.source_step_id ?? null,
    nodes: proposal.payload?.nodes ?? [],
    edges: proposal.payload?.edges ?? [],
  },
  createdAt: proposal.created_at,
  resolvedAt: proposal.resolved_at ?? null,
});

const toGraph = (payload: RawAttackGraphResponse): AttackGraphData => ({
  projectId: payload.project_id,
  source: payload.source,
  nodes: (payload.nodes ?? []).map(toNode),
  edges: (payload.edges ?? []).map(toEdge),
  scenarios: (payload.scenarios ?? []).map(toScenario),
  activeScenarioId: payload.active_scenario_id ?? null,
});

const toPath = (payload: RawAttackGraphPath): AttackGraphPath => ({
  nodeIds: payload.node_ids ?? [],
  edgeIds: payload.edge_ids ?? [],
  nodes: (payload.nodes ?? []).map(toNode),
  edges: (payload.edges ?? []).map(toEdge),
});

const toProposalList = (
  payload: RawGraphProposalListResponse
): AttackGraphProposalListResponse => ({
  items: (payload.items ?? []).map(toProposal),
  total: payload.total ?? 0,
});

const toProposalAcceptResponse = (
  payload: RawGraphProposalAcceptResponse
): AttackGraphProposalAcceptResponse => ({
  proposal: toProposal(payload.proposal),
  graphBatch: {
    createdNodeIds: payload.graph_batch?.created_node_ids ?? [],
    createdEdgeIds: payload.graph_batch?.created_edge_ids ?? [],
  },
});

export const graphClient = {
  getProjectGraph: (projectId: string) =>
    api
      .get<RawAttackGraphResponse>(`/projects/${projectId}/graph`)
      .then((response) => toGraph(response.data)),

  seedDemoCtf: (projectId: string) =>
    api
      .post<RawAttackGraphResponse>(`/projects/${projectId}/graph/demo-ctf`)
      .then((response) => toGraph(response.data)),

  getShortestPath: (projectId: string, fromId: string, toId: string) =>
    api
      .get<RawAttackGraphPathsResponse>(`/projects/${projectId}/graph/paths`, {
        params: { from: fromId, to: toId },
      })
      .then((response) => (response.data.paths ?? []).map(toPath)),

  listProjectProposals: (projectId: string) =>
    api
      .get<RawGraphProposalListResponse>(`/projects/${projectId}/graph/proposals`)
      .then((response) => toProposalList(response.data)),

  createHistoryProposal: (projectId: string, commandId: string) =>
    api
      .post<RawGraphProposalListResponse>(
        `/projects/${projectId}/graph/proposals/from-history/${commandId}`
      )
      .then((response) => toProposalList(response.data)),

  acceptProposal: (projectId: string, proposalId: string) =>
    api
      .post<RawGraphProposalAcceptResponse>(
        `/projects/${projectId}/graph/proposals/${proposalId}/accept`
      )
      .then((response) => toProposalAcceptResponse(response.data)),

  updateNodePosition: (
    projectId: string,
    nodeId: string,
    position: { x: number; y: number }
  ) =>
    api
      .patch<RawAttackGraphNode>(`/projects/${projectId}/graph/nodes/${nodeId}`, {
        position,
      })
      .then((response) => toNode(response.data)),
};
