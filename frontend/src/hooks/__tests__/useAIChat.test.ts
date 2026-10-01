import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAIChat } from "../useAIChat";

const authState = {
  accessToken: "test-token",
};

const chatStoreState = {
  messagesCache: {} as Record<string, unknown[]>,
  setCachedMessages: vi.fn((key: string, messages: unknown[]) => {
    chatStoreState.messagesCache[key] = messages;
  }),
};

const diagnosticsStoreState = {
  recordEvent: vi.fn(),
};

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (
    selector?: (state: typeof authState) => unknown,
  ) => (selector ? selector(authState) : authState),
}));

vi.mock("@/stores/chatStore", () => ({
  useChatStore: (
    selector?: (state: typeof chatStoreState) => unknown,
  ) => (selector ? selector(chatStoreState) : chatStoreState),
}));

vi.mock("@/api/client", () => ({
  buildWebSocketUrl: (path: string) => `ws://test.local${path}`,
}));

vi.mock("@/stores/diagnosticsStore", () => ({
  useDiagnosticsStore: {
    getState: () => diagnosticsStoreState,
  },
}));

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  onopen?: () => void;
  onmessage?: (event: MessageEvent) => void;
  onclose?: () => void;
  onerror?: () => void;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  triggerOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  triggerMessage(payload: unknown) {
    this.onmessage?.({
      data: JSON.stringify(payload),
    } as MessageEvent);
  }
}

const originalWebSocket = globalThis.WebSocket;

describe("useAIChat", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    chatStoreState.messagesCache = {};
    chatStoreState.setCachedMessages.mockClear();
    diagnosticsStoreState.recordEvent.mockClear();
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("req-1");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    globalThis.WebSocket = originalWebSocket;
  });

  it("creates an assistant placeholder immediately and finalizes it on complete without prior chunks", () => {
    const { result } = renderHook(() => useAIChat(null, "conv-1"));

    const socket = MockWebSocket.instances[0];
    expect(socket.url).toBe("ws://test.local/ws/ai/global?token=test-token");

    act(() => {
      socket.triggerOpen();
    });

    act(() => {
      result.current.sendMessage("Quel modele tu utilises ?", {
        model: "gpt-5.4",
        providerId: 2,
      });
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({
      id: "req-1-user",
      role: "user",
      content: "Quel modele tu utilises ?",
    });
    expect(result.current.messages[1]).toMatchObject({
      id: "req-1",
      role: "assistant",
      content: "",
      isStreaming: true,
    });

    act(() => {
      socket.triggerMessage({
        type: "complete",
        message_id: "req-1",
        total_tokens: 42,
        prompt_tokens: 20,
        completion_tokens: 22,
        model: "gpt-5.4",
        provider: "Codex",
        source_mode: "cli_orchestrated",
        cli_command: "codex exec --json --model gpt-5.4",
        user_message_id: "user-1",
        assistant_message_id: "assistant-1",
      });
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]).toMatchObject({
      id: "req-1",
      role: "assistant",
      content: "",
      isStreaming: false,
      model: "gpt-5.4",
      provider: "Codex",
      sourceMode: "cli_orchestrated",
      cliCommand: "codex exec --json --model gpt-5.4",
      tokens: {
        prompt: 20,
        completion: 22,
        total: 42,
      },
    });
  });

  it("turns the assistant placeholder into an error message when the websocket returns an error", () => {
    const { result } = renderHook(() => useAIChat(null, "conv-1"));

    const socket = MockWebSocket.instances[0];

    act(() => {
      socket.triggerOpen();
    });

    act(() => {
      result.current.sendMessage("Quel modele tu utilises ?", {
        model: "gpt-5.4",
        providerId: 2,
      });
    });

    act(() => {
      socket.triggerMessage({
        type: "error",
        message_id: "req-1",
        code: "AI_PROVIDER_ERROR",
        message: "Usage limit reached",
        details: null,
      });
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]).toMatchObject({
      id: "req-1",
      role: "assistant",
      content: "",
      isStreaming: false,
      error: "Usage limit reached",
    });
  });

  it("does not recreate the websocket when local message state changes after sending", () => {
    const { result } = renderHook(() => useAIChat(null, "conv-1"));

    const socket = MockWebSocket.instances[0];

    act(() => {
      socket.triggerOpen();
    });

    act(() => {
      result.current.sendMessage("hello");
    });

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(socket.readyState).toBe(MockWebSocket.OPEN);
  });

  it("records a diagnostic event when the AI websocket fails", () => {
    renderHook(() => useAIChat("project-1", "conv-1"));

    const socket = MockWebSocket.instances[0];

    act(() => {
      socket.onerror?.();
    });

    expect(diagnosticsStoreState.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "ai",
        severity: "error",
        title: "AI WebSocket connection failed",
        message: "WebSocket connection failed",
        source: "/ws/ai/project-1",
      })
    );
  });

  it("keeps streamed content when the completion event arrives after chunks", () => {
    const { result } = renderHook(() => useAIChat(null, "conv-1"));

    const socket = MockWebSocket.instances[0];

    act(() => {
      socket.triggerOpen();
    });

    act(() => {
      result.current.sendMessage("hello");
    });

    act(() => {
      socket.triggerMessage({
        type: "chunk",
        message_id: "req-1",
        content: "CODEX OK",
        index: 0,
      });
    });

    act(() => {
      socket.triggerMessage({
        type: "complete",
        message_id: "req-1",
        total_tokens: 12,
        prompt_tokens: 5,
        completion_tokens: 7,
        model: "gpt-5.4",
        provider: "Codex",
        source_mode: "cli_orchestrated",
        cli_command: "codex exec --json --model gpt-5.4",
        user_message_id: "user-1",
        assistant_message_id: "assistant-1",
      });
    });

    expect(result.current.messages[1]).toMatchObject({
      id: "req-1",
      content: "CODEX OK",
      isStreaming: false,
      model: "gpt-5.4",
      provider: "Codex",
    });
  });
});
