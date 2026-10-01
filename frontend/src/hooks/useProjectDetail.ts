import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  fetchProject,
  getApiErrorStatus,
  projectQueryKeys,
} from "../api/projects";
import { useProjectStore } from "../stores/projectStore";

export function useProjectDetail(projectId: string | undefined) {
  const { currentProject, selectProject } = useProjectStore();

  const query = useQuery({
    queryKey: projectQueryKeys.detail(projectId ?? ""),
    queryFn: () => fetchProject(projectId!),
    enabled: Boolean(projectId),
    retry: (failureCount, error) => {
      const status = getApiErrorStatus(error);
      if (status !== null && status >= 400 && status < 500) {
        return false;
      }

      return failureCount < 1;
    },
    initialData:
      projectId && currentProject?.id === projectId ? currentProject : undefined,
  });

  const project = query.data ?? null;

  useEffect(() => {
    if (!projectId) {
      selectProject(null);
      return;
    }

    if (project && currentProject !== project) {
      selectProject(project);
      return;
    }

    if (!project && currentProject?.id && currentProject.id !== projectId) {
      selectProject(null);
    }
  }, [currentProject, project, projectId, selectProject]);

  return {
    ...query,
    project,
  };
}
