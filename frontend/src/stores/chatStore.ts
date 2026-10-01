import { create } from 'zustand';
import { aiApi } from '@/api/ai';
import type { ChatMessage, ConversationSummary } from '@/types/ai';

interface ChatState {
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  isTempChat: boolean;
  messagesCache: Record<string, ChatMessage[]>;
  isLoading: boolean;
  error: string | null;

  fetchConversations: (projectId: string | null) => Promise<void>;
  createConversation: (
    projectId: string | null,
    options?: { model?: string; providerConfigId?: number },
  ) => Promise<string>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  pinConversation: (id: string, pinned: boolean) => Promise<void>;
  setActive: (id: string | null) => void;
  startTempChat: () => void;
  loadMessages: (conversationId: string) => Promise<void>;
  setCachedMessages: (conversationId: string, messages: ChatMessage[]) => void;
  clearError: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  conversations: [],
  activeConversationId: null,
  isTempChat: false,
  messagesCache: {},
  isLoading: false,
  error: null,

  fetchConversations: async (projectId) => {
    set({ isLoading: true, error: null });
    try {
      const conversations = await aiApi.listConversations(projectId ?? "__global__");
      set((s) => {
        const shouldAutoSelect = !s.activeConversationId && !s.isTempChat && conversations.length > 0;
        return {
          conversations,
          isLoading: false,
          activeConversationId: shouldAutoSelect ? conversations[0].id : s.activeConversationId,
        };
      });
    } catch {
      set({ error: 'Failed to load conversations', isLoading: false });
    }
  },

  createConversation: async (projectId, options) => {
    set({ isLoading: true, error: null });
    try {
      const conv = await aiApi.createConversation({
        project_id: projectId ?? undefined,
        model: options?.model,
        provider_config_id: options?.providerConfigId,
      });
      set((s) => ({
        conversations: [
          {
            id: conv.id,
            project_id: conv.project_id,
            title: conv.title,
            pinned: false,
            model: conv.model,
            provider_config_id: conv.provider_config_id,
            updated_at: conv.updated_at,
            message_count: 0,
          },
          ...s.conversations,
        ],
        activeConversationId: conv.id,
        isTempChat: false,
        isLoading: false,
      }));
      return conv.id;
    } catch (err) {
      set({ error: 'Failed to create conversation', isLoading: false });
      throw err;
    }
  },

  deleteConversation: async (id) => {
    try {
      await aiApi.deleteConversation(id);
      set((s) => {
        const { [id]: removedMessages, ...rest } = s.messagesCache;
        void removedMessages;
        return {
          conversations: s.conversations.filter((c) => c.id !== id),
          activeConversationId: s.activeConversationId === id ? null : s.activeConversationId,
          messagesCache: rest,
        };
      });
    } catch {
      set({ error: 'Failed to delete conversation' });
    }
  },

  renameConversation: async (id, title) => {
    try {
      await aiApi.updateConversation(id, { title });
      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === id ? { ...c, title } : c
        ),
      }));
    } catch {
      set({ error: 'Failed to rename conversation' });
    }
  },

  pinConversation: async (id, pinned) => {
    try {
      await aiApi.updateConversation(id, { pinned });
      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === id ? { ...c, pinned } : c
        ),
      }));
    } catch {
      set({ error: 'Failed to pin conversation' });
    }
  },

  setActive: (id) => set({ activeConversationId: id, isTempChat: false }),

  startTempChat: () => set({ activeConversationId: null, isTempChat: true }),

  loadMessages: async (conversationId) => {
    try {
      const detail = await aiApi.getConversation(conversationId);
      const messages: ChatMessage[] = detail.messages.map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: new Date(m.created_at),
        model: m.model,
        provider: m.provider,
        sourceMode: m.source_mode,
        cliCommand: m.cli_command,
        tokens: m.tokens_prompt != null
          ? {
              prompt: m.tokens_prompt,
              completion: m.tokens_completion ?? 0,
              total: (m.tokens_prompt ?? 0) + (m.tokens_completion ?? 0),
            }
          : null,
        error: m.error,
        attachments: m.attachments,
        parentId: m.parent_id,
        siblingIndex: m.sibling_index,
        siblingCount: m.sibling_count,
      }));
      set((s) => ({
        messagesCache: { ...s.messagesCache, [conversationId]: messages },
        conversations: s.conversations.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                title: detail.title,
                model: detail.model,
                provider_config_id: detail.provider_config_id,
              }
            : c
        ),
      }));
    } catch {
      set({ error: 'Failed to load messages' });
    }
  },

  setCachedMessages: (conversationId, messages) =>
    set((s) => ({
      messagesCache: { ...s.messagesCache, [conversationId]: messages },
    })),

  clearError: () => set({ error: null }),
}));
