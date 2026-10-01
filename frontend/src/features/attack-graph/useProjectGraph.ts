import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { graphClient } from "./api/graphClient";
import type { AttackGraphData, AttackGraphPath } from "./types";

const EMPTY_GRAPH: AttackGraphData = {
  projectId: "",
  source: "stored",
  nodes: [],
  edges: [],
  scenarios: [],
  activeScenarioId: null,
};

export function useProjectGraph(projectId?: string) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["graph", projectId],
    queryFn: () => graphClient.getProjectGraph(projectId!),
    enabled: Boolean(projectId),
  });

  const proposalsQuery = useQuery({
    queryKey: ["graph-proposals", projectId],
    queryFn: () => graphClient.listProjectProposals(projectId!),
    enabled: Boolean(projectId),
  });

  const seedMutation = useMutation({
    mutationFn: async () => graphClient.seedDemoCtf(projectId!),
    onSuccess: (graph) => {
      queryClient.setQueryData(["graph", projectId], graph);
    },
  });

  const pathMutation = useMutation({
    mutationFn: async ({
      fromId,
      toId,
    }: {
      fromId: string;
      toId: string;
    }) => graphClient.getShortestPath(projectId!, fromId, toId),
  });

  const updatePositionMutation = useMutation({
    mutationFn: async ({
      nodeId,
      position,
    }: {
      nodeId: string;
      position: { x: number; y: number };
    }) => graphClient.updateNodePosition(projectId!, nodeId, position),
    onMutate: async ({ nodeId, position }) => {
      await queryClient.cancelQueries({ queryKey: ["graph", projectId] });
      const previous = queryClient.getQueryData<AttackGraphData>([
        "graph",
        projectId,
      ]);
      if (previous) {
        queryClient.setQueryData(["graph", projectId], {
          ...previous,
          nodes: previous.nodes.map((node) =>
            node.id === nodeId
              ? {
                  ...node,
                  position,
                  meta: {
                    ...node.meta,
                    position_pinned: true,
                  },
                }
              : node
          ),
        });
      }
      return { previous };
    },
    onSuccess: (updatedNode) => {
      queryClient.setQueryData<AttackGraphData>(["graph", projectId], (current) => {
        if (!current) return current;
        return {
          ...current,
          nodes: current.nodes.map((node) =>
            node.id === updatedNode.id ? updatedNode : node
          ),
        };
      });
      void queryClient.invalidateQueries({ queryKey: ["graph", projectId] });
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(["graph", projectId], ctx.previous);
      }
    },
  });

  const acceptProposalMutation = useMutation({
    mutationFn: async (proposalId: string) =>
      graphClient.acceptProposal(projectId!, proposalId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["graph", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["graph-proposals", projectId] }),
      ]);
    },
  });

  return {
    graph: query.data ?? { ...EMPTY_GRAPH, projectId: projectId ?? "" },
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    proposals: proposalsQuery.data?.items ?? [],
    isProposalsLoading: proposalsQuery.isLoading,
    isSeeding: seedMutation.isPending,
    seedDemoCtf: () => seedMutation.mutateAsync(),
    isPathLoading: pathMutation.isPending,
    pathResult: (pathMutation.data?.[0] ?? null) as AttackGraphPath | null,
    loadShortestPath: (fromId: string, toId: string) =>
      pathMutation.mutateAsync({ fromId, toId }),
    acceptingProposalId: acceptProposalMutation.isPending
      ? (acceptProposalMutation.variables ?? null)
      : null,
    acceptProposal: (proposalId: string) =>
      acceptProposalMutation.mutateAsync(proposalId),
    updateNodePosition: (nodeId: string, position: { x: number; y: number }) =>
      updatePositionMutation.mutateAsync({ nodeId, position }),
  };
}
