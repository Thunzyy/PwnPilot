import { useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchReportProposals, reportQueryKeys } from "@/api/report";
import { useProjectStore } from "@/stores/projectStore";

const REPORT_BADGE_REFRESH_MS = 300_000;

export function useReportBadge() {
  const queryClient = useQueryClient();
  const currentProject = useProjectStore((state) => state.currentProject);
  const projectId = currentProject?.id ?? null;

  const query = useQuery({
    queryKey: projectId ? reportQueryKeys.proposals(projectId) : ["report", "badge", "idle"],
    queryFn: () => fetchReportProposals(projectId!),
    enabled: Boolean(projectId),
    refetchInterval: REPORT_BADGE_REFRESH_MS,
  });

  return {
    pendingCount: query.data?.total ?? 0,
    isLoading: query.isLoading,
    invalidate: async () => {
      if (!projectId) return;
      await queryClient.invalidateQueries({
        queryKey: reportQueryKeys.proposals(projectId),
      });
    },
  };
}
