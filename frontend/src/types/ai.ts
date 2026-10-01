// AI Provider types
export type ProviderType = 'ollama' | 'openai_compat' | 'openai' | 'anthropic' | 'cli';
export type HealthStatus = 'healthy' | 'unhealthy' | 'unknown';
export type ContextType = 'general' | 'recon' | 'exploit' | 'post' | 'terminal';
export type AIRoutingContextType = 'general' | 'graph' | 'reporting';
export type SourceMode = 'api' | 'cli_orchestrated' | 'cli_terminal';
export type CLIParseMode = 'json' | 'markdown' | 'raw';
export type ConversationExportFormat =
  | 'claude'
  | 'codex'
  | 'gemini'
  | 'aider'
  | 'markdown'
  | 'json';
export type CLISessionStatus = 'running' | 'idle' | 'exited';

export interface AIProvider {
  id: number;
  user_id: string;
  provider_type: ProviderType;
  name: string;
  is_enabled: boolean;
  base_url: string | null;
  has_api_key: boolean;
  custom_headers: Record<string, string> | null;
  timeout_seconds: number;
  default_model: string;
  temperature: number;
  max_tokens: number;
  top_p: number;
  frequency_penalty: number;
  presence_penalty: number;
  last_health_check: string | null;
  health_status: HealthStatus | null;
  cli_command: string | null;
  cli_args_template: string | null;
  cli_interactive_args: string | null;
  cli_env: Record<string, string> | null;
  working_directory: string | null;
  parse_mode: CLIParseMode | null;
  supports_streaming: boolean;
  supports_resume: boolean;
  session_flag: string | null;
  detected_version: string | null;
  detected_models: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface AIProviderCreate {
  provider_type: ProviderType;
  name: string;
  is_enabled?: boolean;
  base_url?: string | null;
  api_key?: string | null;
  custom_headers?: Record<string, string> | null;
  timeout_seconds?: number;
  default_model: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  cli_command?: string | null;
  cli_args_template?: string | null;
  cli_interactive_args?: string | null;
  cli_env?: Record<string, string> | null;
  working_directory?: string | null;
  parse_mode?: CLIParseMode | null;
  supports_streaming?: boolean;
  supports_resume?: boolean;
  session_flag?: string | null;
  detected_version?: string | null;
  detected_models?: string[] | null;
}

export interface AIProviderUpdate {
  name?: string;
  is_enabled?: boolean;
  base_url?: string | null;
  api_key?: string | null;
  custom_headers?: Record<string, string> | null;
  timeout_seconds?: number;
  default_model?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  cli_command?: string | null;
  cli_args_template?: string | null;
  cli_interactive_args?: string | null;
  cli_env?: Record<string, string> | null;
  working_directory?: string | null;
  parse_mode?: CLIParseMode | null;
  supports_streaming?: boolean | null;
  supports_resume?: boolean | null;
  session_flag?: string | null;
  detected_version?: string | null;
  detected_models?: string[] | null;
}

export interface DetectedCLIProvider {
  provider_type: 'cli';
  name: string;
  default_model: string;
  cli_command: string;
  cli_args_template: string | null;
  cli_interactive_args: string | null;
  cli_env: Record<string, string> | null;
  working_directory: string | null;
  parse_mode: CLIParseMode;
  supports_streaming: boolean;
  supports_resume: boolean;
  session_flag: string | null;
  detected_version: string | null;
  detected_models: string[] | null;
}

export interface HealthCheckResult {
  provider_id: number;
  status: HealthStatus;
  latency_ms: number | null;
  error_message: string | null;
  checked_at: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  context_length: number | null;
  description: string | null;
}

export interface ModelsListResponse {
  provider_id: number;
  provider_name: string;
  models: ModelInfo[];
  cached: boolean;
}

export interface AIContextRouting {
  id: number;
  user_id: string;
  project_id: string | null;
  context_type: AIRoutingContextType;
  provider_config_id: number;
  model: string | null;
}

export interface AIContextRoutingCreate {
  project_id?: string | null;
  context_type: AIRoutingContextType;
  provider_config_id: number;
  model?: string | null;
}

// WebSocket message types
export interface WSChatMessage {
  type: 'chat';
  message_id: string;
  content: string;
  context_type?: ContextType;
  mode?: 'question' | 'agent';
  project_id?: string | null;
  conversation_id?: string | null;
  attachment_ids?: string[];
  overrides?: {
    provider_id?: number | null;
    model?: string | null;
    temperature?: number | null;
    max_tokens?: number | null;
    system_prompt?: string | null;
  } | null;
}

export interface WSChunkResponse {
  type: 'chunk';
  message_id: string;
  content: string;
  index: number;
}

export interface WSCompleteResponse {
  type: 'complete';
  message_id: string;
  total_tokens: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  model: string | null;
  provider: string | null;
  source_mode: SourceMode;
  cli_command: string | null;
  user_message_id: string | null;
  assistant_message_id: string | null;
}

export interface WSCancelledResponse {
  type: 'cancelled';
  message_id: string;
}

export interface WSErrorResponse {
  type: 'error';
  message_id: string | null;
  code: string;
  message: string;
  details: Record<string, unknown> | null;
}

export interface WSToolCallStart {
  type: 'tool_call_start';
  message_id: string;
  call_id: string;
  seq: number;
  name: string;
  args: Record<string, unknown>;
}

export interface WSToolCallResult {
  type: 'tool_call_result';
  message_id: string;
  call_id: string;
  seq: number;
  name: string;
  result: unknown;
  duration_ms: number;
  success: boolean;
}

export interface WSToolCallError {
  type: 'tool_call_error';
  message_id: string;
  call_id: string;
  seq: number;
  name: string;
  error: string;
}

export type WSResponse =
  | WSChunkResponse
  | WSCompleteResponse
  | WSCancelledResponse
  | WSErrorResponse
  | WSToolCallStart
  | WSToolCallResult
  | WSToolCallError;

// Chat UI types
export interface ToolCallData {
  callId: string;
  seq: number;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs?: number;
  status: 'running' | 'success' | 'error' | 'cancelled';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  model?: string | null;
  provider?: string | null;
  sourceMode?: SourceMode;
  cliCommand?: string | null;
  tokens?: { prompt: number; completion: number; total: number } | null;
  error?: string | null;
  attachments?: Attachment[];
  parentId?: string | null;
  siblingIndex?: number;
  siblingCount?: number;
  toolCalls?: ToolCallData[];
}

// Conversations
export interface ConversationSummary {
  id: string;
  project_id: string | null;
  title: string;
  pinned: boolean;
  model: string | null;
  provider_config_id?: number | null;
  updated_at: string;
  message_count: number;
}

export interface ConversationDetail {
  id: string;
  project_id: string;
  title: string;
  model: string | null;
  provider_config_id: number | null;
  created_at: string;
  updated_at: string;
  messages: PersistedChatMessage[];
}

export interface ConversationCreate {
  project_id?: string | null;
  title?: string;
  model?: string;
  provider_config_id?: number;
}

export interface ConversationExport {
  conversation_id: string;
  format: ConversationExportFormat;
  filename: string;
  content: string;
  resume_command: string | null;
}

export interface CLISession {
  id: string;
  conversation_id: string;
  provider_config_id: number;
  terminal_session_id: string | null;
  terminal_name: string | null;
  terminal_websocket_url: string | null;
  terminal_is_alive: boolean;
  cli_command: string;
  status: CLISessionStatus;
  working_directory: string | null;
  last_imported_at: string | null;
  started_at: string;
  exited_at: string | null;
}

export interface CLISessionCreate {
  conversation_id: string;
  provider_config_id: number;
  cols?: number;
  rows?: number;
}

export interface CLISessionImportResult {
  cli_session_id: string;
  imported_commands: number;
  imported_messages: number;
  last_imported_at: string | null;
}

// Attachments
export interface Attachment {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
}

export interface PendingAttachment {
  id: string;
  file: File;
  filename: string;
  status: 'uploading' | 'done' | 'error';
  progress: number;
  serverAttachment?: Attachment;
}

// Persisted message (from REST API)
export interface PersistedChatMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model: string | null;
  provider: string | null;
  tokens_prompt: number | null;
  tokens_completion: number | null;
  error: string | null;
  source_mode: SourceMode;
  cli_command: string | null;
  cli_exit_code: number | null;
  cli_duration_ms: number | null;
  parent_id: string | null;
  sibling_index: number;
  sibling_count: number;
  attachments: Attachment[];
  created_at: string;
}

