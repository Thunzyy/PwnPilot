// Agent Configuration types (mirrors backend AgentConfigResponse schema)

export type AgentType = 'claude_code' | 'codex' | 'custom';

export interface AgentConfig {
  id: number;
  user_id: string;
  project_id: string | null;
  agent_type: AgentType;
  display_name: string;
  binary_path: string | null;
  default_model: string | null;
  max_turns: number;
  has_api_key: boolean;
  has_env_vars: boolean;
  env_var_keys: string[];
  is_default: boolean;
  system_prompt: string | null;
  description: string | null;
  is_template: boolean;
  command_template: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentConfigCreate {
  agent_type: AgentType;
  display_name: string;
  binary_path?: string | null;
  default_model?: string | null;
  max_turns?: number;
  api_key?: string | null;
  env_vars?: Record<string, string> | null;
  project_id?: string | null;
  is_default?: boolean;
  system_prompt?: string | null;
  description?: string | null;
  is_template?: boolean;
  command_template?: string | null;
}

export interface AgentConfigUpdate {
  display_name?: string;
  binary_path?: string | null;
  default_model?: string | null;
  max_turns?: number;
  api_key?: string | null;
  env_vars?: Record<string, string> | null;
  is_default?: boolean;
  system_prompt?: string | null;
  description?: string | null;
  command_template?: string | null;
}

export interface BinaryVerifyResult {
  config_id: number;
  binary_path: string;
  found: boolean;
  resolved_path: string | null;
}

export const AGENT_TYPE_LABELS: Record<AgentType, string> = {
  claude_code: 'Claude Code',
  codex: 'Codex CLI',
  custom: 'Custom',
};

// Agent Process types (mirrors backend AgentStatusResponse schema)

export type AgentStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
export type AgentOutputMode = 'terminal' | 'chat';

export interface AgentProcess {
  id: string;
  agentType: AgentType;
  projectId: string;
  tmuxSession: string;
  pid: number;
  status: AgentStatus;
  websocketUrl: string | null;
  createdAt: string;
  stoppedAt: string | null;
  exitCode: number | null;
  outputMode: AgentOutputMode;
}

export interface AgentLaunchFromConfigRequest {
  config_id: number;
  project_id: string;
  prompt?: string;
  output_mode?: AgentOutputMode;
}

// Agent Tool Call types (from SSE event stream)
export interface AgentToolCall {
  name: string;
  args: Record<string, unknown>;
  resultPreview: string | null;
  error: string | null;
  durationMs: number;
  success: boolean;
  timestamp: string;
  agentId: string | null;
}

// MCP Log Entry types (persisted history - mirrors backend MCPLogResponse)
export interface MCPLogEntry {
  id: string;
  projectId: string;
  agentProcessId: string | null;
  sessionId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolResult: string | null;
  success: boolean;
  error: string | null;
  durationMs: number;
  createdAt: string;
}
