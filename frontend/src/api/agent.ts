import { api, buildApiUrl } from './client';
import type {
  AgentConfig,
  AgentConfigCreate,
  AgentConfigUpdate,
  AgentLaunchFromConfigRequest,
  AgentProcess,
  BinaryVerifyResult,
  MCPLogEntry,
} from '../types/agent';

const ACCESS_TOKEN_KEY = 'pwnpilot_access_token';

/**
 * Create an EventSource for agent MCP tool-call SSE events.
 */
export function createAgentEventSource(agentId: string): EventSource {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY) ?? '';
  return new EventSource(
    `${buildApiUrl(`/api/v1/agents/${agentId}/events`)}?token=${token}`,
  );
}

/**
 * Create an EventSource for agent chat stream (stream-json output).
 * Used in chat mode to receive parsed Claude output events.
 */
export function createAgentChatStream(agentId: string): EventSource {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY) ?? '';
  return new EventSource(
    `${buildApiUrl(`/api/v1/agents/${agentId}/chat-stream`)}?token=${token}`,
  );
}

// Maps snake_case API response to camelCase AgentProcess
function mapProcessResponse(data: Record<string, unknown>): AgentProcess {
  return {
    id: data.id as string,
    agentType: data.agent_type as AgentProcess['agentType'],
    projectId: data.project_id as string,
    tmuxSession: data.tmux_session as string,
    pid: data.pid as number,
    status: data.status as AgentProcess['status'],
    websocketUrl: (data.websocket_url as string) ?? null,
    createdAt: data.created_at as string,
    stoppedAt: (data.stopped_at as string) ?? null,
    exitCode: (data.exit_code as number) ?? null,
    outputMode: (data.output_mode as string as AgentProcess['outputMode']) ?? 'terminal',
  };
}

// Maps snake_case API response to camelCase MCPLogEntry
function mapMCPLog(data: Record<string, unknown>): MCPLogEntry {
  return {
    id: data.id as string,
    projectId: data.project_id as string,
    agentProcessId: (data.agent_process_id as string) ?? null,
    sessionId: data.session_id as string,
    toolName: data.tool_name as string,
    toolArgs: (data.tool_args as Record<string, unknown>) ?? {},
    toolResult: (data.tool_result as string) ?? null,
    success: data.success as boolean,
    error: (data.error as string) ?? null,
    durationMs: data.duration_ms as number,
    createdAt: data.created_at as string,
  };
}

export const agentApi = {
  listConfigs: (projectId?: string) => {
    const params = projectId ? { project_id: projectId } : {};
    return api.get<AgentConfig[]>('/agents/configs', { params }).then(r => r.data);
  },

  createConfig: (data: AgentConfigCreate) =>
    api.post<AgentConfig>('/agents/configs', data).then(r => r.data),

  getConfig: (id: number) =>
    api.get<AgentConfig>(`/agents/configs/${id}`).then(r => r.data),

  updateConfig: (id: number, data: AgentConfigUpdate) =>
    api.put<AgentConfig>(`/agents/configs/${id}`, data).then(r => r.data),

  deleteConfig: (id: number) =>
    api.delete(`/agents/configs/${id}`),

  verifyBinary: (id: number) =>
    api.post<BinaryVerifyResult>(`/agents/configs/${id}/verify`).then(r => r.data),

  // Agent process management
  launchFromConfig: (data: AgentLaunchFromConfigRequest) =>
    api.post('/agents/launch-from-config', data).then(r => mapProcessResponse(r.data)),

  executeCommand: (agentId: string) =>
    api.post(`/agents/${agentId}/execute`).then(r => mapProcessResponse(r.data)),

  stopProcess: (agentId: string) =>
    api.post(`/agents/${agentId}/stop`).then(r => mapProcessResponse(r.data)),

  getProcess: (agentId: string) =>
    api.get(`/agents/${agentId}`).then(r => mapProcessResponse(r.data)),

  listProcesses: (projectId?: string) => {
    const params = projectId ? { project_id: projectId } : {};
    return api.get('/agents', { params }).then(r =>
      (r.data.agents as Record<string, unknown>[]).map(mapProcessResponse)
    );
  },

  // Template management
  listTemplates: () =>
    api.get<AgentConfig[]>('/agents/templates').then(r => r.data),

  instantiateTemplate: (templateId: number, projectId?: string) => {
    const params = projectId ? { project_id: projectId } : {};
    return api.post<AgentConfig>(`/agents/templates/${templateId}/instantiate`, null, { params }).then(r => r.data);
  },

  // MCP log history (persisted tool call records)
  getMCPLogs: (agentId: string, limit = 100, offset = 0) =>
    api.get(`/agents/${agentId}/mcp-logs`, { params: { limit, offset } }).then(r => ({
      items: (r.data.items as Record<string, unknown>[]).map(mapMCPLog),
      total: r.data.total as number,
    })),
};
