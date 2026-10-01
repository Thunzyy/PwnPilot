import { forwardRef, useImperativeHandle } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const { storeState, fetchCapabilitiesMock, fetchSessionsMock, createSessionMock } =
  vi.hoisted(() => {
    const fetchCapabilitiesMock = vi.fn<() => Promise<void>>();
    const fetchSessionsMock = vi.fn<(...args: unknown[]) => Promise<void>>();
    const createSessionMock = vi.fn<(...args: unknown[]) => Promise<void>>();
    return {
      fetchCapabilitiesMock,
      fetchSessionsMock,
      createSessionMock,
      storeState: {
        sessions: [] as Array<{
          id: string;
          name: string;
          websocketUrl: string;
          isAlive: boolean;
        }>,
        activeSessionId: null as string | null,
        capabilities: {
          provider: "legacy",
          platform: "windows",
          canCreateSession: true,
          canDetach: false,
          websocketMode: "legacy",
          reasonUnavailable: null,
        },
        isCapabilitiesLoading: false,
        error: null as string | null,
        fetchCapabilities: fetchCapabilitiesMock,
        fetchSessions: fetchSessionsMock,
        createSession: createSessionMock,
        queuedCommand: null as string | null,
        setQueuedCommand: vi.fn(),
      },
    };
  });

const { terminalHandleState } = vi.hoisted(() => ({
  terminalHandleState: {
    bufferText: "whoami\nid",
    sendCommand: vi.fn(),
  },
}));

vi.mock("@/stores/terminalStore", () => ({
  useTerminalStore: () => storeState,
}));

vi.mock("../TerminalTabs", () => ({
  TerminalTabs: () => <div data-testid="terminal-tabs" />,
}));

vi.mock("../XTerminal", () => ({
  XTerminal: forwardRef((_props, ref) => {
    useImperativeHandle(ref, () => ({
      getBufferText: () => terminalHandleState.bufferText,
      focus: vi.fn(),
      sendCommand: terminalHandleState.sendCommand,
    }));
    return <div data-testid="xterm" />;
  }),
}));

import { AdvancedTerminal } from "../AdvancedTerminal";

describe("AdvancedTerminal", () => {
  beforeEach(() => {
    storeState.sessions = [];
    storeState.activeSessionId = null;
    storeState.capabilities = {
      provider: "legacy",
      platform: "windows",
      canCreateSession: true,
      canDetach: false,
      websocketMode: "legacy",
      reasonUnavailable: null,
    };
    storeState.isCapabilitiesLoading = false;
    storeState.error = null;
    storeState.queuedCommand = null;
    terminalHandleState.bufferText = "whoami\nid";
    terminalHandleState.sendCommand.mockReset();
    fetchCapabilitiesMock.mockReset();
    fetchSessionsMock.mockReset();
    createSessionMock.mockReset();
    fetchCapabilitiesMock.mockResolvedValue(undefined);
    createSessionMock.mockResolvedValue(undefined);
  });

  it("does not create a terminal before sessions fetch finishes", async () => {
    fetchSessionsMock.mockReturnValue(new Promise(() => undefined));

    render(<AdvancedTerminal projectId="project-1" />);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchCapabilitiesMock).toHaveBeenCalled();
    expect(fetchSessionsMock).toHaveBeenCalledWith("project-1");
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("creates a default terminal once sessions fetch is completed and none exist", async () => {
    fetchSessionsMock.mockResolvedValue(undefined);

    render(<AdvancedTerminal projectId="project-1" />);

    await waitFor(() => {
      expect(createSessionMock).toHaveBeenCalledWith("Terminal 1", "project-1");
    });
  });

  it("shows the provider unavailability reason instead of an empty terminal state", async () => {
    storeState.capabilities = {
      provider: "tmux_ttyd",
      platform: "linux",
      canCreateSession: false,
      canDetach: false,
      websocketMode: "ttyd",
      reasonUnavailable: "tmux and ttyd are unavailable on this machine.",
    };
    fetchSessionsMock.mockResolvedValue(undefined);

    render(<AdvancedTerminal projectId="project-1" />);

    expect(
      await screen.findByText("tmux and ttyd are unavailable on this machine.")
    ).toBeInTheDocument();
    expect(screen.getByText("Terminal unavailable")).toBeInTheDocument();
    expect(screen.queryByText("No active terminal")).not.toBeInTheDocument();
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("sends the active terminal transcript to AI", async () => {
    const onSendToAI = vi.fn();
    storeState.sessions = [
      {
        id: "session-1",
        name: "Terminal 1",
        websocketUrl: "ws://localhost:8000",
        isAlive: true,
      },
    ];
    storeState.activeSessionId = "session-1";
    fetchSessionsMock.mockResolvedValue(undefined);

    render(<AdvancedTerminal projectId="project-1" onSendToAI={onSendToAI} />);

    await screen.findByTestId("xterm");
    screen.getByRole("button", { name: /Send to AI/i }).click();

    expect(onSendToAI).toHaveBeenCalledWith(
      expect.stringContaining("Terminal 1")
    );
    expect(onSendToAI).toHaveBeenCalledWith(
      expect.stringContaining("whoami\nid")
    );
  });

  it("does not send empty terminal output to AI", async () => {
    const onSendToAI = vi.fn();
    terminalHandleState.bufferText = "   ";
    storeState.sessions = [
      {
        id: "session-1",
        name: "Terminal 1",
        websocketUrl: "ws://localhost:8000",
        isAlive: true,
      },
    ];
    storeState.activeSessionId = "session-1";
    fetchSessionsMock.mockResolvedValue(undefined);

    render(<AdvancedTerminal projectId="project-1" onSendToAI={onSendToAI} />);

    await screen.findByTestId("xterm");
    screen.getByRole("button", { name: /Send to AI/i }).click();

    expect(onSendToAI).not.toHaveBeenCalled();
  });

  it("runs a queued command once the active terminal session is ready", async () => {
    storeState.sessions = [
      {
        id: "session-1",
        name: "Terminal 1",
        websocketUrl: "ws://localhost:8000",
        isAlive: true,
      },
    ];
    storeState.activeSessionId = "session-1";
    storeState.queuedCommand = "whoami";
    fetchSessionsMock.mockResolvedValue(undefined);

    render(<AdvancedTerminal projectId="project-1" />);

    await screen.findByTestId("xterm");

    await waitFor(() => {
      expect(terminalHandleState.sendCommand).toHaveBeenCalledWith("whoami\r");
    });
    expect(storeState.setQueuedCommand).toHaveBeenCalledWith(null);
  });
});
