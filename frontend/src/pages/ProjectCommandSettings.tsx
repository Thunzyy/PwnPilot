import { useEffect, useState } from "react";
import { ArrowLeft, Save } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { VariablesPanel } from "@/components/Commands/VariablesPanel";
import { CommandSettingsSections } from "@/components/Commands/CommandSettingsSections";
import { useProjectDetail } from "@/hooks/useProjectDetail";
import { useCommandSettingsStore } from "@/stores/commandSettingsStore";
import { useProjectStore } from "@/stores/projectStore";
import type { ProjectVariables } from "@/types";

type CommandSettingsStoreState = ReturnType<typeof useCommandSettingsStore.getState>;
type ProjectStoreState = ReturnType<typeof useProjectStore.getState>;

function toDraftVariables(variables?: ProjectVariables) {
  const nextVariables: Record<string, string> = {};
  Object.entries(variables || {}).forEach(([key, value]) => {
    if (value !== undefined) {
      nextVariables[key] = value ?? "";
    }
  });
  return nextVariables;
}

function ProjectCommandSettingsContent({
  projectId,
  project,
  isLoading,
  loadProjectSettings,
  updateProject,
  navigate,
}: {
  projectId: string;
  project: NonNullable<ReturnType<typeof useProjectDetail>["project"]>;
  isLoading: boolean;
  loadProjectSettings: CommandSettingsStoreState["loadProjectSettings"];
  updateProject: ProjectStoreState["updateProject"];
  navigate: ReturnType<typeof useNavigate>;
}) {
  const [draftVariables, setDraftVariables] = useState<Record<string, string>>(
    () => toDraftVariables(project.variables)
  );

  useEffect(() => {
    loadProjectSettings(projectId);
  }, [loadProjectSettings, projectId]);

  const handleVariableChange = (key: string, value: string) => {
    setDraftVariables((prev) => ({ ...prev, [key]: value }));
  };

  const handleVariableRemove = (key: string) => {
    setDraftVariables((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleVariableAdd = (key: string, value: string) => {
    setDraftVariables((prev) => ({ ...prev, [key]: value }));
  };

  const handleVariableReset = () => {
    setDraftVariables(toDraftVariables(project.variables));
  };

  const handleVariableSave = async () => {
    const nextVariables: ProjectVariables = {};
    Object.entries(draftVariables).forEach(([key, value]) => {
      const trimmedKey = key.trim();
      if (!trimmedKey) return;
      const trimmedValue = value.trim();
      nextVariables[trimmedKey] = trimmedValue || undefined;
    });
    await updateProject(project.id, { variables: nextVariables });
  };

  return (
    <div className="flex-1 overflow-auto bg-background-dark">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-white">
              Project Command Settings
            </h2>
            <p className="text-sm text-slate-400">
              Manage project-specific commands, filters, and variables.
            </p>
          </div>
          <Button
            variant="ghost"
            onClick={() => navigate(`/projects/${projectId}`)}
            className="h-9 justify-start gap-2 text-slate-400 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to project
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-3 rounded-md border border-border-dark bg-card-dark px-4 py-3 text-sm text-slate-300">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Syncing project command settings...
          </div>
        ) : null}

        <CommandSettingsSections scope="project" projectId={projectId} />

        <section className="bg-card-dark border border-border-dark rounded-md p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Variables</h3>
            <Button size="sm" onClick={handleVariableSave}>
              <Save className="h-4 w-4" />
              Save Variables
            </Button>
          </div>
          <VariablesPanel
            title="Project Variables"
            variables={draftVariables}
            onVariableChange={handleVariableChange}
            onVariableRemove={handleVariableRemove}
            onVariableAdd={handleVariableAdd}
            onReset={handleVariableReset}
          />
        </section>
      </div>
    </div>
  );
}

export function ProjectCommandSettingsPage() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const updateProject = useProjectStore((state) => state.updateProject);
  const { project } = useProjectDetail(projectId);
  const isLoading = useCommandSettingsStore((state) => state.isLoading);
  const loadProjectSettings = useCommandSettingsStore(
    (state) => state.loadProjectSettings
  );

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center bg-background-dark text-text-muted">
        Project not found.
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center bg-background-dark text-text-muted">
        Loading project settings...
      </div>
    );
  }

  return (
    <ProjectCommandSettingsContent
      key={project.id}
      projectId={projectId}
      project={project}
      isLoading={isLoading}
      loadProjectSettings={loadProjectSettings}
      updateProject={updateProject}
      navigate={navigate}
    />
  );
}
