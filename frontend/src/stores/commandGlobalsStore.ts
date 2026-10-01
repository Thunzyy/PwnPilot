import { create } from "zustand";

export const STORAGE_KEY = "pwnpilot:commands:globals:v1";

export const DEFAULT_COMMAND_GLOBALS: Record<string, string> = {
  target_ip: "192.168.1.1",
  attacker_ip: "10.10.10.5",
  port: "443",
  target_domain: "target.com",
};

const loadGlobals = () => {
  if (typeof window === "undefined") return DEFAULT_COMMAND_GLOBALS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_COMMAND_GLOBALS;
    const parsed = JSON.parse(raw) as Record<string, string>;
    return { ...DEFAULT_COMMAND_GLOBALS, ...parsed };
  } catch {
    return DEFAULT_COMMAND_GLOBALS;
  }
};

const persistGlobals = (vars: Record<string, string>) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(vars));
  } catch {
    // Ignore storage errors (private mode, quota, etc.)
  }
};

interface CommandGlobalsState {
  variables: Record<string, string>;
  setVariable: (key: string, value: string) => void;
  removeVariable: (key: string) => void;
  addVariable: (key: string, value: string) => void;
  resetDefaults: () => void;
}

export const useCommandGlobalsStore = create<CommandGlobalsState>((set) => ({
  variables: loadGlobals(),
  setVariable: (key, value) =>
    set((state) => {
      const next = { ...state.variables, [key]: value };
      persistGlobals(next);
      return { variables: next };
    }),
  removeVariable: (key) =>
    set((state) => {
      const next = { ...state.variables };
      delete next[key];
      persistGlobals(next);
      return { variables: next };
    }),
  addVariable: (key, value) =>
    set((state) => {
      const next = { ...state.variables, [key]: value };
      persistGlobals(next);
      return { variables: next };
    }),
  resetDefaults: () => {
    persistGlobals(DEFAULT_COMMAND_GLOBALS);
    set({ variables: DEFAULT_COMMAND_GLOBALS });
  },
}));
