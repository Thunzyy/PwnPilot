import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  Archive,
  MoreHorizontal,
  RotateCcw,
  Trash2,
  Folder,
  Clock,
  Activity,
  PauseCircle,
  CheckCircle,
  Globe,
  Server,
  ChevronDown,
} from "lucide-react";
import type { Project, UpdateProjectInput } from "../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  createProject,
  deleteProject,
  fetchProjects,
  projectQueryKeys,
  updateProject,
} from "@/api/projects";
import { engagementApi } from "@/api/engagement";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settingsStore";

const PROJECT_TYPES = ["htb", "thm", "real", "ctf", "custom"];
const EMPTY_PROJECTS: Project[] = [];

const splitTags = (value?: string) =>
  value
    ? value
        .split(/[,\n]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];

const formatHoursAgo = (iso: string, now: number) => {
  const date = new Date(iso).getTime();
  if (Number.isNaN(date)) {
    return "Last active: --";
  }
  const diff = now - date;
  const hours = Math.max(1, Math.round(diff / 3_600_000));
  return `Last active: ${hours}h ago`;
};

const getStatusStyles = (status: string) => {
  switch (status) {
    case "active":
      return {
        label: "Active",
        badge: "border-primary/40 text-primary",
        hover: "hover:border-primary/40",
        progress: "bg-primary/70",
        progressText: "text-primary",
      };
    case "paused":
      return {
        label: "Paused",
        badge: "border-accent-yellow/40 text-accent-yellow",
        hover: "hover:border-accent-yellow/40",
        progress: "bg-accent-yellow/60",
        progressText: "text-accent-yellow",
      };
    case "completed":
      return {
        label: "Completed",
        badge: "border-success-text/40 text-success-text",
        hover: "hover:border-success-text/40",
        progress: "bg-success/60",
        progressText: "text-success-text",
      };
    default:
      return {
        label: "Unknown",
        badge: "border-text-secondary/40 text-text-secondary",
        hover: "hover:border-text-secondary/40",
        progress: "bg-text-secondary/50",
        progressText: "text-text-secondary",
      };
  }
};

const getProgressForStatus = (status: string) => {
  switch (status) {
    case "completed":
      return 100;
    case "paused":
      return 42;
    case "active":
      return 65;
    default:
      return 10;
  }
};

const getEffectiveProjectStatus = (project: Project, progress?: number) =>
  typeof progress === "number" && progress >= 100 ? "completed" : project.status;

const getPrimaryTarget = (project: Project) =>
  project.variables.target_ip || project.variables.target_domain || "No target defined";

const getTargetIcon = (target: string) => {
  if (!target || target === "No target defined") {
    return Folder;
  }
  return target.includes(".") ? Globe : Server;
};

const getActionLabel = (status: string) => {
  if (status === "completed") return "View Report";
  if (status === "paused") return "View Details";
  return "Open Project";
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
};

