import { useEffect, useState, type ChangeEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useParams,
  useNavigate,
  type NavigateFunction,
} from "react-router-dom";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Project, ProjectVariables } from "../types";
import { fetchSettings, settingsQueryKeys } from "@/api/settings";
import { getVpnPlatformList, type NormalizedVpnPlatformProfile } from "@/lib/vpn";
import { getProjectAccessErrorState } from "@/api/projects";
import { useProjectDetail } from "@/hooks/useProjectDetail";
import { useProjectStore } from "../stores/projectStore";
import { useAuthStore } from "@/stores/authStore";
import { ProjectAccessState } from "../components/Projects/ProjectAccessState";
import { ProjectTeamPanel } from "../components/Projects/ProjectTeamPanel";
import { SystemPromptSelector } from "../components/Settings/SystemPromptSelector";

const sections = [
  { id: "overview", label: "Overview" },
  { id: "variables", label: "Variables" },
  { id: "ai-prompt", label: "AI Prompt" },
  { id: "vpn", label: "VPN" },
  { id: "notes", label: "Notes" },
  { id: "team", label: "Team" },
  { id: "danger", label: "Danger Zone" },
];

const PROJECT_TYPES: Project["type"][] = [
  "htb",
  "thm",
  "real",
  "ctf",
  "custom",
];

const PROJECT_STATUSES: Project["status"][] = [
  "active",
  "paused",
  "completed",
];

const DEFAULT_VARIABLES = [
  { key: "target_ip", placeholder: "e.g., 10.10.10.5" },
  { key: "target_domain", placeholder: "e.g., target.htb" },
  { key: "attacker_ip", placeholder: "e.g., 10.10.14.12" },
  { key: "attacker_port", placeholder: "e.g., 4444" },
  { key: "scope", placeholder: "e.g., 10.10.10.0/24" },
  { key: "os", placeholder: "e.g., Windows Server 2019" },
  { key: "credentials", placeholder: "e.g., admin:Passw0rd!" },
  { key: "tags", placeholder: "e.g., web, auth, lateral" },
  { key: "notes", placeholder: "e.g., test plan or constraints" },
  { key: "priority", placeholder: "e.g., high" },
  { key: "deadline", placeholder: "e.g., 2025-06-30" },
  { key: "vpn_path", placeholder: "e.g., /opt/vpns/target.ovpn" },
  { key: "vpn_connect_command", placeholder: "e.g., sudo openvpn {{vpn_path}}" },
  { key: "vpn_content", placeholder: "e.g., inline ovpn content" },
];

interface VariableRow {
  id: string;
  key: string;
  value: string;
}

const buildOverviewState = (project: Project) => ({
  name: project.name,
  type: project.type,
  status: project.status,
});

const buildVariableRows = (variables: ProjectVariables = {}) => {
  const existingRows: VariableRow[] = Object.entries(variables)
    .filter(([, value]) => value !== undefined)
    .map(([key, value], index) => ({
      id: `existing-${index}`,
      key,
      value: value || "",
    }));

  const missingDefaults = DEFAULT_VARIABLES.filter(
    (def) => !existingRows.some((row) => row.key === def.key)
  ).map((def, index) => ({
    id: `default-${index}`,
    key: def.key,
    value: "",
  }));

  return [...existingRows, ...missingDefaults];
};

const buildVpnState = (variables: ProjectVariables = {}) => ({
  platform: variables.vpn_platform || "",
  path: variables.vpn_path || "",
  command: variables.vpn_connect_command || "",
  content: variables.vpn_content || "",
});

interface ProjectSettingsContentProps {
  deleteProject: (projectId: string) => Promise<unknown>;
  navigate: NavigateFunction;
  project: Project;
  vpnPlatforms: NormalizedVpnPlatformProfile[];
  updateProject: (
    projectId: string,
    payload: Partial<Project>
  ) => Promise<unknown>;
}

