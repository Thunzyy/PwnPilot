import { api } from "./client";

export interface Command {
  id: string;
  name: string;
  category: string;
  command: string;
  description: string | null;
  tags: string[];
  is_custom: boolean;
  scope: "global" | "project";
  project_id: string | null;
}

export interface CommandInput {
  name: string;
  category: string;
  command: string;
  description?: string | null;
  tags?: string[];
  is_custom?: boolean;
}

export interface CommandUpdate {
  name?: string;
  category?: string;
  command?: string;
  description?: string | null;
  tags?: string[];
  is_custom?: boolean;
}

export interface CommandCategory {
  id: string;
  name: string;
  sort_order: number | null;
  scope: "global" | "project";
  project_id: string | null;
}

export interface CommandCategoryInput {
  name: string;
  sort_order?: number | null;
}

export interface CommandCategoryUpdate {
  name?: string;
  sort_order?: number | null;
}

export interface CommandFilter {
  id: string;
  name: string;
  sort_order: number | null;
  scope: "global" | "project";
  project_id: string | null;
}

export interface CommandFilterInput {
  name: string;
  sort_order?: number | null;
}

export interface CommandFilterUpdate {
  name?: string;
  sort_order?: number | null;
}

export type CommandVariables = Record<string, string>;

export const commandsApi = {
  listGlobalCommands: () =>
    api.get<Command[]>("/commands").then((r) => r.data),
  seedGlobalCommands: () => api.post("/commands/seed").then((r) => r.data),
  createGlobalCommand: (data: CommandInput) =>
    api.post<Command>("/commands", data).then((r) => r.data),
  updateGlobalCommand: (id: string, data: CommandUpdate) =>
    api.put<Command>(`/commands/${id}`, data).then((r) => r.data),
  deleteGlobalCommand: (id: string) => api.delete(`/commands/${id}`),

  listProjectCommands: (projectId: string) =>
    api.get<Command[]>(`/projects/${projectId}/commands`).then((r) => r.data),
  createProjectCommand: (projectId: string, data: CommandInput) =>
    api.post<Command>(`/projects/${projectId}/commands`, data).then((r) => r.data),
  updateProjectCommand: (
    projectId: string,
    id: string,
    data: CommandUpdate
  ) =>
    api
      .put<Command>(`/projects/${projectId}/commands/${id}`, data)
      .then((r) => r.data),
  deleteProjectCommand: (projectId: string, id: string) =>
    api.delete(`/projects/${projectId}/commands/${id}`),

  listGlobalCategories: () =>
    api.get<CommandCategory[]>("/command-categories").then((r) => r.data),
  createGlobalCategory: (data: CommandCategoryInput) =>
    api.post<CommandCategory>("/command-categories", data).then((r) => r.data),
  updateGlobalCategory: (id: string, data: CommandCategoryUpdate) =>
    api.put<CommandCategory>(`/command-categories/${id}`, data).then((r) => r.data),
  deleteGlobalCategory: (id: string) =>
    api.delete(`/command-categories/${id}`),

  listProjectCategories: (projectId: string) =>
    api
      .get<CommandCategory[]>(`/projects/${projectId}/command-categories`)
      .then((r) => r.data),
  createProjectCategory: (projectId: string, data: CommandCategoryInput) =>
    api
      .post<CommandCategory>(`/projects/${projectId}/command-categories`, data)
      .then((r) => r.data),
  updateProjectCategory: (
    projectId: string,
    id: string,
    data: CommandCategoryUpdate
  ) =>
    api
      .put<CommandCategory>(
        `/projects/${projectId}/command-categories/${id}`,
        data
      )
      .then((r) => r.data),
  deleteProjectCategory: (projectId: string, id: string) =>
    api.delete(`/projects/${projectId}/command-categories/${id}`),

  listGlobalFilters: () =>
    api.get<CommandFilter[]>("/command-filters").then((r) => r.data),
  createGlobalFilter: (data: CommandFilterInput) =>
    api.post<CommandFilter>("/command-filters", data).then((r) => r.data),
  updateGlobalFilter: (id: string, data: CommandFilterUpdate) =>
    api.put<CommandFilter>(`/command-filters/${id}`, data).then((r) => r.data),
  deleteGlobalFilter: (id: string) => api.delete(`/command-filters/${id}`),

  listProjectFilters: (projectId: string) =>
    api
      .get<CommandFilter[]>(`/projects/${projectId}/command-filters`)
      .then((r) => r.data),
  createProjectFilter: (projectId: string, data: CommandFilterInput) =>
    api
      .post<CommandFilter>(`/projects/${projectId}/command-filters`, data)
      .then((r) => r.data),
  updateProjectFilter: (
    projectId: string,
    id: string,
    data: CommandFilterUpdate
  ) =>
    api
      .put<CommandFilter>(`/projects/${projectId}/command-filters/${id}`, data)
      .then((r) => r.data),
  deleteProjectFilter: (projectId: string, id: string) =>
    api.delete(`/projects/${projectId}/command-filters/${id}`),

  listGlobalFavorites: () =>
    api.get<string[]>("/commands/favorites").then((r) => r.data),
  addGlobalFavorite: (commandId: string) =>
    api.post(`/commands/${commandId}/favorite`),
  removeGlobalFavorite: (commandId: string) =>
    api.delete(`/commands/${commandId}/favorite`),

  listProjectFavorites: (projectId: string) =>
    api
      .get<string[]>(`/projects/${projectId}/commands/favorites`)
      .then((r) => r.data),
  addProjectFavorite: (projectId: string, commandId: string) =>
    api.post(`/projects/${projectId}/commands/${commandId}/favorite`),
  removeProjectFavorite: (projectId: string, commandId: string) =>
    api.delete(`/projects/${projectId}/commands/${commandId}/favorite`),

  getGlobalVariables: () =>
    api.get<CommandVariables>("/commands/variables").then((r) => r.data),
  updateGlobalVariables: (variables: CommandVariables) =>
    api.put<CommandVariables>("/commands/variables", variables).then((r) => r.data),
};
