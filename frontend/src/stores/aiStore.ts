import { create } from 'zustand';
import { aiApi } from '../api/ai';
import type {
  AIContextRouting,
  AIContextRoutingCreate,
  AIProvider,
  AIProviderCreate,
  AIProviderUpdate,
  HealthCheckResult,
  ModelsListResponse,
} from '../types/ai';

interface AIState {
  // Data
  providers: AIProvider[];
  healthResults: Record<number, HealthCheckResult>;
  modelsCache: Record<number, ModelsListResponse>;
  modelErrors: Record<number, string | null | undefined>;
  hasFetchedProviders: boolean;
  routings: AIContextRouting[];
  hasFetchedRoutings: boolean;

  // UI state
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchProviders: () => Promise<void>;
  fetchRoutings: () => Promise<void>;
  saveRoutings: (data: AIContextRoutingCreate[]) => Promise<AIContextRouting[]>;
  createProvider: (data: AIProviderCreate) => Promise<AIProvider>;
  updateProvider: (id: number, data: AIProviderUpdate) => Promise<void>;
  deleteProvider: (id: number) => Promise<void>;
  testProvider: (id: number) => Promise<HealthCheckResult>;
  fetchModels: (id: number) => Promise<ModelsListResponse>;
  clearError: () => void;
}

export const useAIStore = create<AIState>((set) => ({
  providers: [],
  healthResults: {},
  modelsCache: {},
  modelErrors: {},
  hasFetchedProviders: false,
  routings: [],
  hasFetchedRoutings: false,
  isLoading: false,
  error: null,

  fetchProviders: async () => {
    set({ isLoading: true, error: null });
    try {
      const providers = await aiApi.listProviders();
      set({ providers, hasFetchedProviders: true, isLoading: false });
    } catch {
      set({
        error: 'Failed to load AI providers',
        hasFetchedProviders: true,
        isLoading: false,
      });
    }
  },

  fetchRoutings: async () => {
    set({ isLoading: true, error: null });
    try {
      const routings = await aiApi.listRouting();
      set({ routings, hasFetchedRoutings: true, isLoading: false });
    } catch {
      set({
        error: 'Failed to load AI routing defaults',
        hasFetchedRoutings: true,
        isLoading: false,
      });
    }
  },

  saveRoutings: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const routings = await aiApi.updateRouting(data);
      set({
        routings,
        hasFetchedRoutings: true,
        isLoading: false,
      });
      return routings;
    } catch {
      set({ error: 'Failed to save AI routing defaults', isLoading: false });
      throw new Error('Failed to save AI routing defaults');
    }
  },

  createProvider: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const provider = await aiApi.createProvider(data);
      set((s) => ({
        providers: [...s.providers, provider],
        hasFetchedProviders: true,
        isLoading: false,
      }));
      return provider;
    } catch {
      set({ error: 'Failed to create provider', isLoading: false });
      throw new Error('Failed to create provider');
    }
  },

  updateProvider: async (id, data) => {
    set({ isLoading: true, error: null });
    try {
      const updated = await aiApi.updateProvider(id, data);
      set((s) => ({
        providers: s.providers.map((p) => (p.id === id ? updated : p)),
        hasFetchedProviders: true,
        isLoading: false,
      }));
    } catch {
      set({ error: 'Failed to update provider', isLoading: false });
    }
  },

  deleteProvider: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await aiApi.deleteProvider(id);
      set((s) => ({
        providers: s.providers.filter((p) => p.id !== id),
        hasFetchedProviders: true,
        isLoading: false,
      }));
    } catch {
      set({ error: 'Failed to delete provider', isLoading: false });
    }
  },

  testProvider: async (id) => {
    try {
      const result = await aiApi.testProvider(id);
      set((s) => ({
        healthResults: { ...s.healthResults, [id]: result },
      }));
      // Update provider's health_status in the list
      set((s) => ({
        providers: s.providers.map((p) =>
          p.id === id
            ? { ...p, health_status: result.status, last_health_check: result.checked_at }
            : p
        ),
      }));
      return result;
    } catch {
      throw new Error('Failed to test provider');
    }
  },

  fetchModels: async (id) => {
    try {
      const models = await aiApi.listModels(id);
      set((s) => ({
        modelsCache: { ...s.modelsCache, [id]: models },
        modelErrors: { ...s.modelErrors, [id]: null },
      }));
      return models;
    } catch {
      set((s) => ({
        modelErrors: {
          ...s.modelErrors,
          [id]: 'Failed to load models from provider',
        },
      }));
      throw new Error('Failed to fetch models');
    }
  },

  clearError: () => set({ error: null }),
}));
