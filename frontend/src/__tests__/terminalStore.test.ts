import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../api/client", () => ({
  api: apiMock,
  API_BASE_URL: "http://localhost:8000",
}));

import { useTerminalStore } from "../stores/terminalStore";

const originalFetch = globalThis.fetch;

const resetStore = () => {
  useTerminalStore.setState({
    sessions: [],
    activeSessionId: null,
    isConnecting: false,
    error: null,
    queuedCommand: null,
    capabilities: null,
    isCapabilitiesLoading: false,
  });
};

describe("terminalStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("does not add a session when createSession receives 401", async () => {
    const errorPayload = {
      error: {
        code: "8004:AUTH_INVALID_TOKEN",
        message: "Invalid access token",
      },
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue(errorPayload),
    });

    apiMock.post.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(
      useTerminalStore.getState().createSession("Terminal 1", "proj-1")
    ).rejects.toThrow("Failed to create session");

    const state = useTerminalStore.getState();
    expect(state.sessions).toHaveLength(0);
    expect(state.activeSessionId).toBeNull();
    expect(state.error).toBe("Failed to create session");
  });

  it("stores terminal capabilities from the backend", async () => {
    apiMock.get.mockResolvedValueOnce({
      data: {
        provider: "legacy",
        platform: "windows",
        can_create_session: true,
        can_detach: false,
        websocket_mode: "legacy",
        reason_unavailable:
          "Detach to native terminal requires the tmux_ttyd provider.",
      },
    });

    await useTerminalStore.getState().fetchCapabilities();

    expect(useTerminalStore.getState().capabilities).toEqual({
      provider: "legacy",
      platform: "windows",
      canCreateSession: true,
      canDetach: false,
      websocketMode: "legacy",
      reasonUnavailable:
        "Detach to native terminal requires the tmux_ttyd provider.",
    });
  });

  it("blocks detachSession when provider capabilities do not allow it", async () => {
    useTerminalStore.setState({
      capabilities: {
        provider: "legacy",
        platform: "windows",
        canCreateSession: true,
        canDetach: false,
        websocketMode: "legacy",
        reasonUnavailable:
          "Detach to native terminal requires the tmux_ttyd provider.",
      },
    });

    await expect(
      useTerminalStore.getState().detachSession("session-1")
    ).rejects.toThrow(
      "Detach to native terminal requires the tmux_ttyd provider."
    );

    expect(apiMock.post).not.toHaveBeenCalled();
    expect(useTerminalStore.getState().error).toBe(
      "Detach to native terminal requires the tmux_ttyd provider."
    );
  });

  it("surfaces backend detail when session creation fails", async () => {
    apiMock.post.mockRejectedValueOnce({
      response: {
        data: {
          detail: "tmux and ttyd are unavailable on this machine.",
        },
      },
    });

    await expect(
      useTerminalStore.getState().createSession("Terminal 1", "proj-1")
    ).rejects.toThrow("tmux and ttyd are unavailable on this machine.");

    expect(useTerminalStore.getState().error).toBe(
      "tmux and ttyd are unavailable on this machine."
    );
  });
});
