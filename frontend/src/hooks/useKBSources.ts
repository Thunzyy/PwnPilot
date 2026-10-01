import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchKBSources, kbSourceQueryKeys, mapKBSourcesError } from "@/api/kbSources";
import { useKBStore } from "@/stores/kbStore";

export function useKBSources(projectId?: string | null) {
  const storedSources = useKBStore((state) => state.sources);
  const hasStoredSources = projectId == null && storedSources.length > 0;

  const query = useQuery({
    queryKey: kbSourceQueryKeys.list(projectId),
    queryFn: () => fetchKBSources(projectId),
    initialData: hasStoredSources ? storedSources : undefined,
  });

  const sources = query.data ?? storedSources;
  const isLoading = query.isPending && sources.length === 0;
  const error = query.isFetching
    ? null
    : query.isError
      ? mapKBSourcesError(query.error)
      : null;

  useEffect(() => {
    const state = useKBStore.getState();
    if (
      state.sources === sources &&
      state.isLoading === isLoading &&
      state.error === error
    ) {
      return;
    }

    useKBStore.setState({
      sources,
      isLoading,
      error,
    });
  }, [error, isLoading, sources]);

  return {
    sources,
    isLoading,
    isRefreshing: query.isFetching && !isLoading,
    error,
    refreshSources: query.refetch,
  };
}
