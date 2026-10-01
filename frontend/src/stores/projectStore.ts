import { create } from "zustand";
import type { Project, UpdateProjectInput } from "../types";
import {
  createProject as createProjectRequest,
  deleteProject as deleteProjectRequest,
  fetchProject as fetchProjectRequest,
  fetchProjects as fetchProjectsRequest,
  projectQueryKeys,
  updateProject as updateProjectRequest,
} from "../api/projects";
import { queryClient } from "../lib/queryClient";
import { useSettingsStore } from "./settingsStore";

interface ProjectState {
  projects: Project[];
  currentProject: Project | null;
  isLoading: boolean;
  error: string | null;
  fetchProjects: () => Promise<void>;
  fetchProject: (id: string) => Promise<Project>;
  createProject: (name: string, type?: string) => Promise<Project>;
  updateProject: (id: string, data: UpdateProjectInput) => Promise<Project>;
  selectProject: (project: Project | null) => void;
  deleteProject: (id: string) => Promise<void>;
}

const upsertProject = (projects: Project[], project: Project) => {
  const existingIndex = projects.findIndex(
    (candidate) => candidate.id === project.id
  );

  if (existingIndex === -1) {
    return [project, ...projects];
  }

  const next = [...projects];
  next[existingIndex] = project;
  return next;
};

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  currentProject: null,
  isLoading: false,
  error: null,

  fetchProjects: async () => {
    set({ isLoading: true, error: null });
    try {
      const projects = await fetchProjectsRequest();
      queryClient.setQueryData(projectQueryKeys.all, projects);
      set({ projects, isLoading: false });
    } catch {
      set({ error: "Failed to fetch projects", isLoading: false });
    }
  },

  fetchProject: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const project = await fetchProjectRequest(id);
      queryClient.setQueryData(projectQueryKeys.detail(id), project);
      queryClient.setQueryData<Project[]>(projectQueryKeys.all, (current = []) =>
        upsertProject(current, project)
      );
      set((state) => {
        return {
          projects: upsertProject(state.projects, project),
          currentProject: project,
          isLoading: false,
        };
      });
      return project;
    } catch {
      set({ error: "Project not found", isLoading: false });
      throw new Error("Failed to fetch project");
    }
  },

  createProject: async (name: string, type = "custom") => {
    set({ isLoading: true, error: null });
    try {
      const workspace_base = useSettingsStore.getState().settings?.workspace_base_path;
      const newProject = await createProjectRequest(name, type, workspace_base);
      queryClient.setQueryData(projectQueryKeys.detail(newProject.id), newProject);
      queryClient.setQueryData<Project[]>(projectQueryKeys.all, (current = []) =>
        upsertProject(current, newProject)
      );
      set((state) => ({
        projects: upsertProject(state.projects, newProject),
        currentProject: newProject,
        isLoading: false,
      }));
      return newProject;
    } catch {
      set({ error: "Failed to create project", isLoading: false });
      throw new Error("Failed to create project");
    }
  },

  updateProject: async (id: string, data: UpdateProjectInput) => {
    set({ isLoading: true, error: null });
    try {
      const updatedProject = await updateProjectRequest(id, data);
      queryClient.setQueryData(projectQueryKeys.detail(id), updatedProject);
      queryClient.setQueryData<Project[]>(projectQueryKeys.all, (current = []) =>
        upsertProject(current, updatedProject)
      );
      set((state) => ({
        projects: upsertProject(state.projects, updatedProject),
        currentProject:
          state.currentProject?.id === id
            ? updatedProject
            : state.currentProject,
        isLoading: false,
      }));
      return updatedProject;
    } catch {
      set({ error: "Failed to update project", isLoading: false });
      throw new Error("Failed to update project");
    }
  },

  selectProject: (project) => {
    set({ currentProject: project });
  },

  deleteProject: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await deleteProjectRequest(id);
      queryClient.removeQueries({
        queryKey: projectQueryKeys.detail(id),
      });
      queryClient.setQueryData<Project[]>(projectQueryKeys.all, (current = []) =>
        current.filter((candidate) => candidate.id !== id)
      );
      set((state) => ({
        projects: state.projects.filter((p) => p.id !== id),
        currentProject:
          state.currentProject?.id === id ? null : state.currentProject,
        isLoading: false,
      }));
    } catch {
      set({ error: "Failed to delete project", isLoading: false });
    }
  },
}));
