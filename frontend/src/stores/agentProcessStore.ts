import { create } from 'zustand';
import { agentApi, createAgentEventSource } from '../api/agent';
import type { AgentProcess, AgentLaunchFromConfigRequest, AgentToolCall } from '../types/agent';

// Module-level variable -- EventSource is not serializable
let _eventSource: EventSource | null = null;

interface AgentProcessState {
  // Data
  processes: AgentProcess[];
  activeAgentId: string | null;
  toolCalls: AgentToolCall[];

  // UI state
  isLaunching: boolean;
  error: string | null;

  // Actions
  launchAgent: (data: AgentLaunchFromConfigRequest) => Promise<AgentProcess>;
  executeCommand: (agentId: string) => Promise<void>;
  stopAgent: (agentId: string) => Promise<void>;
  pollStatus: (agentId: string) => Promise<void>;
  setActiveAgent: (agentId: string | null) => void;
  clearError: () => void;
  subscribeToEvents: (agentId: string) => void;
  unsubscribeFromEvents: () => void;
  clearToolCalls: () => void;
}

/** Map snake_case SSE event payload to camelCase AgentToolCall. */
function mapSseEvent(data: Record<string, unknown>): AgentToolCall {
  return {
    name: (data.name as string) ?? '',
    args: (data.args as Record<string, unknown>) ?? {},
    resultPreview: (data.result_preview as string) ?? null,
    error: (data.error as string) ?? null,
    durationMs: (data.duration_ms as number) ?? 0,
    success: (data.success as boolean) ?? false,
    timestamp: (data.timestamp as string) ?? new Date().toISOString(),
    agentId: (data.agent_id as string) ?? null,
  };
}

export const useAgentProcessStore = create<AgentProcessState>((set, get) => ({
  processes: [],
  activeAgentId: null,
  toolCalls: [],
  isLaunching: false,
  error: null,

  launchAgent: async (data) => {
    set({ isLaunching: true, error: null });
    get().clearToolCalls();
    try {
      const process = await agentApi.launchFromConfig(data);
      set((s) => ({
        processes: [...s.processes, process],
        activeAgentId: process.id,
        isLaunching: false,
      }));
      get().subscribeToEvents(process.id);
      return process;
    } catch {
      set({ error: 'Failed to launch agent', isLaunching: false });
      throw new Error('Failed to launch agent');
    }
  },

  executeCommand: async (agentId) => {
    try {
      const updated = await agentApi.executeCommand(agentId);
      set((s) => ({
        processes: s.processes.map((p) => (p.id === agentId ? updated : p)),
      }));
    } catch {
      set({ error: 'Failed to execute agent command' });
    }
  },

  stopAgent: async (agentId) => {
    try {
      const updated = await agentApi.stopProcess(agentId);
      set((s) => ({
        processes: s.processes.map((p) => (p.id === agentId ? updated : p)),
        activeAgentId: s.activeAgentId === agentId ? null : s.activeAgentId,
      }));
      get().unsubscribeFromEvents();
    } catch {
      set({ error: 'Failed to stop agent' });
    }
  },

  pollStatus: async (agentId) => {
    try {
      const updated = await agentApi.getProcess(agentId);
      const current = get().processes.find((p) => p.id === agentId);
      if (!current || current.status !== updated.status || current.websocketUrl !== updated.websocketUrl) {
        set((s) => ({
          processes: s.processes.map((p) => (p.id === agentId ? updated : p)),
        }));
      }
    } catch { /* next poll will retry */ }
  },

  setActiveAgent: (agentId) => set({ activeAgentId: agentId }),
  clearError: () => set({ error: null }),

  subscribeToEvents: (agentId) => {
    if (_eventSource) { _eventSource.close(); _eventSource = null; }
    _eventSource = createAgentEventSource(agentId);
    _eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as Record<string, unknown>;
        if (data.type === 'heartbeat') return;
        set((s) => ({ toolCalls: [...s.toolCalls, mapSseEvent(data)] }));
      } catch { /* ignore unparseable messages */ }
    };
    _eventSource.onerror = () => {
      if (import.meta.env.DEV) console.warn('[AgentSSE] reconnecting...');
    };
  },

  unsubscribeFromEvents: () => {
    if (_eventSource) { _eventSource.close(); _eventSource = null; }
  },

  clearToolCalls: () => set({ toolCalls: [] }),
}));
