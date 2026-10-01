export type EngagementItemStatus = "pending" | "active" | "done";
export type EngagementNodeType = "initial" | "action" | "success" | "failure";
export type EngagementNodeStatus = "success" | "failure";
export type EngagementEdgeKind = "sequence" | "phase-transition";
export type EngagementEdgeBranch = "success" | "failure";
export type EngagementStateVersion = "v1";
export type EngagementStateSource = "stored" | "derived";
export type EngagementDemoProfileId = "web" | "ad" | "pivoting" | "cloud";

export interface EngagementDemoProfile {
  id: EngagementDemoProfileId;
  label: string;
  description: string;
}

export interface EngagementChecklistItem {
  id: string;
  label: string;
  status: EngagementItemStatus;
  evidenceCount?: number;
  lastSeenAt?: string | null;
  successCount?: number;
  failureCount?: number;
}

export interface EngagementChecklistSection {
  id: string;
  label: string;
  icon?: string | null;
  isOpen?: boolean;
  items: EngagementChecklistItem[];
}

export interface EngagementGraphNodePosition {
  x: string;
  y: string;
}

export interface EngagementGraphNode {
  id: string;
  type: EngagementNodeType;
  status?: EngagementNodeStatus | null;
  title: string;
  subtitle: string;
  icon: string;
  position: EngagementGraphNodePosition;
  sectionId?: string | null;
  itemId?: string | null;
}

export interface EngagementGraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  kind?: EngagementEdgeKind;
  branch?: EngagementEdgeBranch | null;
}

export interface ProjectEngagementState {
  version: EngagementStateVersion;
  sections: EngagementChecklistSection[];
  graph: {
    nodes: EngagementGraphNode[];
    edges: EngagementGraphEdge[];
  };
  progress: number;
  source: EngagementStateSource;
}

export type ProjectEngagementStateUpdate = Omit<ProjectEngagementState, "source">;
