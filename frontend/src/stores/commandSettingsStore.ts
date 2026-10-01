import { create } from "zustand";

import {
  Command,
  CommandCategory,
  CommandFilter,
  CommandInput,
  CommandUpdate,
  CommandCategoryInput,
  CommandCategoryUpdate,
  CommandFilterInput,
  CommandFilterUpdate,
  CommandVariables,
  commandsApi,
} from "../api/commands";

interface CommandSettingsState {
  commands: Command[];
  categories: CommandCategory[];
  filters: CommandFilter[];
  variables: CommandVariables;
  isLoading: boolean;
  error: string | null;

  loadGlobalSettings: () => Promise<void>;
  loadProjectSettings: (projectId: string) => Promise<void>;

  createGlobalCommand: (data: CommandInput) => Promise<Command>;
  updateGlobalCommand: (id: string, data: CommandUpdate) => Promise<void>;
  deleteGlobalCommand: (id: string) => Promise<void>;

  createProjectCommand: (projectId: string, data: CommandInput) => Promise<Command>;
  updateProjectCommand: (
    projectId: string,
    id: string,
    data: CommandUpdate
  ) => Promise<void>;
  deleteProjectCommand: (projectId: string, id: string) => Promise<void>;

  createGlobalCategory: (data: CommandCategoryInput) => Promise<CommandCategory>;
  updateGlobalCategory: (id: string, data: CommandCategoryUpdate) => Promise<void>;
  deleteGlobalCategory: (id: string) => Promise<void>;

  createProjectCategory: (
    projectId: string,
    data: CommandCategoryInput
  ) => Promise<CommandCategory>;
  updateProjectCategory: (
    projectId: string,
    id: string,
    data: CommandCategoryUpdate
  ) => Promise<void>;
  deleteProjectCategory: (projectId: string, id: string) => Promise<void>;

  createGlobalFilter: (data: CommandFilterInput) => Promise<CommandFilter>;
  updateGlobalFilter: (id: string, data: CommandFilterUpdate) => Promise<void>;
  deleteGlobalFilter: (id: string) => Promise<void>;

  createProjectFilter: (
    projectId: string,
    data: CommandFilterInput
  ) => Promise<CommandFilter>;
  updateProjectFilter: (
    projectId: string,
    id: string,
    data: CommandFilterUpdate
  ) => Promise<void>;
  deleteProjectFilter: (projectId: string, id: string) => Promise<void>;

  updateGlobalVariables: (variables: CommandVariables) => Promise<void>;
  clearError: () => void;
}