function ProjectSettingsContent({
  deleteProject,
  navigate,
  project,
  vpnPlatforms,
  updateProject,
}: ProjectSettingsContentProps) {
  const [overview, setOverview] = useState(() => buildOverviewState(project));
  const [variableRows, setVariableRows] = useState(() =>
    buildVariableRows(project.variables)
  );
  const [vpn, setVpn] = useState(() => buildVpnState(project.variables));
  const [notes, setNotes] = useState(() => project.variables.notes || "");
  const [isSavingOverview, setIsSavingOverview] = useState(false);
  const [isSavingVariables, setIsSavingVariables] = useState(false);
  const [isSavingVpn, setIsSavingVpn] = useState(false);
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [isDeletingProject, setIsDeletingProject] = useState(false);

  const handleOverviewChange =
    (field: "name" | "type" | "status") =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setOverview((prev) => ({ ...prev, [field]: event.target.value }));
    };

  const handleOverviewSave = async () => {
    const nextName = overview.name.trim() || project.name;
    setIsSavingOverview(true);
    try {
      await updateProject(project.id, {
        name: nextName,
        type: overview.type,
        status: overview.status,
      });
    } finally {
      setIsSavingOverview(false);
    }
  };

  const handleVariableChange = (
    id: string,
    field: "key" | "value",
    value: string
  ) => {
    setVariableRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, [field]: value } : row))
    );
  };

  const handleVariableAdd = () => {
    setVariableRows((prev) => [
      ...prev,
      { id: `new-${Date.now()}`, key: "", value: "" },
    ]);
  };

  const handleVariableRemove = (id: string) => {
    setVariableRows((prev) => prev.filter((row) => row.id !== id));
  };

  const handleVariablesSave = async () => {
    const nextVariables: ProjectVariables = {};
    variableRows.forEach((row) => {
      const key = row.key.trim();
      if (!key) return;
      const value = row.value.trim();
      nextVariables[key] = value || undefined;
    });
    setIsSavingVariables(true);
    try {
      await updateProject(project.id, {
        variables: nextVariables,
      });
    } finally {
      setIsSavingVariables(false);
    }
  };

  const getVariablePlaceholder = (key: string) => {
    const match = DEFAULT_VARIABLES.find((item) => item.key === key);
    return match?.placeholder || "Value";
  };

  const handleVpnSave = async () => {
    const nextVariables: ProjectVariables = {
      ...project.variables,
      vpn_platform: vpn.platform.trim() || undefined,
      vpn_path: vpn.path.trim() || undefined,
      vpn_connect_command: vpn.command.trim() || undefined,
      vpn_content: vpn.content.trim() || undefined,
    };
    setIsSavingVpn(true);
    try {
      await updateProject(project.id, {
        variables: nextVariables,
      });
    } finally {
      setIsSavingVpn(false);
    }
  };

  const handleNotesSave = async () => {
    const nextVariables: ProjectVariables = {
      ...project.variables,
      notes: notes.trim() || undefined,
    };
    setIsSavingNotes(true);
    try {
      await updateProject(project.id, {
        variables: nextVariables,
      });
    } finally {
      setIsSavingNotes(false);
    }
  };

  const handleDeleteProject = async () => {
    if (!window.confirm("Delete this project? This action cannot be undone.")) {
      return;
    }
    setIsDeletingProject(true);
    try {
      await deleteProject(project.id);
      navigate("/");
    } finally {
      setIsDeletingProject(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-[#0b0f17]">
      <div className="flex items-center justify-between border-b border-white/5 bg-[#1a2030]/60 px-6 py-4">
        <div>
          <div className="text-xs uppercase tracking-[0.35em] text-slate-500">
            Project Settings
          </div>
          <div className="text-2xl font-semibold text-white">
            {project.name}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(`/projects/${project.id}`)}
          className="text-slate-300 hover:text-white"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Project
        </Button>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-64 border-r border-white/5 bg-[#0e1420] px-5 py-6">
          <div className="text-xs uppercase tracking-[0.3em] text-slate-500">
            Sections
          </div>
          <nav className="mt-4 flex flex-col gap-2 text-sm">
            {sections.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="rounded-md border border-transparent px-3 py-2 text-slate-300 hover:border-white/10 hover:bg-white/[0.03] hover:text-white"
              >
                {section.label}
              </a>
            ))}
          </nav>
        </aside>

        <div className="flex-1 overflow-y-auto px-6 py-8">
          <div className="space-y-10">
            <section id="overview">
              <h3 className="text-sm font-semibold text-white">Overview</h3>
              <div className="mt-3 rounded-lg border border-white/5 bg-[#121722] p-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor="project-name"
                      className="text-xs uppercase tracking-[0.2em] text-slate-500"
                    >
                      Project Name
                    </label>
                    <Input
                      id="project-name"
                      value={overview.name}
                      onChange={handleOverviewChange("name")}
                      className="bg-black/30 border-white/10 text-slate-200"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor="project-type"
                      className="text-xs uppercase tracking-[0.2em] text-slate-500"
                    >
                      Type
                    </label>
                    <select
                      id="project-type"
                      value={overview.type}
                      onChange={handleOverviewChange("type")}
                      className="h-10 rounded-md border border-white/10 bg-black/30 px-3 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary/60"
                    >
                      {PROJECT_TYPES.map((option) => (
                        <option key={option} value={option}>
                          {option.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor="project-status"
                      className="text-xs uppercase tracking-[0.2em] text-slate-500"
                    >
                      Status
                    </label>
                    <select
                      id="project-status"
                      value={overview.status}
                      onChange={handleOverviewChange("status")}
                      className="h-10 rounded-md border border-white/10 bg-black/30 px-3 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary/60"
                    >
                      {PROJECT_STATUSES.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <Button
                    onClick={handleOverviewSave}
                    disabled={isSavingOverview}
                  >
                    Save Overview
                  </Button>
                </div>
              </div>
            </section>

            <section id="variables">
              <h3 className="text-sm font-semibold text-white">Variables</h3>
              <div className="mt-3 rounded-lg border border-white/5 bg-[#121722] p-5">
                <div className="space-y-3">
                  {variableRows.map((row) => (
                    <div key={row.id} className="flex items-center gap-2">
                      <Input
                        aria-label="Variable Key"
                        value={row.key}
                        onChange={(event) =>
                          handleVariableChange(row.id, "key", event.target.value)
                        }
                        placeholder="variable_name"
                        className="flex-1 bg-black/30 border-white/10 font-mono text-xs text-slate-200"
                      />
                      <Input
                        aria-label="Variable Value"
                        value={row.value}
                        onChange={(event) =>
                          handleVariableChange(row.id, "value", event.target.value)
                        }
                        placeholder={getVariablePlaceholder(row.key)}
                        className="flex-[2] bg-black/30 border-white/10 text-xs text-slate-200"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleVariableRemove(row.id)}
                        className="h-8 w-8 text-slate-500 hover:text-red-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleVariableAdd}
                  className="mt-4 w-full border-dashed border-white/10 text-slate-400 hover:text-white"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Variable
                </Button>

                <div className="mt-4 flex justify-end">
                  <Button
                    onClick={handleVariablesSave}
                    disabled={isSavingVariables}
                  >
                    Save Variables
                  </Button>
                </div>
              </div>
            </section>

            <section id="ai-prompt">
              <h3 className="text-sm font-semibold text-white">AI System Prompt</h3>
              <div className="mt-3 rounded-lg border border-white/5 bg-[#121722] p-5">
                <SystemPromptSelector
                  scope="project"
                  description="Select a system prompt template for this project. Overrides the global default."
                />
              </div>
            </section>

            <section id="vpn">
              <h3 className="text-sm font-semibold text-white">VPN</h3>
              <div className="mt-3 rounded-lg border border-white/5 bg-[#121722] p-5">
                <div className="grid gap-4">
                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor="vpn-platform"
                      className="text-xs uppercase tracking-[0.2em] text-slate-500"
                    >
                      VPN Platform
                    </label>
                    <select
                      id="vpn-platform"
                      value={vpn.platform}
                      onChange={(event) =>
                        setVpn((prev) => ({
                          ...prev,
                          platform: event.target.value,
                        }))
                      }
                      className="h-10 rounded-md border border-white/10 bg-black/30 px-3 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary/60"
                    >
                      <option value="">Use project type default</option>
                      {vpnPlatforms.map((platform) => (
                        <option key={platform.id} value={platform.id}>
                          {platform.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor="vpn-path"
                      className="text-xs uppercase tracking-[0.2em] text-slate-500"
                    >
                      VPN file path
                    </label>
                    <Input
                      id="vpn-path"
                      value={vpn.path}
                      onChange={(event) =>
                        setVpn((prev) => ({ ...prev, path: event.target.value }))
                      }
                      className="bg-black/30 border-white/10 text-slate-200"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor="vpn-command"
                      className="text-xs uppercase tracking-[0.2em] text-slate-500"
                    >
                      VPN connect command
                    </label>
                    <Input
                      id="vpn-command"
                      value={vpn.command}
                      onChange={(event) =>
                        setVpn((prev) => ({
                          ...prev,
                          command: event.target.value,
                        }))
                      }
                      className="bg-black/30 border-white/10 text-slate-200 font-mono"
                    />
                    <p className="text-xs text-slate-500">
                      Tokens available: <code>{"{{vpn_path}}"}</code>,{" "}
                      <code>{"{{project_slug}}"}</code>, <code>{"{{project_path}}"}</code>.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor="vpn-content"
                      className="text-xs uppercase tracking-[0.2em] text-slate-500"
                    >
                      VPN file content
                    </label>
                    <textarea
                      id="vpn-content"
                      value={vpn.content}
                      onChange={(event) =>
                        setVpn((prev) => ({
                          ...prev,
                          content: event.target.value,
                        }))
                      }
                      className="min-h-[140px] rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary/60"
                    />
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <Button onClick={handleVpnSave} disabled={isSavingVpn}>
                    Save VPN
                  </Button>
                </div>
              </div>
            </section>

            <section id="notes">
              <h3 className="text-sm font-semibold text-white">Notes</h3>
              <div className="mt-3 rounded-lg border border-white/5 bg-[#121722] p-5">
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="project-notes"
                    className="text-xs uppercase tracking-[0.2em] text-slate-500"
                  >
                    Notes
                  </label>
                  <textarea
                    id="project-notes"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    className="min-h-[160px] rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary/60"
                  />
                </div>
                <div className="mt-4 flex justify-end">
                  <Button onClick={handleNotesSave} disabled={isSavingNotes}>
                    Save Notes
                  </Button>
                </div>
              </div>
            </section>

            <section id="team">
              <h3 className="text-sm font-semibold text-white">Team</h3>
              <div className="mt-3 rounded-lg border border-white/5 bg-[#121722] p-5">
                <ProjectTeamPanel projectId={project.id} />
              </div>
            </section>

            <section id="danger">
              <h3 className="text-sm font-semibold text-white">Danger Zone</h3>
              <div className="mt-3 rounded-lg border border-rose-500/20 bg-[#121722] p-5">
                <div className="text-sm text-slate-400">
                  Deleting a project removes its workspace and membership data.
                  This cannot be undone.
                </div>
                <div className="mt-4 flex justify-end">
                  <Button
                    onClick={handleDeleteProject}
                    disabled={isDeletingProject}
                    className="bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                  >
                    Delete Project
                  </Button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProjectSettingsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { updateProject, deleteProject } = useProjectStore();
  const canReadGlobalSettings = useAuthStore(
    (state) => state.user?.is_super_admin === true
  );
  const { project, error: projectError, isPending: isProjectPending } =
    useProjectDetail(projectId);
  const settingsQuery = useQuery({
    queryKey: settingsQueryKeys.current,
    queryFn: fetchSettings,
    enabled: canReadGlobalSettings,
    retry: false,
  });
  const globalSettings = canReadGlobalSettings ? settingsQuery.data ?? null : null;
  const projectAccessError = getProjectAccessErrorState(projectError);

  useEffect(() => {
    if (projectId && projectError && !projectAccessError) {
      navigate("/", { replace: true });
    }
  }, [navigate, projectAccessError, projectError, projectId]);

  if (projectAccessError && projectId) {
    return (
      <ProjectAccessState
        projectId={projectId}
        initialStatus={projectAccessError.membershipStatus}
        onBackToDashboard={() => navigate("/", { replace: true })}
      />
    );
  }

  if (isProjectPending || !project) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0b0f17]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <ProjectSettingsContent
      key={`${project.id}:${project.updated_at}`}
      deleteProject={deleteProject}
      navigate={navigate}
      project={project}
      vpnPlatforms={getVpnPlatformList(globalSettings)}
      updateProject={updateProject}
    />
  );
}
