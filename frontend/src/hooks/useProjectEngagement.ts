import { useCallback, useEffect, useMemo, useState } from "react";
import { engagementApi } from "@/api/engagement";
import {
  addGraphNode as addGraphNodeToState,
  deleteGraphNode as deleteGraphNodeFromState,
  moveGraphNode as moveGraphNodeInState,
  updateGraphNode as updateGraphNodeInState,
} from "@/lib/engagement/stateEditing";
import type {
  EngagementChecklistSection,
  EngagementGraphNode,
  EngagementItemStatus,
  ProjectEngagementState,
  ProjectEngagementStateUpdate,
} from "@/types/engagement";

const EMPTY_ENGAGEMENT_STATE: ProjectEngagementState = {
  version: "v1",
  sections: [],
  graph: {
    nodes: [],
    edges: [],
  },
  progress: 0,
  source: "derived",
};

const STATUS_CYCLE: EngagementItemStatus[] = ["pending", "active", "done"];
const AUTO_REFRESH_INTERVAL_MS = 10000;

const nextStatus = (status: EngagementItemStatus): EngagementItemStatus => {
  const index = STATUS_CYCLE.indexOf(status);
  if (index === -1) return "pending";
  return STATUS_CYCLE[(index + 1) % STATUS_CYCLE.length];
};

const computeProgress = (sections: EngagementChecklistSection[]): number => {
  const total = sections.reduce((count, section) => count + section.items.length, 0);
  if (total === 0) return 0;
  const done = sections.reduce(
    (count, section) =>
      count + section.items.filter((item) => item.status === "done").length,
    0
  );
  return Math.round((done / total) * 100);
};

const graphNodeForStatus = (
  currentType: EngagementGraphNode["type"],
  status: EngagementItemStatus
): EngagementGraphNode["type"] => {
  if (status === "done") return "success";
  if (status === "active") return currentType === "initial" ? "initial" : "action";
  return currentType === "initial" ? "initial" : "failure";
};

const buildUpdatePayload = (
  state: ProjectEngagementState
): ProjectEngagementStateUpdate => ({
  version: state.version,
  sections: state.sections,
  graph: state.graph,
  progress: state.progress,
});

export function useProjectEngagement(projectId?: string) {
  const [state, setState] = useState<ProjectEngagementState>(
    EMPTY_ENGAGEMENT_STATE
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!projectId) {
      setState(EMPTY_ENGAGEMENT_STATE);
      return;
    }

    if (!options.silent) {
      setIsLoading(true);
    }
    setError(null);
    try {
      const response = await engagementApi.getProjectState(projectId);
      setState(response);
    } catch {
      setError("Failed to load project engagement state");
      setState(EMPTY_ENGAGEMENT_STATE);
    } finally {
      if (!options.silent) {
        setIsLoading(false);
      }
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!projectId) return;

    const intervalId = window.setInterval(() => {
      void load({ silent: true });
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [load, projectId]);

  const persist = useCallback(
    async (nextState: ProjectEngagementState) => {
      if (!projectId) return;
      try {
        const saved = await engagementApi.updateProjectState(
          projectId,
          buildUpdatePayload(nextState)
        );
        setState(saved);
        setError(null);
      } catch {
        setError("Failed to save project engagement state");
      }
    },
    [projectId]
  );

  const replaceState = useCallback(
    async (nextState: ProjectEngagementStateUpdate) => {
      if (!projectId) return;

      const optimisticState: ProjectEngagementState = {
        ...nextState,
        source: "stored",
      };

      setState(optimisticState);
      try {
        const saved = await engagementApi.updateProjectState(projectId, nextState);
        setState(saved);
        setError(null);
      } catch {
        setError("Failed to save project engagement state");
      }
    },
    [projectId]
  );

  const applyStoredUpdate = useCallback(
    (updater: (current: ProjectEngagementStateUpdate) => ProjectEngagementStateUpdate) => {
      setState((prev) => {
        const nextUpdate = updater(buildUpdatePayload(prev));
        const nextState: ProjectEngagementState = {
          ...nextUpdate,
          source: "stored",
        };
        void persist(nextState);
        return nextState;
      });
    },
    [persist]
  );

  const toggleSection = useCallback(
    (sectionId: string) => {
      setState((prev) => {
        const nextState: ProjectEngagementState = {
          ...prev,
          source: "stored",
          sections: prev.sections.map((section) =>
            section.id === sectionId
              ? { ...section, isOpen: !section.isOpen }
              : section
          ),
        };
        void persist(nextState);
        return nextState;
      });
    },
    [persist]
  );

  const toggleItem = useCallback(
    (sectionId: string, itemId: string) => {
      setState((prev) => {
        let nextItemStatus: EngagementItemStatus | null = null;

        const sections = prev.sections.map((section) => {
          if (section.id !== sectionId) {
            return section;
          }

          return {
            ...section,
            items: section.items.map((item) => {
              if (item.id !== itemId) return item;
              const status = nextStatus(item.status);
              nextItemStatus = status;
              return { ...item, status };
            }),
          };
        });

        const progress = computeProgress(sections);

        const nodes = (() => {
          if (nextItemStatus === null) {
            return prev.graph.nodes;
          }
          const status = nextItemStatus;
          return prev.graph.nodes.map((node) => {
            if (node.itemId !== itemId && node.id !== itemId) {
              return node;
            }

            return {
              ...node,
              type: graphNodeForStatus(node.type, status),
              subtitle:
                status === "done"
                  ? "Completed"
                  : status === "active"
                  ? "In progress"
                  : "Pending",
            };
          });
        })();

        const nextState: ProjectEngagementState = {
          ...prev,
          source: "stored",
          sections,
          progress,
          graph: {
            ...prev.graph,
            nodes,
          },
        };

        void persist(nextState);
        return nextState;
      });
    },
    [persist]
  );

  const updateGraphNode = useCallback(
    (
      nodeId: string,
      patch: Partial<
        Pick<
          EngagementGraphNode,
          "title" | "subtitle" | "icon" | "sectionId" | "itemId" | "status" | "position"
        >
      >
    ) => {
      applyStoredUpdate((current) => updateGraphNodeInState(current, nodeId, patch));
    },
    [applyStoredUpdate]
  );

  const addGraphNode = useCallback(
    (afterNodeId?: string | null) => {
      applyStoredUpdate((current) =>
        addGraphNodeToState(current, {
          afterNodeId,
        })
      );
    },
    [applyStoredUpdate]
  );

  const deleteGraphNode = useCallback(
    (nodeId: string) => {
      applyStoredUpdate((current) => deleteGraphNodeFromState(current, nodeId));
    },
    [applyStoredUpdate]
  );

  const moveGraphNode = useCallback(
    (nodeId: string, position: EngagementGraphNode["position"]) => {
      applyStoredUpdate((current) => moveGraphNodeInState(current, nodeId, position));
    },
    [applyStoredUpdate]
  );

  const engagementState = useMemo(() => state, [state]);

  return {
    engagementState,
    isLoading,
    error,
    refresh: load,
    toggleSection,
    toggleItem,
    replaceState,
    updateGraphNode,
    addGraphNode,
    deleteGraphNode,
    moveGraphNode,
  };
}
