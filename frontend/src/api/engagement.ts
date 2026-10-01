import { api } from "./client";
import type {
  EngagementChecklistSection,
  EngagementGraphEdge,
  EngagementGraphNode,
  ProjectEngagementState,
  ProjectEngagementStateUpdate,
} from "@/types/engagement";

interface RawEngagementChecklistItem {
  id: string;
  label: string;
  status: "pending" | "active" | "done";
  evidence_count?: number;
  last_seen_at?: string | null;
  success_count?: number;
  failure_count?: number;
}

interface RawEngagementChecklistSection {
  id: string;
  label: string;
  icon?: string | null;
  is_open?: boolean;
  items: RawEngagementChecklistItem[];
}

interface RawEngagementGraphNodePosition {
  x: string;
  y: string;
}

interface RawEngagementGraphNode {
  id: string;
  type: "initial" | "action" | "success" | "failure";
  status?: "success" | "failure" | null;
  title: string;
  subtitle: string;
  icon: string;
  position: RawEngagementGraphNodePosition;
  section_id?: string | null;
  item_id?: string | null;
}

interface RawEngagementGraphEdge {
  id: string;
  source_id: string;
  target_id: string;
  kind?: "sequence" | "phase-transition";
  branch?: "success" | "failure" | null;
}

interface RawProjectEngagementState {
  version: "v1";
  sections: RawEngagementChecklistSection[];
  graph: {
    nodes: RawEngagementGraphNode[];
    edges: RawEngagementGraphEdge[];
  };
  progress: number;
  source: "stored" | "derived";
}

interface RawProjectEngagementStateUpdate {
  version: "v1";
  sections: RawEngagementChecklistSection[];
  graph: {
    nodes: RawEngagementGraphNode[];
    edges: RawEngagementGraphEdge[];
  };
  progress: number;
}

const toSections = (
  sections: RawEngagementChecklistSection[]
): EngagementChecklistSection[] =>
  sections.map((section) => ({
    id: section.id,
    label: section.label,
    icon: section.icon,
    isOpen: section.is_open,
    items: section.items.map((item) => ({
      id: item.id,
      label: item.label,
      status: item.status,
      evidenceCount: item.evidence_count ?? 0,
      lastSeenAt: item.last_seen_at ?? null,
      successCount: item.success_count ?? 0,
      failureCount: item.failure_count ?? 0,
    })),
  }));

const toNodes = (nodes: RawEngagementGraphNode[]): EngagementGraphNode[] =>
  nodes.map((node) => ({
    id: node.id,
    type: node.type,
    status: node.status ?? null,
    title: node.title,
    subtitle: node.subtitle,
    icon: node.icon,
    position: node.position,
    sectionId: node.section_id,
    itemId: node.item_id,
  }));

const toEdges = (edges: RawEngagementGraphEdge[]): EngagementGraphEdge[] =>
  edges.map((edge) => ({
    id: edge.id,
    sourceId: edge.source_id,
    targetId: edge.target_id,
    kind: edge.kind,
    branch: edge.branch ?? null,
  }));

const fromSections = (
  sections: EngagementChecklistSection[]
): RawEngagementChecklistSection[] =>
  sections.map((section) => ({
    id: section.id,
    label: section.label,
    icon: section.icon,
    is_open: Boolean(section.isOpen),
    items: section.items.map((item) => ({
      id: item.id,
      label: item.label,
      status: item.status,
      evidence_count: item.evidenceCount ?? 0,
      last_seen_at: item.lastSeenAt ?? null,
      success_count: item.successCount ?? 0,
      failure_count: item.failureCount ?? 0,
    })),
  }));

const fromNodes = (nodes: EngagementGraphNode[]): RawEngagementGraphNode[] =>
  nodes.map((node) => ({
    id: node.id,
    type: node.type,
    status: node.status ?? null,
    title: node.title,
    subtitle: node.subtitle,
    icon: node.icon,
    position: node.position,
    section_id: node.sectionId,
    item_id: node.itemId,
  }));

const fromEdges = (edges: EngagementGraphEdge[]): RawEngagementGraphEdge[] =>
  edges.map((edge) => ({
    id: edge.id,
    source_id: edge.sourceId,
    target_id: edge.targetId,
    kind: edge.kind,
    branch: edge.branch ?? null,
  }));

const toState = (raw: RawProjectEngagementState): ProjectEngagementState => ({
  version: raw.version,
  sections: toSections(raw.sections ?? []),
  graph: {
    nodes: toNodes(raw.graph?.nodes ?? []),
    edges: toEdges(raw.graph?.edges ?? []),
  },
  progress: raw.progress ?? 0,
  source: raw.source,
});

const fromStateUpdate = (
  state: ProjectEngagementStateUpdate
): RawProjectEngagementStateUpdate => ({
  version: state.version,
  sections: fromSections(state.sections),
  graph: {
    nodes: fromNodes(state.graph.nodes),
    edges: fromEdges(state.graph.edges),
  },
  progress: state.progress,
});

export const engagementApi = {
  getProjectState: (projectId: string) =>
    api
      .get<RawProjectEngagementState>(`/projects/${projectId}/engagement-state`)
      .then((response) => toState(response.data)),

  updateProjectState: (projectId: string, state: ProjectEngagementStateUpdate) =>
    api
      .put<RawProjectEngagementState>(
        `/projects/${projectId}/engagement-state`,
        fromStateUpdate(state)
      )
      .then((response) => toState(response.data)),
};
