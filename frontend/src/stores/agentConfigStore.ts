import { create } from 'zustand';
import { agentApi } from '../api/agent';
import type {
  AgentConfig,
  AgentConfigCreate,
  AgentConfigUpdate,
  BinaryVerifyResult,
} from '../types/agent';

interface AgentConfigState {
  // Data
  configs: AgentConfig[];
  templates: AgentConfig[];

  // UI state
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchConfigs: (projectId?: string) => Promise<void>;
  fetchTemplates: () => Promise<void>;
  createConfig: (data: AgentConfigCreate) => Promise<AgentConfig>;
  updateConfig: (id: number, data: AgentConfigUpdate) => Promise<void>;
  deleteConfig: (id: number) => Promise<void>;
  instantiateTemplate: (templateId: number, projectId?: string) => Promise<AgentConfig>;
  verifyBinary: (id: number) => Promise<BinaryVerifyResult>;
  clearError: () => void;
}

export const useAgentConfigStore = create<AgentConfigState>((set) => ({
  configs: [],
  templates: [],
  isLoading: false,
  error: null,

  fetchTemplates: async () => {
    try {
      const templates = await agentApi.listTemplates();
      set({ templates });
    } catch {
      // Silent fail -- templates are a nice-to-have
    }
  },

  fetchConfigs: async (projectId?: string) => {
    set({ isLoading: true, error: null });
    try {
      const configs = await agentApi.listConfigs(projectId);
      set({ configs, isLoading: false });
    } catch {
      set({ error: 'Failed to load agent configs', isLoading: false });
    }
  },

  createConfig: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const config = await agentApi.createConfig(data);
      set((s) => ({
        configs: [...s.configs, config],
        isLoading: false,
      }));
      return config;
    } catch {
      set({ error: 'Failed to create agent config', isLoading: false });
      throw new Error('Failed to create agent config');
    }
  },

  updateConfig: async (id, data) => {
    set({ isLoading: true, error: null });
    try {
      const updated = await agentApi.updateConfig(id, data);
      set((s) => ({
        configs: s.configs.map((c) => (c.id === id ? updated : c)),
        isLoading: false,
      }));
    } catch {
      set({ error: 'Failed to update agent config', isLoading: false });
    }
  },

  deleteConfig: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await agentApi.deleteConfig(id);
      set((s) => ({
        configs: s.configs.filter((c) => c.id !== id),
        isLoading: false,
      }));
    } catch {
      set({ error: 'Failed to delete agent config', isLoading: false });
    }
  },

  instantiateTemplate: async (templateId, projectId) => {
    set({ isLoading: true, error: null });
    try {
      const config = await agentApi.instantiateTemplate(templateId, projectId);
      set((s) => ({
        configs: [...s.configs, config],
        isLoading: false,
      }));
      return config;
    } catch {
      set({ error: 'Failed to create from template', isLoading: false });
      throw new Error('Failed to create from template');
    }
  },

  verifyBinary: async (id) => {
    try {
      return await agentApi.verifyBinary(id);
    } catch {
      throw new Error('Failed to verify binary');
    }
  },

  clearError: () => set({ error: null }),
}));