// Memories
export interface AIMemory {
  id: string;
  user_id: string;
  project_id: string;
  key: string;
  value: string;
  created_at: string;
  updated_at: string;
}

// Prompt Templates
export type PromptType = 'system' | 'template';

export interface PromptTemplate {
  id: number;
  type: PromptType;
  category: string;
  name: string;
  description: string | null;
  variables: string[];
  content: string;
  is_default: boolean;
  is_user_created: boolean;
  created_at: string;
  updated_at: string;
}

export interface PromptTemplateCreate {
  type: PromptType;
  name: string;
  description?: string;
  category: string;
  variables?: string[];
  content: string;
}

export interface PromptTemplateUpdate {
  name?: string;
  description?: string;
  variables?: string[];
  content?: string;
}

export interface CategoryGroup {
  id: string;
  name: string;
  templates: PromptTemplate[];
}

export interface TemplatesByCategory {
  categories: CategoryGroup[];
}

// Command History
export type CommandSource = 'user' | 'ai' | 'template' | 'agent';

export interface CommandHistory {
  id: string;
  project_id: string;
  session_id: string;
  session_name: string | null;
  command: string;
  output_preview: string | null;
  output?: string | null;
  exit_code: number;
  cwd: string;
  duration_ms: number;
  executed_by: string;
  source: CommandSource;
  timeline_id: string | null;
  created_at: string;
}

export interface CommandHistoryListResponse {
  items: CommandHistory[];
  total: number;
  limit: number;
  offset: number;
}

export interface PromoteToTimelineResponse {
  timeline_id: string;
  command_id: string;
}
