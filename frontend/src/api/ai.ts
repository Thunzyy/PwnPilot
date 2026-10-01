import { api } from './client';
import type {
  AIMemory,
  AIContextRouting,
  AIContextRoutingCreate,
  CLISession,
  CLISessionCreate,
  CLISessionImportResult,
  AIProvider,
  AIProviderCreate,
  AIProviderUpdate,
  Attachment,
  CommandHistory,
  CommandHistoryListResponse,
  CommandSource,
  ConversationCreate,
  ConversationDetail,
  ConversationExport,
  ConversationExportFormat,
  ConversationSummary,
  DetectedCLIProvider,
  HealthCheckResult,
  ModelsListResponse,
  PersistedChatMessage,
  PromoteToTimelineResponse,
  PromptTemplate,
  PromptTemplateCreate,
  PromptTemplateUpdate,
  TemplatesByCategory,
} from '../types/ai';

export const aiApi = {
  // Providers
  listProviders: () =>
    api.get<AIProvider[]>('/ai/providers').then(r => r.data),

  createProvider: (data: AIProviderCreate) =>
    api.post<AIProvider>('/ai/providers', data).then(r => r.data),

  updateProvider: (id: number, data: AIProviderUpdate) =>
    api.put<AIProvider>(`/ai/providers/${id}`, data).then(r => r.data),

  deleteProvider: (id: number) =>
    api.delete(`/ai/providers/${id}`),

  testProvider: (id: number) =>
    api.post<HealthCheckResult>(`/ai/providers/${id}/test`).then(r => r.data),

  listModels: (id: number) =>
    api.get<ModelsListResponse>(`/ai/providers/${id}/models`).then(r => r.data),

  detectCLIProviders: () =>
    api.post<DetectedCLIProvider[]>('/ai/providers/detect-clis').then(r => r.data),

  resolveCLIProvider: (cliCommand: string) =>
    api.post<DetectedCLIProvider | null>('/ai/providers/resolve-cli', {
      cli_command: cliCommand,
    }).then(r => r.data),

  listRouting: (projectId?: string | null) =>
    api
      .get<AIContextRouting[]>('/ai/routing', {
        params: { project_id: projectId ?? undefined },
      })
      .then(r => r.data),

  updateRouting: (data: AIContextRoutingCreate[]) =>
    api.put<AIContextRouting[]>('/ai/routing', data).then(r => r.data),

  // Conversations
  listConversations: (projectId?: string) => {
    const params = projectId ? { project_id: projectId } : {};
    return api.get<ConversationSummary[]>('/ai/conversations', { params }).then(r => r.data);
  },

  createConversation: (data: ConversationCreate) =>
    api.post<ConversationDetail>('/ai/conversations', data).then(r => r.data),

  getConversation: (id: string, limit = 50, offset = 0) =>
    api.get<ConversationDetail>(`/ai/conversations/${id}`, { params: { limit, offset } }).then(r => r.data),

  updateConversation: (id: string, data: { title?: string; pinned?: boolean }) =>
    api.put<ConversationDetail>(`/ai/conversations/${id}`, data).then(r => r.data),

  deleteConversation: (id: string) =>
    api.delete(`/ai/conversations/${id}`),

  exportConversation: (
    id: string,
    format: ConversationExportFormat = 'markdown',
  ) =>
    api.post<ConversationExport>(
      `/ai/conversations/${id}/export`,
      null,
      { params: { format } },
    ).then(r => r.data),

  getConversationCLISession: (conversationId: string) =>
    api.get<CLISession | null>(`/ai/conversations/${conversationId}/cli-session`).then(r => r.data),

  createCLISession: (data: CLISessionCreate) =>
    api.post<CLISession>('/ai/cli-sessions', data).then(r => r.data),

  getCLISession: (id: string) =>
    api.get<CLISession>(`/ai/cli-sessions/${id}`).then(r => r.data),

  deleteCLISession: (id: string) =>
    api.delete(`/ai/cli-sessions/${id}`),

  importCLISession: (id: string) =>
    api.post<CLISessionImportResult>(`/ai/cli-sessions/${id}/import`).then(r => r.data),

  // Message editing & branching
  updateMessage: (conversationId: string, messageId: string, content: string) =>
    api.put<PersistedChatMessage>(
      `/ai/conversations/${conversationId}/messages/${messageId}`,
      { content },
    ).then(r => r.data),

  branchMessage: (
    conversationId: string,
    messageId: string,
    content: string,
  ) =>
    api.post<PersistedChatMessage>(
      `/ai/conversations/${conversationId}/messages/${messageId}/branch`,
      { content },
    ).then(r => r.data),

  // Attachments
  uploadAttachment: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<Attachment>('/ai/attachments', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data);
  },

  getAttachmentUrl: (id: string) =>
    `${api.defaults.baseURL}/ai/attachments/${id}`,

  deleteAttachment: (id: string) =>
    api.delete(`/ai/attachments/${id}`),

  // Memories
  listMemories: (projectId: string | null) =>
    api.get<AIMemory[]>('/ai/memories', { params: { project_id: projectId ?? undefined } }).then(r => r.data),

  createMemory: (data: { project_id?: string | null; key: string; value: string }) =>
    api.post<AIMemory>('/ai/memories', data).then(r => r.data),

  updateMemory: (id: string, data: { key?: string; value?: string }) =>
    api.put<AIMemory>(`/ai/memories/${id}`, data).then(r => r.data),

  deleteMemory: (id: string) =>
    api.delete(`/ai/memories/${id}`),

  // Prompt Templates
  listSystemPrompts: () =>
    api.get<PromptTemplate[]>('/prompts/system').then(r => r.data),

  listTemplatesByCategory: () =>
    api.get<TemplatesByCategory>('/prompts/templates').then(r => r.data),

  listTemplatesForCategory: (category: string) =>
    api.get<PromptTemplate[]>(`/prompts/templates/${category}`).then(r => r.data),

  getPrompt: (id: number) =>
    api.get<PromptTemplate>(`/prompts/${id}`).then(r => r.data),

  createPrompt: (data: PromptTemplateCreate) =>
    api.post<PromptTemplate>('/prompts', data).then(r => r.data),

  updatePrompt: (id: number, data: PromptTemplateUpdate) =>
    api.put<PromptTemplate>(`/prompts/${id}`, data).then(r => r.data),

  deletePrompt: (id: number) =>
    api.delete(`/prompts/${id}`),

  setDefaultPrompt: (id: number) =>
    api.post<PromptTemplate>(`/prompts/${id}/set-default`).then(r => r.data),

  getDefaultPrompt: (category: string) =>
    api.get<PromptTemplate | null>(`/prompts/default/${category}`).then(r => r.data),

  // Command History
  listProjectCommands: (
    projectId: string,
    params?: {
      limit?: number;
      offset?: number;
      search?: string;
      exit_code?: number;
      session_id?: string;
      source?: CommandSource;
      include_output?: boolean;
    },
  ) =>
    api.get<CommandHistoryListResponse>(
      `/projects/${projectId}/commands/history`,
      { params },
    ).then(r => r.data),

  getCommand: (projectId: string, commandId: string) =>
    api.get<CommandHistory>(`/projects/${projectId}/commands/history/${commandId}`).then(r => r.data),

  deleteCommand: (projectId: string, commandId: string) =>
    api.delete(`/projects/${projectId}/commands/history/${commandId}`),

  promoteCommandToTimeline: (projectId: string, commandId: string) =>
    api.post<PromoteToTimelineResponse>(
      `/projects/${projectId}/commands/history/${commandId}/to-timeline`,
    ).then(r => r.data),

  listSessionCommands: (
    sessionId: string,
    params?: {
      limit?: number;
      offset?: number;
      include_output?: boolean;
    },
  ) =>
    api.get<CommandHistoryListResponse>(
      `/terminal/sessions/${sessionId}/commands`,
      { params },
    ).then(r => r.data),
};
