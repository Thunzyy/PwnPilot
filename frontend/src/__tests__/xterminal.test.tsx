import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";

const { MockTerminal } = vi.hoisted(() => {
  class MockTerminal {
    cols = 80;
    rows = 24;
    buffer = {
      active: {
        length: 0,
        getLine: () => null,
      },
    };

    open() {}
    loadAddon() {}
    write() {}
    writeln() {}
    focus() {}
    onData() {}
    onBinary() {}
    onResize() {}
    onSelectionChange() {}
    attachCustomKeyEventHandler() {
      return true;
    }
    dispose() {}
  }

  return { MockTerminal };
});

const diagnosticsStoreState = vi.hoisted(() => ({
  recordEvent: vi.fn(),
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: MockTerminal,
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {},
}));

vi.mock("@/stores/diagnosticsStore", () => ({
  useDiagnosticsStore: {
    getState: () => diagnosticsStoreState,
  },
}));

import { XTerminal } from "../components/Terminal/XTerminal";

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  binaryType = "";
  sent: unknown[] = [];
  closeCalls = 0;
  onopen?: () => void;
  onmessage?: (event: MessageEvent) => void;
  onclose?: (event: CloseEvent) => void;
  onerror?: () => void;

  constructor(public url: string, public protocols?: string | string[]) {
    MockWebSocket.instances.push(this);
  }

  send(data: unknown) {
    if (this.readyState === MockWebSocket.CONNECTING) {
      throw new DOMException(
        "Failed to execute 'send' on 'WebSocket': Still in CONNECTING state.",
        "InvalidStateError"
      );
    }
    this.sent.push(data);
  }

  close() {
    this.closeCalls += 1;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: 1000 } as CloseEvent);
  }

  triggerOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  triggerError() {
    this.onerror?.();
  }
}

const decodeSocketMessage = (message: unknown) => {
  if (typeof message === "string") {
    return message;
  }
  if (message instanceof Uint8Array) {
    return new TextDecoder().decode(message);
  }
  if (message instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(message));
  }
  return String(message);
};

const originalWebSocket = globalThis.WebSocket;
const originalResizeObserver = globalThis.ResizeObserver;

beforeEach(() => {
  MockWebSocket.instances = [];
  diagnosticsStoreState.recordEvent.mockClear();
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    writable: true,
    value: originalWebSocket,
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: originalResizeObserver,
  });
});

describe("XTerminal", () => {
  it("sends ttyd handshake payload on open", async () => {
    render(
      <XTerminal sessionId="session-1" websocketUrl="ws://localhost:7681/ws" />
    );

    const socket = MockWebSocket.instances[0];
    expect(socket).toBeDefined();

    await act(async () => {
      socket.triggerOpen();
    });

    expect(socket.sent.length).toBeGreaterThan(0);
    const firstMessage = socket.sent[0];
    const decoded =
      typeof firstMessage === "string"
        ? firstMessage
        : new TextDecoder().decode(firstMessage as Uint8Array);

    expect(decoded.startsWith("{")).toBe(true);
    const payload = JSON.parse(decoded);
    expect(payload).toMatchObject({ columns: 80, rows: 24 });
  });

  it("does not close connecting socket before it opens", async () => {
    const { unmount } = render(
      <XTerminal sessionId="session-1" websocketUrl="ws://localhost:7683/ws" />
    );

    const socket = MockWebSocket.instances[0];
    expect(socket.readyState).toBe(MockWebSocket.CONNECTING);

    await act(async () => {
      unmount();
    });

    expect(socket.closeCalls).toBe(0);

    await act(async () => {
      socket.triggerOpen();
    });

    expect(socket.closeCalls).toBe(1);
  });

  it("shows an explicit connection failure state when the websocket errors", async () => {
    render(
      <XTerminal sessionId="session-1" websocketUrl="ws://localhost:7683/ws" />
    );

    const socket = MockWebSocket.instances[0];

    await act(async () => {
      socket.triggerError();
    });

    expect(screen.getByText("Connection failed")).toBeInTheDocument();
    expect(
      screen.getByText("Unable to connect to this terminal session.")
    ).toBeInTheDocument();
    expect(diagnosticsStoreState.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "terminal",
        severity: "error",
        title: "Terminal WebSocket connection failed",
        message: "Unable to connect to this terminal session.",
        source: "ws://localhost:7683/ws",
      })
    );
  });

  it("queues commands issued before the websocket opens and flushes them on connect", async () => {
    const terminalRef = createRef<{
      sendCommand: (command: string) => void;
    }>();

    render(
      <XTerminal
        ref={terminalRef}
        sessionId="session-1"
        websocketUrl="ws://localhost:7683/ws"
      />
    );

    const socket = MockWebSocket.instances[0];

    expect(() => {
      terminalRef.current?.sendCommand("whoami\r");
    }).not.toThrow();
    expect(socket.sent).toEqual([]);

    await act(async () => {
      socket.triggerOpen();
    });

    expect(socket.sent.map(decodeSocketMessage)).toContain(`0whoami\r`);
  });
});
