import { create } from "zustand";

import type { Settings } from "../types";
import {
  fetchSettings as fetchSettingsRequest,
  settingsQueryKeys,
  updateSettings as updateSettingsRequest,
} from "../api/settings";
import { queryClient } from "../lib/queryClient";

export const DEFAULT_WORKSPACE_BASE = "PwnPilot/project";

interface SettingsState {
  settings: Settings | null;
  isLoading: boolean;
  error: string | null;
  setSettings: (settings: Settings | null) => void;
  fetchSettings: () => Promise<void>;
  updateSettings: (updates: Settings) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  isLoading: false,
  error: null,
  setSettings: (settings) => {
    set({ settings });
  },

  fetchSettings: async () => {
    set({ isLoading: true, error: null });
    try {
      const settings = await fetchSettingsRequest();
      queryClient.setQueryData(settingsQueryKeys.current, settings);
      set({ settings, isLoading: false });
    } catch {
      set({ error: "Failed to load settings", isLoading: false });
    }
  },

  updateSettings: async (updates) => {
    set({ isLoading: true, error: null });
    try {
      const settings = await updateSettingsRequest(updates);
      queryClient.setQueryData(settingsQueryKeys.current, settings);
      set({ settings, isLoading: false });
    } catch {
      set({ error: "Failed to update settings", isLoading: false });
    }
  },
}));