export function Dashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workspaceBasePath = useSettingsStore(
    (state) => state.settings?.workspace_base_path
  );
  const [newProjectName, setNewProjectName] = useState("");
  const [selectedType, setSelectedType] = useState("custom");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [projectPendingDelete, setProjectPendingDelete] =
    useState<Project | null>(null);

  const projectsQuery = useQuery({
    queryKey: projectQueryKeys.all,
    queryFn: fetchProjects,
  });

  const createProjectMutation = useMutation({
    mutationFn: ({
      name,
      type,
      workspaceBase,
    }: {
      name: string;
      type: string;
      workspaceBase?: string | null;
    }) => createProject(name, type, workspaceBase),
    onSuccess: (project) => {
      queryClient.setQueryData<Project[]>(projectQueryKeys.all, (current = []) => [
        project,
        ...current.filter((candidate) => candidate.id !== project.id),
      ]);
    },
  });

  const updateProjectMutation = useMutation({
    mutationFn: ({
      projectId,
      data,
    }: {
      projectId: string;
      data: UpdateProjectInput;
    }) =>
      updateProject(projectId, data),
    onSuccess: (project) => {
      queryClient.setQueryData<Project[]>(projectQueryKeys.all, (current = []) =>
        current.map((candidate) =>
          candidate.id === project.id ? project : candidate
        )
      );
      queryClient.setQueryData(projectQueryKeys.detail(project.id), project);
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: (projectId: string) => deleteProject(projectId),
    onSuccess: (projectId) => {
      queryClient.setQueryData<Project[]>(projectQueryKeys.all, (current = []) =>
        current.filter((candidate) => candidate.id !== projectId)
      );
      queryClient.removeQueries({
        queryKey: projectQueryKeys.detail(projectId),
      });
    },
  });

  const projects = projectsQuery.data ?? EMPTY_PROJECTS;
  const projectsUpdatedAt = projectsQuery.dataUpdatedAt || 0;
  const isLoading = projectsQuery.isPending;
  const error =
    (projectsQuery.error &&
      getErrorMessage(projectsQuery.error, "Failed to fetch projects")) ||
    (createProjectMutation.error &&
      getErrorMessage(createProjectMutation.error, "Failed to create project")) ||
    (updateProjectMutation.error &&
      getErrorMessage(updateProjectMutation.error, "Failed to update project")) ||
    (deleteProjectMutation.error &&
      getErrorMessage(deleteProjectMutation.error, "Failed to delete project")) ||
    null;

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    try {
      const project = await createProjectMutation.mutateAsync({
        name: newProjectName,
        type: selectedType,
        workspaceBase: workspaceBasePath,
      });
      setNewProjectName("");
      setIsDialogOpen(false);
      navigate(`/projects/${project.id}`);
    } catch {
      // Error handled by query state
    }
  };

  const handleSelectProject = (project: Project) => {
    navigate(`/projects/${project.id}`);
  };

  const clearFilters = () => {
    setSearch("");
    setFilterStatus(null);
  };

  const handleArchive = async (project: Project) => {
    try {
      await updateProjectMutation.mutateAsync({
        projectId: project.id,
        data: { status: "completed" },
      });
    } catch {
      // Error handled by query state
    }
  };

  const handleRestore = async (project: Project) => {
    try {
      await updateProjectMutation.mutateAsync({
        projectId: project.id,
        data: { status: "active" },
      });
    } catch {
      // Error handled by query state
    }
  };

  const handleDelete = (project: Project) => {
    setProjectPendingDelete(project);
  };

  const confirmDelete = async () => {
    if (!projectPendingDelete) {
      return;
    }
    try {
      await deleteProjectMutation.mutateAsync(projectPendingDelete.id);
      setProjectPendingDelete(null);
    } catch {
      // Error handled by query state
    }
  };

  const engagementProgressQueries = useQueries({
    queries: projects.map((project) => ({
      queryKey: ["projects", project.id, "engagement-state"],
      queryFn: () => engagementApi.getProjectState(project.id),
      enabled: Boolean(project.id),
      staleTime: 10_000,
      refetchInterval: 10_000,
      retry: false,
    })),
  });

  const engagementProgressByProjectId = useMemo(() => {
    const progressByProjectId = new Map<string, number>();
    projects.forEach((project, index) => {
      const progress = engagementProgressQueries[index]?.data?.progress;
      if (typeof progress === "number") {
        progressByProjectId.set(project.id, progress);
      }
    });
    return progressByProjectId;
  }, [engagementProgressQueries, projects]);

  const filteredProjects = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return projects.filter((project) => {
      const effectiveStatus = getEffectiveProjectStatus(
        project,
        engagementProgressByProjectId.get(project.id)
      );
      const searchable = [
        project.name,
        project.variables.target_ip || "",
        project.variables.target_domain || "",
        ...splitTags(project.variables.tags),
      ]
        .join(" ")
        .toLowerCase();
      const matchesSearch =
        !normalizedSearch || searchable.includes(normalizedSearch);
      const matchesStatus =
        !filterStatus ||
        (filterStatus === "archived"
          ? project.status === "completed"
          : effectiveStatus === filterStatus);

      return matchesSearch && matchesStatus;
    });
  }, [engagementProgressByProjectId, projects, search, filterStatus]);

  const sortedProjects = useMemo(
    () =>
      [...filteredProjects].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ),
    [filteredProjects]
  );

  const stats = useMemo(
    () =>
      projects.reduce(
        (acc, project) => {
          const effectiveStatus = getEffectiveProjectStatus(
            project,
            engagementProgressByProjectId.get(project.id)
          );
          acc.total += 1;
          if (effectiveStatus === "active") {
            acc.active += 1;
          } else if (effectiveStatus === "paused") {
            acc.paused += 1;
          } else if (effectiveStatus === "completed") {
            acc.completed += 1;
          }
          return acc;
        },
        { total: 0, active: 0, paused: 0, completed: 0 }
      ),
    [engagementProgressByProjectId, projects]
  );

  const activeHours = useMemo(() => {
    return projects
      .filter(
        (project) =>
          getEffectiveProjectStatus(
            project,
            engagementProgressByProjectId.get(project.id)
          ) === "active"
      )
      .reduce((acc, project) => {
        const createdAt = new Date(project.created_at).getTime();
        if (Number.isNaN(createdAt)) return acc;
        return acc + Math.max(1, Math.round((projectsUpdatedAt - createdAt) / 3_600_000));
      }, 0);
  }, [engagementProgressByProjectId, projects, projectsUpdatedAt]);

  const hasActiveFilters = search.trim() !== "" || filterStatus;

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
      <div className="w-full flex flex-col gap-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-2 border-b border-border-dark">
          <div className="flex flex-col gap-1">
            <h1 className="text-white text-2xl font-bold tracking-tight">
              Projects Dashboard
            </h1>
            <p className="text-text-secondary text-sm font-normal max-w-2xl">
              Manage your security operations and audits.
            </p>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md h-9 px-4 bg-primary hover:bg-primary/90 transition-all text-white text-sm font-medium shadow-sm">
                <Plus className="h-4 w-4" />
                New Project
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] bg-surface-dark border-border-dark text-text-primary">
              <form onSubmit={handleCreateProject}>
                <DialogHeader>
                  <DialogTitle>Create New Project</DialogTitle>
                  <DialogDescription className="text-text-secondary">
                    Enter the details for your new pentesting engagement.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="space-y-2">
                    <label
                      htmlFor="name"
                      className="text-sm font-medium text-text-primary"
                    >
                      Project Name
                    </label>
                    <Input
                      id="name"
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                      placeholder="HTB - Forest"
                      className="bg-background-dark border-border-dark focus:ring-primary"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <label
                      htmlFor="type"
                      className="text-sm font-medium text-text-primary"
                    >
                      Target Type
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {PROJECT_TYPES.map((type) => (
                        <Badge
                          key={type}
                          variant={selectedType === type ? "default" : "outline"}
                          className={cn(
                            "cursor-pointer px-3 py-1 capitalize transition-all",
                            selectedType === type
                              ? "bg-primary text-white border-primary"
                              : "text-text-secondary border-border-dark hover:border-text-secondary"
                          )}
                          onClick={() => setSelectedType(type)}
                        >
                          {type}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="submit"
                    disabled={createProjectMutation.isPending || !newProjectName.trim()}
                    className="w-full bg-primary hover:bg-primary/90 text-white font-semibold"
                  >
                    {createProjectMutation.isPending
                      ? "Creating..."
                      : "Initialize Project"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          <div className="flex flex-col gap-1 rounded-lg p-4 bg-surface-dark border border-border-dark">
            <div className="flex items-center justify-between">
              <p className="text-text-secondary text-xs font-medium uppercase tracking-wider">
                Total Projects
              </p>
              <Folder className="h-4 w-4 text-text-secondary" />
            </div>
            <div className="flex flex-col gap-0.5 mt-2">
              <p className="text-white text-2xl font-mono font-bold">
                {stats.total}
              </p>
              <p className="text-text-secondary text-[10px] leading-tight">
                Active engagements in scope
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-1 rounded-lg p-4 bg-surface-dark border border-border-dark">
            <div className="flex items-center justify-between">
              <p className="text-success-text text-xs font-medium uppercase tracking-wider">
                Active
              </p>
              <Activity className="h-4 w-4 text-success-text" />
            </div>
            <div className="flex flex-col gap-0.5 mt-2">
              <p className="text-white text-2xl font-mono font-bold">
                {stats.active}
              </p>
              <p className="text-success-text text-[10px] leading-tight">
                Live operations in progress
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-1 rounded-lg p-4 bg-surface-dark border border-border-dark">
            <div className="flex items-center justify-between">
              <p className="text-text-secondary text-xs font-medium uppercase tracking-wider">
                Paused
              </p>
              <PauseCircle className="h-4 w-4 text-text-secondary" />
            </div>
            <div className="flex flex-col gap-0.5 mt-2">
              <p className="text-white text-2xl font-mono font-bold">
                {stats.paused}
              </p>
              <p className="text-text-secondary text-[10px] leading-tight">
                Waiting for clearance
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-1 rounded-lg p-4 bg-surface-dark border border-border-dark">
            <div className="flex items-center justify-between">
              <p className="text-text-secondary text-xs font-medium uppercase tracking-wider">
                Completed
              </p>
              <CheckCircle className="h-4 w-4 text-text-secondary" />
            </div>
            <div className="flex flex-col gap-0.5 mt-2">
              <p className="text-white text-2xl font-mono font-bold">
                {stats.completed}
              </p>
              <p className="text-text-secondary text-[10px] leading-tight">
                Missions wrapped successfully
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-1 rounded-lg p-4 bg-surface-dark border border-border-dark">
            <div className="flex items-center justify-between">
              <p className="text-text-secondary text-xs font-medium uppercase tracking-wider">
                Active Time
              </p>
              <Clock className="h-4 w-4 text-text-secondary" />
            </div>
            <div className="flex flex-col gap-0.5 mt-2">
              <p className="text-white text-2xl font-mono font-bold">
                {activeHours}h
              </p>
              <span className="text-success-text text-[10px] font-medium flex items-center leading-tight">
                +12% vs last week
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 py-1">
          <div className="flex gap-2 flex-wrap">
            {[
              { label: "All Projects", value: null },
              { label: "Active", value: "active" },
              { label: "Completed", value: "completed" },
              { label: "Archived", value: "archived" },
            ].map((filter) => (
              <Button
                key={filter.label}
                variant={filterStatus === filter.value ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterStatus(filter.value)}
                className={cn(
                  "h-8 px-3 text-xs font-medium transition-all",
                  filterStatus === filter.value
                    ? "bg-border-dark text-white"
                    : "bg-transparent border border-border-dark hover:border-text-secondary text-text-secondary hover:text-white"
                )}
              >
                {filter.label}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative w-full sm:w-40">
              <select className="w-full h-8 bg-surface-dark border border-border-dark text-text-secondary hover:text-white text-xs rounded-md px-2 focus:ring-1 focus:ring-primary focus:border-primary outline-none appearance-none cursor-pointer transition-colors">
                <option>Sort: Most Recent</option>
                <option>Sort: Criticality</option>
                <option>Sort: Progress</option>
                <option>Sort: Name</option>
              </select>
              <ChevronDown className="absolute right-2 top-1.5 text-text-secondary pointer-events-none h-4 w-4" />
            </div>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="w-full lg:max-w-md">
            <Input
              placeholder="Search projects..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="bg-background-dark border-border-dark h-9"
            />
          </div>
          <div className="flex items-center gap-3 text-xs text-text-secondary">
            <span>
              Showing {filteredProjects.length} of {projects.length}
            </span>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-3 text-text-secondary hover:text-white"
                onClick={clearFilters}
              >
                Clear filters
              </Button>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-danger/50 bg-danger/10 p-4 text-danger-text flex items-center gap-2">
            <span className="text-lg">⚠️</span> {error}
          </div>
        )}

        {isLoading && projects.length === 0 ? (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-lg border border-border-dark bg-surface-dark p-5 space-y-4"
              >
                <div className="flex items-center gap-3">
                  <div className="skeleton-shimmer size-10 rounded-md" />
                  <div className="flex-1 space-y-2">
                    <div className="skeleton-shimmer h-3 w-3/4 rounded" />
                    <div className="skeleton-shimmer h-2 w-1/2 rounded" />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="skeleton-shimmer h-2 w-full rounded" />
                  <div className="skeleton-shimmer h-2 w-5/6 rounded" />
                </div>
                <div className="flex gap-2">
                  <div className="skeleton-shimmer h-5 w-16 rounded-full" />
                  <div className="skeleton-shimmer h-5 w-12 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-lg border border-border-dark bg-surface-dark p-12 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-full bg-target-bg p-4 border border-border-dark">
                <Folder className="h-10 w-10 text-text-secondary" />
              </div>
              <div className="space-y-1">
                <div className="text-xl text-white font-semibold">
                  No Active Engagements
                </div>
                <div className="text-text-secondary">
                  Initialize your first project to start the mission.
                </div>
              </div>
              <Button
                variant="outline"
                onClick={() => setIsDialogOpen(true)}
                className="mt-4 border-border-dark text-text-secondary hover:bg-surface-dark"
              >
                <Plus className="mr-2 h-4 w-4" /> Start First Mission
              </Button>
            </div>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="rounded-lg border border-border-dark bg-surface-dark p-12 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-full bg-target-bg p-4 border border-border-dark">
                <Folder className="h-10 w-10 text-text-secondary" />
              </div>
              <div className="space-y-1">
                <div className="text-xl text-white font-semibold">
                  No Matching Projects
                </div>
                <div className="text-text-secondary">
                  Adjust your filters to see more results.
                </div>
              </div>
              {hasActiveFilters && (
                <Button
                  variant="outline"
                  onClick={clearFilters}
                  className="mt-4 border-border-dark text-text-secondary hover:bg-surface-dark"
                >
                  Clear filters
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {sortedProjects.map((project: Project) => {
              const engagementProgress = engagementProgressByProjectId.get(project.id);
              const effectiveStatus = getEffectiveProjectStatus(
                project,
                engagementProgress
              );
              const statusStyles = getStatusStyles(effectiveStatus);
              const progress =
                engagementProgress ?? getProgressForStatus(effectiveStatus);
              const target = getPrimaryTarget(project);
              const TargetIcon = getTargetIcon(target);
              return (
                <div
                  key={project.id}
                  className={cn(
                    "group flex flex-col rounded-lg bg-surface-dark border border-border-dark p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                    statusStyles.hover
                  )}
                  onClick={() => handleSelectProject(project)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
                      event.preventDefault();
                      handleSelectProject(project);
                    }
                  }}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex flex-col gap-0.5">
                      <h3 className="text-white text-sm font-semibold leading-tight group-hover:text-primary transition-colors">
                        {project.name}
                      </h3>
                      <p className="text-text-secondary text-[11px]">
                        {formatHoursAgo(project.updated_at, projectsUpdatedAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium bg-transparent",
                          statusStyles.badge
                        )}
                      >
                        {statusStyles.label}
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Project actions"
                            className="h-8 w-8 text-text-secondary hover:text-white transition-colors"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="bg-surface-dark border-border-dark text-text-primary">
                          {project.status === "completed" ? (
                            <DropdownMenuItem
                              onClick={(event) => {
                                event.stopPropagation();
                                handleRestore(project);
                              }}
                            >
                              <RotateCcw className="h-3 w-3" />
                              Restore
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={(event) => {
                                event.stopPropagation();
                                handleArchive(project);
                              }}
                            >
                              <Archive className="h-3 w-3" />
                              Archive
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator className="bg-border-dark" />
                          <DropdownMenuItem
                            onClick={(event) => {
                              event.stopPropagation();
                              handleDelete(project);
                            }}
                            className="text-danger-text focus:text-danger-text"
                          >
                            <Trash2 className="h-3 w-3" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  <div className="mb-4 px-2.5 py-2 rounded bg-target-bg border border-border-dark flex items-center gap-2">
                    <TargetIcon className="h-4 w-4 text-text-secondary" />
                    <span className="text-xs font-mono text-text-primary truncate">
                      {target}
                    </span>
                  </div>

                  <div className="flex flex-col gap-1.5 mb-4 mt-auto">
                    <div className="flex justify-between items-end">
                      <span className="text-[10px] font-medium text-text-secondary">
                        Progress
                      </span>
                      <span className="text-[10px] font-mono text-text-secondary ml-auto mr-3">
                        Time: {Math.max(1, Math.round((projectsUpdatedAt - new Date(project.created_at).getTime()) / 3_600_000))}h
                      </span>
                      <span
                        className={cn(
                          "text-[10px] font-mono",
                          statusStyles.progressText
                        )}
                      >
                        {progress}%
                      </span>
                    </div>
                    <div className="h-[3px] w-full rounded-full bg-border-dark overflow-hidden">
                      <div
                        className={cn("h-full rounded-full", statusStyles.progress)}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleSelectProject(project);
                    }}
                    className="w-full py-1.5 rounded border border-border-dark bg-transparent text-text-secondary text-xs font-medium hover:border-primary/40 hover:text-white transition-colors"
                  >
                    {getActionLabel(effectiveStatus)}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <AlertDialog
        open={Boolean(projectPendingDelete)}
        onOpenChange={(open) => {
          if (!open) {
            setProjectPendingDelete(null);
          }
        }}
      >
        <AlertDialogContent className="border-border-dark bg-surface-dark text-text-primary">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription className="text-text-secondary">
              This permanently removes{" "}
              <span className="font-medium text-text-primary">
                {projectPendingDelete?.name ?? "this project"}
              </span>
              . This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border-dark bg-transparent text-text-secondary hover:bg-surface-highlight hover:text-text-primary">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
              className="bg-danger-text text-white hover:bg-danger-text/90"
              disabled={deleteProjectMutation.isPending}
            >
              {deleteProjectMutation.isPending ? "Deleting..." : "Delete project"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
