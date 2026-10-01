import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useChatStore } from '@/stores/chatStore';
import { useDiagnosticsStore } from '@/stores/diagnosticsStore';
import { buildWebSocketUrl } from '@/api/client';
import type { ChatMessage, WSChatMessage, WSResponse } from '@/types/ai';

interface SendOptions {
  attachmentIds?: string[];
  model?: string;
  providerId?: number;
  mode?: 'question' | 'agent';
}

export function useAIChat(projectId: string | null, conversationId: string | null) {
  const [liveMessages, setLiveMessages] = useState<ChatMessage[] | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const accessToken = useAuthStore((s) => s.accessToken);
  const cacheKey = conversationId ?? `__live__:${projectId ?? '__global__'}`;
  const cachedMessages = useChatStore((s) =>
    s.messagesCache[cacheKey]
  );
  const setCachedMessages = useChatStore((s) => s.setCachedMessages);
  const messages = liveMessages ?? cachedMessages ?? [];
  const messagesRef = useRef<ChatMessage[]>(messages);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!liveMessages) return;
    setCachedMessages(cacheKey, liveMessages);
  }, [cacheKey, liveMessages, setCachedMessages]);

  const applyMessages = useCallback(
    (updater: ChatMessage[] | ((messages: ChatMessage[]) => ChatMessage[])) => {
      setLiveMessages((current) => {
        const base = current ?? messagesRef.current;
        return typeof updater === "function"
          ? (updater as (messages: ChatMessage[]) => ChatMessage[])(base)
          : updater;
      });
    },
    []
  );

  const handleWSMessage = useCallback((data: WSResponse) => {
    switch (data.type) {
      case 'chunk':
        applyMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === data.message_id);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], content: updated[idx].content + data.content };
            return updated;
          }
          return [
            ...prev,
            {
              id: data.message_id,
              role: 'assistant',
              content: data.content,
              timestamp: new Date(),
              isStreaming: true,
            },
          ];
        });
        break;

      case 'complete':
        applyMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === data.message_id);
          const nextMessage = {
            id: data.message_id,
            role: 'assistant' as const,
            content: idx >= 0 ? prev[idx].content : '',
            timestamp: new Date(),
            isStreaming: false,
            model: data.model,
            provider: data.provider,
            sourceMode: data.source_mode,
            cliCommand: data.cli_command,
            tokens:
              data.total_tokens != null
                ? {
                    prompt: data.prompt_tokens ?? 0,
                    completion: data.completion_tokens ?? 0,
                    total: data.total_tokens,
                  }
                : null,
          };

          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], ...nextMessage };
            return updated;
          }

          return [...prev, nextMessage];
        });
        break;

      case 'error':
        if (data.message_id) {
          const messageId = data.message_id;
          applyMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === messageId);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = {
                ...updated[idx],
                isStreaming: false,
                error: data.message,
              };
              return updated;
            }

            return [
              ...prev,
              {
                id: messageId,
                role: 'assistant',
                content: '',
                timestamp: new Date(),
                isStreaming: false,
                error: data.message,
              },
            ];
          });
        } else {
          setConnectionError(data.message);
        }
        break;

      case 'cancelled':
        applyMessages((prev) =>
          prev.map((m) =>
            m.id === data.message_id
              ? { ...m, isStreaming: false, error: m.error ?? 'Cancelled' }
              : m
          ),
        );
        break;

      case 'tool_call_start':
        applyMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === data.message_id);
          if (idx < 0) return prev;
          const updated = [...prev];
          const msg = { ...updated[idx] };
          const toolCalls = [...(msg.toolCalls || [])];
          toolCalls.push({
            callId: data.call_id,
            seq: data.seq,
            name: data.name,
            args: data.args,
            status: 'running',
          });
          msg.toolCalls = toolCalls;
          updated[idx] = msg;
          return updated;
        });
        break;

      case 'tool_call_result':
        applyMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === data.message_id);
          if (idx < 0) return prev;
          const updated = [...prev];
          const msg = { ...updated[idx] };
          const toolCalls = (msg.toolCalls || []).map((tc) =>
            tc.callId === data.call_id
              ? { ...tc, result: data.result, durationMs: data.duration_ms, status: 'success' as const }
              : tc,
          );
          msg.toolCalls = toolCalls;
          updated[idx] = msg;
          return updated;
        });
        break;

      case 'tool_call_error':
        applyMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === data.message_id);
          if (idx < 0) return prev;
          const updated = [...prev];
          const msg = { ...updated[idx] };
          const toolCalls = (msg.toolCalls || []).map((tc) =>
            tc.callId === data.call_id
              ? { ...tc, error: data.error, status: (data.error === 'cancelled' ? 'cancelled' : 'error') as 'cancelled' | 'error' }
              : tc,
          );
          msg.toolCalls = toolCalls;
          updated[idx] = msg;
          return updated;
        });
        break;
    }
  }, [applyMessages]);

  useEffect(() => {
    if (!accessToken) return;

    const wsPath = projectId ? `/ws/ai/${projectId}` : '/ws/ai/global';
    const ws = new WebSocket(`${buildWebSocketUrl(wsPath)}?token=${accessToken}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      setConnectionError(null);
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data) as WSResponse;
      handleWSMessage(data);
    };

    ws.onclose = (event) => {
      setIsConnected(false);
      const closeCode = event?.code;
      if (
        import.meta.env.DEV &&
        closeCode &&
        closeCode !== 1000 &&
        closeCode !== 1001
      ) {
        useDiagnosticsStore.getState().recordEvent({
          category: 'ai',
          severity: 'warning',
          title: 'AI WebSocket closed unexpectedly',
          message: `Connection closed with code ${closeCode}`,
          source: wsPath,
          code: String(closeCode),
        });
      }
    };

    ws.onerror = () => {
      const message = 'WebSocket connection failed';
      setConnectionError(message);
      setIsConnected(false);
      if (import.meta.env.DEV) {
        useDiagnosticsStore.getState().recordEvent({
          category: 'ai',
          severity: 'error',
          title: 'AI WebSocket connection failed',
          message,
          source: wsPath,
        });
      }
    };

    return () => {
      ws.close();
    };
  }, [accessToken, handleWSMessage, projectId]);

  const sendMessage = useCallback(
    (content: string, options?: SendOptions) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

      const requestId = crypto.randomUUID();

      applyMessages((prev) => [
        ...prev,
        { id: `${requestId}-user`, role: 'user', content, timestamp: new Date() },
        {
          id: requestId,
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          isStreaming: true,
        },
      ]);

      const msg: WSChatMessage = {
        type: 'chat',
        message_id: requestId,
        content,
        context_type: 'general',
        mode: options?.mode ?? 'question',
        conversation_id: conversationId,
        attachment_ids: options?.attachmentIds,
        overrides: options?.model || options?.providerId
          ? {
              model: options?.model ?? null,
              provider_id: options?.providerId ?? null,
            }
          : undefined,
      };
      wsRef.current.send(JSON.stringify(msg));
    },
    [applyMessages, conversationId],
  );

  const cancelMessage = useCallback((messageId: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'cancel', message_id: messageId }));
  }, []);

  return { messages, isConnected, connectionError, sendMessage, cancelMessage };
}
