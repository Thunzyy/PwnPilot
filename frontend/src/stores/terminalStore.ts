import { create } from "zustand";

import { api } from "../api/client";

const API_BASE = "/terminal";

export interface TerminalSession {
  id: string;
  name: string;
  projectId: string | null;
  websocketUrl: string;
  masterToken: string;
  viewerToken: string;
  isAlive: boolean;
  createdAt: string;
}

export interface TerminalCapabilities {
  provider: string;
  platform: string;
  canCreateSession: boolean;
  canDetach: boolean;
  websocketMode: string;
  reasonUnavailable: string | null;
}

interface TerminalSessionDto {
  id: string;
  name: string;
  project_id: string | null;
  websocket_url: string;
  master_token: string;
  viewer_token: string;
  is_alive: boolean;
  created_at: string;
}

interface TerminalCapabilitiesDto {
  provider: string;
  platform: string;
  can_create_session: boolean;
  can_detach: boolean;
  websocket_mode: string;
  reason_unavailable?: string | null;
}

interface TerminalState {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  isConnecting: boolean;
  error: string | null;
  queuedCommand: string | null;
  capabilities: TerminalCapabilities | null;
  isCapabilitiesLoading: boolean;

  fetchCapabilities: () => Promise<TerminalCapabilities>;
  fetchSessions: (projectId?: string) => Promise<void>;
  createSession: (name?: string, projectId?: string) => Promise<TerminalSession>;
  closeSession: (sessionId: string) => Promise<void>;
  setActiveSession: (sessionId: string | null) => void;
  setQueuedCommand: (command: string | null) => void;
  duplicateSession: (sessionId: string) => Promise<TerminalSession>;
  detachSession: (sessionId: string) => Promise<void>;
  renameSession: (sessionId: string, name: string) => Promise<TerminalSession>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readString = (value: unknown, field: string): string => {
  if (typeof value !== "string") {
    throw new Error(`Invalid terminal response field: ${field}`);
  }
  return value;
};

const readNullableString = (value: unknown, field: string): string | null => {
  if (value === null) return null;
  return readString(value, field);
};

const readBoolean = (value: unknown, field: string): boolean => {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid terminal response field: ${field}`);
  }
  return value;
};

const parseSession = (value: unknown): TerminalSession => {
  if (!isRecord(value)) {
    throw new Error("Invalid terminal session payload");
  }

  return {
    id: readString(value.id, "id"),
    name: readString(value.name, "name"),
    projectId: readNullableString(value.project_id, "project_id"),
    websocketUrl: readString(value.websocket_url, "websocket_url"),
    masterToken: readString(value.master_token, "master_token"),
    viewerToken: readString(value.viewer_token, "viewer_token"),
    isAlive: readBoolean(value.is_alive, "is_alive"),
    createdAt: readString(value.created_at, "created_at"),
  };
};

const parseCapabilities = (value: unknown): TerminalCapabilities => {
  if (!isRecord(value)) {
    throw new Error("Invalid terminal capabilities payload");
  }

  return {
    provider: readString(value.provider, "provider"),
    platform: readString(value.platform, "platform"),
    canCreateSession: readBoolean(value.can_create_session, "can_create_session"),
    canDetach: readBoolean(value.can_detach, "can_detach"),
    websocketMode: readString(value.websocket_mode, "websocket_mode"),
    reasonUnavailable:
      value.reason_unavailable === undefined
        ? null
        : readNullableString(value.reason_unavailable, "reason_unavailable"),
  };
};

const terminalErrorMessage = (
  fallback: string,
  capabilities?: TerminalCapabilities | null
) => capabilities?.reasonUnavailable ?? fallback;

const extractApiErrorMessage = (error: unknown, fallback: string): string => {
  if (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "data" in error.response
  ) {
    const data = error.response.data;
    if (
      typeof data === "object" &&
      data !== null &&
      "detail" in data &&
      typeof data.detail === "string" &&
      data.detail.trim().length > 0
    ) {
      return data.detail;
    }
  }

  return fallback;
};

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  isConnecting: false,
  error: null,
  queuedCommand: null,
  capabilities: null,
  isCapabilitiesLoading: false,

  fetchCapabilities: async () => {
    set({ isCapabilitiesLoading: true, error: null });
    try {
      const response = await api.get<TerminalCapabilitiesDto>(`${API_BASE}/capabilities`);
      const capabilities = parseCapabilities(response.data);
      set({ capabilities, isCapabilitiesLoading: false });
      return capabilities;
    } catch {
      set({
        isCapabilitiesLoading: false,
        error: "Failed to load terminal capabilities",
      });
      throw new Error("Failed to load terminal capabilities");
    }
  },

  fetchSessions: async (projectId?: string) => {
    try {
      const response = await api.get<TerminalSessionDto[]>(`${API_BASE}/sessions`, {
        params: projectId ? { project_id: projectId } : undefined,
      });
      const sessions = response.data.map(parseSession);
      set({
        sessions,
        activeSessionId: sessions[0]?.id ?? null,
        error: null,
      });
    } catch {
      set({ error: "Failed to fetch sessions" });
    }
  },

  createSession: async (name = "Terminal", projectId?: string) => {
    const capabilities = get().capabilities;
    if (capabilities && !capabilities.canCreateSession) {
      const message = terminalErrorMessage("Terminal creation is unavailable", capabilities);
      set({ error: message });
      throw new Error(message);
    }

    set({ isConnecting: true, error: null });
    try {
      const response = await api.post<TerminalSessionDto>(`${API_BASE}/sessions`, {
        name,
        project_id: projectId,
      });
      const session = parseSession(response.data);
      set((state) => ({
        sessions: [...state.sessions, session],
        activeSessionId: session.id,
        isConnecting: false,
        error: null,
      }));
      return session;
    } catch (error) {
      const message = extractApiErrorMessage(error, "Failed to create session");
      set({ isConnecting: false, error: message });
      throw new Error(message);
    }
  },

  closeSession: async (sessionId: string) => {
    try {
      await api.delete(`${API_BASE}/sessions/${sessionId}`);
      set((state) => {
        const newSessions = state.sessions.filter((s) => s.id !== sessionId);
        return {
          sessions: newSessions,
          activeSessionId:
            state.activeSessionId === sessionId
              ? (newSessions[0]?.id ?? null)
              : state.activeSessionId,
          error: null,
        };
      });
    } catch {
      set({ error: "Failed to close session" });
    }
  },

  setActiveSession: (sessionId: string | null) => {
    set({ activeSessionId: sessionId });
  },

  setQueuedCommand: (command: string | null) => {
    set({ queuedCommand: command });
  },

  duplicateSession: async (sessionId: string) => {
    const session = get().sessions.find((s) => s.id === sessionId);
    if (!session) throw new Error("Session not found");
    return get().createSession(
      `${session.name} (copy)`,
      session.projectId ?? undefined
    );
  },

  detachSession: async (sessionId: string) => {
    const capabilities = get().capabilities;
    if (capabilities && !capabilities.canDetach) {
      const message = terminalErrorMessage(
        "Detach is not supported by this terminal provider",
        capabilities
      );
      set({ error: message });
      throw new Error(message);
    }

    try {
      await api.post(`${API_BASE}/sessions/${sessionId}/detach`, {
        terminal: "auto",
      });
      set({ error: null });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to detach session" });
      throw e;
    }
  },

  renameSession: async (sessionId: string, name: string) => {
    try {
      const response = await api.patch<TerminalSessionDto>(`${API_BASE}/sessions/${sessionId}`, {
        name,
      });
      const session = parseSession(response.data);
      set((state) => ({
        sessions: state.sessions.map((s) => (s.id === sessionId ? session : s)),
        error: null,
      }));
      return session;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to rename session" });
      throw e;
    }
  },
}));