export const useCommandSettingsStore = create<CommandSettingsState>((set) => ({
  commands: [],
  categories: [],
  filters: [],
  variables: {},
  isLoading: false,
  error: null,

  loadGlobalSettings: async () => {
    set({ isLoading: true, error: null });
    try {
      const [commands, categories, filters, variables] = await Promise.all([
        commandsApi.listGlobalCommands(),
        commandsApi.listGlobalCategories(),
        commandsApi.listGlobalFilters(),
        commandsApi.getGlobalVariables(),
      ]);
      set({
        commands,
        categories,
        filters,
        variables,
        isLoading: false,
      });
    } catch {
      set({ error: "Failed to load command settings", isLoading: false });
    }
  },

  loadProjectSettings: async (projectId) => {
    set({ isLoading: true, error: null });
    try {
      const [commands, categories, filters] = await Promise.all([
        commandsApi.listProjectCommands(projectId),
        commandsApi.listProjectCategories(projectId),
        commandsApi.listProjectFilters(projectId),
      ]);
      set({
        commands,
        categories,
        filters,
        variables: {},
        isLoading: false,
      });
    } catch {
      set({ error: "Failed to load project command settings", isLoading: false });
    }
  },

  createGlobalCommand: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const command = await commandsApi.createGlobalCommand(data);
      set((state) => ({
        commands: [...state.commands, command],
        isLoading: false,
      }));
      return command;
    } catch {
      set({ error: "Failed to create command", isLoading: false });
      throw new Error("Failed to create command");
    }
  },

  updateGlobalCommand: async (id, data) => {
    set({ isLoading: true, error: null });
    try {
      const command = await commandsApi.updateGlobalCommand(id, data);
      set((state) => ({
        commands: state.commands.map((item) => (item.id === id ? command : item)),
        isLoading: false,
      }));
    } catch {
      set({ error: "Failed to update command", isLoading: false });
    }
  },

  deleteGlobalCommand: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await commandsApi.deleteGlobalCommand(id);
      set((state) => ({
        commands: state.commands.filter((item) => item.id !== id),
        isLoading: false,
      }));
    } catch {
      set({ error: "Failed to delete command", isLoading: false });
    }
  },

  createProjectCommand: async (projectId, data) => {
    set({ isLoading: true, error: null });
    try {
      const command = await commandsApi.createProjectCommand(projectId, data);
      set((state) => ({
        commands: [...state.commands, command],
        isLoading: false,
      }));
      return command;
    } catch {
      set({ error: "Failed to create command", isLoading: false });
      throw new Error("Failed to create command");
    }
  },

  updateProjectCommand: async (projectId, id, data) => {
    set({ isLoading: true, error: null });
    try {
      const command = await commandsApi.updateProjectCommand(projectId, id, data);
      set((state) => ({
        commands: state.commands.map((item) => (item.id === id ? command : item)),
        isLoading: false,
      }));
    } catch {
      set({ error: "Failed to update command", isLoading: false });
    }
  },

  deleteProjectCommand: async (projectId, id) => {
    set({ isLoading: true, error: null });
    try {
      await commandsApi.deleteProjectCommand(projectId, id);
      set((state) => ({
        commands: state.commands.filter((item) => item.id !== id),
        isLoading: false,
      }));
    } catch {
      set({ error: "Failed to delete command", isLoading: false });
    }
  },

  createGlobalCategory: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const category = await commandsApi.createGlobalCategory(data);
      set((state) => ({
        categories: [...state.categories, category],
        isLoading: false,
      }));
      return category;
    } catch {
      set({ error: "Failed to create category", isLoading: false });
      throw new Error("Failed to create category");
    }
  },

  updateGlobalCategory: async (id, data) => {
    set({ isLoading: true, error: null });
    try {
      const category = await commandsApi.updateGlobalCategory(id, data);
      set((state) => ({
        categories: state.categories.map((item) => (item.id === id ? category : item)),
        isLoading: false,
      }));
    } catch {
      set({ error: "Failed to update category", isLoading: false });
    }
  },

  deleteGlobalCategory: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await commandsApi.deleteGlobalCategory(id);
      set((state) => ({
        categories: state.categories.filter((item) => item.id !== id),
        isLoading: false,
      }));
    } catch {
      set({ error: "Failed to delete category", isLoading: false });
    }
  },

  createProjectCategory: async (projectId, data) => {
    set({ isLoading: true, error: null });
    try {
      const category = await commandsApi.createProjectCategory(projectId, data);
      set((state) => ({
        categories: [...state.categories, category],
        isLoading: false,
      }));
      return category;
    } catch {
      set({ error: "Failed to create category", isLoading: false });
      throw new Error("Failed to create category");
    }
  },

  updateProjectCategory: async (projectId, id, data) => {
    set({ isLoading: true, error: null });
    try {
      const category = await commandsApi.updateProjectCategory(projectId, id, data);
      set((state) => ({
        categories: state.categories.map((item) => (item.id === id ? category : item)),
        isLoading: false,
      }));
    } catch {
      set({ error: "Failed to update category", isLoading: false });
    }
  },

  deleteProjectCategory: async (projectId, id) => {
    set({ isLoading: true, error: null });
    try {
      await commandsApi.deleteProjectCategory(projectId, id);
      set((state) => ({
        categories: state.categories.filter((item) => item.id !== id),
        isLoading: false,
      }));
    } catch {
      set({ error: "Failed to delete category", isLoading: false });
    }
  },

  createGlobalFilter: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const filter = await commandsApi.createGlobalFilter(data);
      set((state) => ({
        filters: [...state.filters, filter],
        isLoading: false,
      }));
      return filter;
    } catch {
      set({ error: "Failed to create filter", isLoading: false });
      throw new Error("Failed to create filter");
    }
  },

  updateGlobalFilter: async (id, data) => {
    set({ isLoading: true, error: null });
    try {
      const filter = await commandsApi.updateGlobalFilter(id, data);
      set((state) => ({
        filters: state.filters.map((item) => (item.id === id ? filter : item)),
        isLoading: false,
      }));
    } catch {
      set({ error: "Failed to update filter", isLoading: false });
    }
  },

  deleteGlobalFilter: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await commandsApi.deleteGlobalFilter(id);
      set((state) => ({
        filters: state.filters.filter((item) => item.id !== id),
        isLoading: false,
      }));
    } catch {
      set({ error: "Failed to delete filter", isLoading: false });
    }
  },

  createProjectFilter: async (projectId, data) => {
    set({ isLoading: true, error: null });
    try {
      const filter = await commandsApi.createProjectFilter(projectId, data);
      set((state) => ({
        filters: [...state.filters, filter],
        isLoading: false,
      }));
      return filter;
    } catch {
      set({ error: "Failed to create filter", isLoading: false });
      throw new Error("Failed to create filter");
    }
  },

  updateProjectFilter: async (projectId, id, data) => {
    set({ isLoading: true, error: null });
    try {
      const filter = await commandsApi.updateProjectFilter(projectId, id, data);
      set((state) => ({
        filters: state.filters.map((item) => (item.id === id ? filter : item)),
        isLoading: false,
      }));
    } catch {
      set({ error: "Failed to update filter", isLoading: false });
    }
  },

  deleteProjectFilter: async (projectId, id) => {
    set({ isLoading: true, error: null });
    try {
      await commandsApi.deleteProjectFilter(projectId, id);
      set((state) => ({
        filters: state.filters.filter((item) => item.id !== id),
        isLoading: false,
      }));
    } catch {
      set({ error: "Failed to delete filter", isLoading: false });
    }
  },

  updateGlobalVariables: async (variables) => {
    set({ isLoading: true, error: null });
    try {
      const updated = await commandsApi.updateGlobalVariables(variables);
      set({ variables: updated, isLoading: false });
    } catch {
      set({ error: "Failed to update variables", isLoading: false });
    }
  },

  clearError: () => {
    set({ error: null });
  },
}));
