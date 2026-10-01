import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { buildWebSocketUrl } from "../../api/client";
import { redactDiagnosticsUrl } from "@/lib/diagnostics";
import { useDiagnosticsStore } from "@/stores/diagnosticsStore";
import "@xterm/xterm/css/xterm.css";

interface XTerminalProps {
  sessionId: string;
  websocketUrl?: string;
  readOnly?: boolean;
  onData?: (data: string) => void;
  onConnect?: () => void;
}

// ttyd protocol message types
// Client -> Server: INPUT='0', RESIZE='1', PAUSE='2', RESUME='3'
// Server -> Client: OUTPUT='0', SET_TITLE='1', SET_PREFS='2'
const TTYD_INPUT = "0";
const TTYD_RESIZE = "1";
const TTYD_OUTPUT = "0";

export interface XTerminalHandle {
  getBufferText: () => string;
  focus: () => void;
  sendCommand: (command: string) => void;
}

interface PwnPilotDebugWindow extends Window {
  __pwnpilotLastCopied?: string;
  __pwnpilotCopyErrors?: unknown;
  __pwnpilotTerm?: Terminal;
  __pwnpilotLastShortcut?: number;
}

const getTerminalSessionKey = ({
  readOnly = false,
  sessionId,
  websocketUrl,
}: XTerminalProps) =>
  `${sessionId}:${websocketUrl ?? ""}:${readOnly ? "ro" : "rw"}`;

const XTerminalSession = forwardRef<XTerminalHandle, XTerminalProps>(
  function XTerminalSession(
    { sessionId, websocketUrl, readOnly = false, onData, onConnect }: XTerminalProps,
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const textEncoderRef = useRef<TextEncoder | null>(null);
    const textDecoderRef = useRef<TextDecoder | null>(null);
    const sendInputRef = useRef<(data: string) => void>(() => undefined);
    const pendingInputRef = useRef<string[]>([]);
    const [isConnected, setIsConnected] = useState(false);
    const [connectionState, setConnectionState] = useState<
      "connecting" | "connected" | "error" | "closed"
    >("connecting");

    // Detect if using ttyd (direct ttyd WebSocket) or legacy backend
    const isTtydDirect =
      websocketUrl?.includes("/ws") &&
      !websocketUrl?.includes("/api/v1/terminal");

    useEffect(() => {
      if (!containerRef.current) return;

      const textEncoder = textEncoderRef.current ?? new TextEncoder();
      textEncoderRef.current = textEncoder;
      const textDecoder = textDecoderRef.current ?? new TextDecoder();
      textDecoderRef.current = textDecoder;

      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontSize: 13,
        fontFamily: "JetBrains Mono, Menlo, Monaco, Courier New, monospace",
        theme: {
          background: "#0b0f17",
          foreground: "#e4e7ec",
          cursor: "#0ea5e9",
          cursorAccent: "#0b0f17",
          selectionBackground: "#0ea5e933",
          black: "#1e1e2e",
          red: "#f38ba8",
          green: "#a6e3a1",
          yellow: "#f9e2af",
          blue: "#89b4fa",
          magenta: "#0ea5e9",
          cyan: "#94e2d5",
          white: "#e2e8f0",
          brightBlack: "#45475a",
          brightRed: "#f38ba8",
          brightGreen: "#a6e3a1",
          brightYellow: "#f9e2af",
          brightBlue: "#89b4fa",
          brightMagenta: "#cba6f7",
          brightCyan: "#94e2d5",
          brightWhite: "#f5f5f5",
        },
      });

      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();

      term.loadAddon(fitAddon);
      term.loadAddon(webLinksAddon);
      term.open(containerRef.current);

      const copySelection = async () => {
        const selection = term.getSelection();
        if (!selection) {
          return;
        }
        try {
          if (typeof window !== "undefined") {
            (window as PwnPilotDebugWindow).__pwnpilotLastCopied = selection;
          }
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(selection);
          } else {
            const textarea = document.createElement("textarea");
            textarea.value = selection;
            textarea.style.position = "fixed";
            textarea.style.opacity = "0";
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            document.execCommand("copy");
            document.body.removeChild(textarea);
          }
        } catch (error) {
          console.error("Failed to copy selection", error);
          if (typeof window !== "undefined") {
            (window as PwnPilotDebugWindow).__pwnpilotCopyErrors = error;
          }
        }
      };

      setTimeout(() => fitAddon.fit(), 0);

      terminalRef.current = term;
      fitAddonRef.current = fitAddon;
      if (typeof window !== "undefined" && import.meta.env.DEV) {
        (window as PwnPilotDebugWindow).__pwnpilotTerm = term;
      }

      let didUnmount = false;
      let hasOpened = false;
      const wsUrlToUse =
        websocketUrl || `${buildWebSocketUrl("/api/v1/terminal/ws")}/${sessionId}`;
      const ws = isTtydDirect
        ? new WebSocket(wsUrlToUse, ["tty"])
        : new WebSocket(wsUrlToUse);
      if (isTtydDirect) {
        ws.binaryType = "arraybuffer";
      }

      // Helper functions for ttyd protocol
      const sendTtydCommand = (type: string, payload?: string) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (!payload) {
          ws.send(type);
          return;
        }
        const encoded = textEncoder.encode(payload);
        const buffer = new Uint8Array(encoded.length + 1);
        buffer[0] = type.charCodeAt(0);
        buffer.set(encoded, 1);
        ws.send(buffer);
      };

      const sendInput = (data: string) => {
        if (ws.readyState === WebSocket.CONNECTING) {
          pendingInputRef.current.push(data);
          return;
        }
        if (ws.readyState !== WebSocket.OPEN) {
          return;
        }
        if (isTtydDirect) {
          sendTtydCommand(TTYD_INPUT, data);
        } else {
          ws.send(data);
        }
      };

      const sendResize = (cols: number, rows: number) => {
        if (isTtydDirect) {
          sendTtydCommand(
            TTYD_RESIZE,
            JSON.stringify({ columns: cols, rows })
          );
        } else {
          ws.send(`\x1b[resize:${cols},${rows}]`);
        }
      };

      ws.onopen = () => {
        if (didUnmount) {
          ws.close();
          return;
        }
        setIsConnected(true);
        setConnectionState("connected");
        hasOpened = true;
        onConnect?.();
        term.writeln("\x1b[32m● Connected to terminal session\x1b[0m\r\n");
        const { cols, rows } = term;
        if (isTtydDirect) {
          const initPayload = JSON.stringify({ columns: cols, rows });
          ws.send(textEncoder.encode(initPayload));
        } else {
          sendResize(cols, rows);
        }
        if (pendingInputRef.current.length > 0) {
          for (const pendingInput of pendingInputRef.current) {
            sendInput(pendingInput);
          }
          pendingInputRef.current = [];
        }
      };

      ws.onmessage = (event) => {
        if (didUnmount) return;
        if (isTtydDirect) {
          const handleBuffer = (buffer: ArrayBuffer) => {
            if (!buffer.byteLength) {
              return;
            }
            const bytes = new Uint8Array(buffer);
            const msgType = String.fromCharCode(bytes[0]);
            const msgData = textDecoder.decode(bytes.subarray(1));
            if (msgType === TTYD_OUTPUT) {
              term.write(msgData);
              onData?.(msgData);
            }
          };

          if (typeof event.data === "string") {
            const msgType = event.data[0];
            const msgData = event.data.slice(1);
            if (msgType === TTYD_OUTPUT) {
              term.write(msgData);
              onData?.(msgData);
            }
          } else if (event.data instanceof ArrayBuffer) {
            handleBuffer(event.data);
          } else if (event.data instanceof Blob) {
            event.data.arrayBuffer().then(handleBuffer).catch(() => undefined);
          }
        } else {
          term.write(event.data);
          onData?.(event.data);
        }
      };

      ws.onclose = () => {
        if (didUnmount) return;
        setIsConnected(false);
        setConnectionState(hasOpened ? "closed" : "error");
        term.writeln("\r\n\x1b[31m● Disconnected from terminal\x1b[0m");
      };

      ws.onerror = () => {
        if (didUnmount) return;
        setIsConnected(false);
        setConnectionState("error");
        term.writeln("\r\n\x1b[31m● Connection error\x1b[0m");
        if (import.meta.env.DEV) {
          useDiagnosticsStore.getState().recordEvent({
            category: "terminal",
            severity: "error",
            title: "Terminal WebSocket connection failed",
            message: "Unable to connect to this terminal session.",
            source: redactDiagnosticsUrl(wsUrlToUse),
          });
        }
      };

      wsRef.current = ws;
      sendInputRef.current = sendInput;

      const shouldHandleCopy = (event: KeyboardEvent) =>
        event.shiftKey &&
        (event.ctrlKey || event.metaKey) &&
        event.code === "KeyC";

      term.attachCustomKeyEventHandler((event) => {
        if (shouldHandleCopy(event)) {
          event.preventDefault();
          copySelection();
          return false;
        }
        return true;
      });

      const globalKeyListener = (event: KeyboardEvent) => {
        if (shouldHandleCopy(event)) {
          if (typeof window !== "undefined") {
            (window as PwnPilotDebugWindow).__pwnpilotLastShortcut = Date.now();
          }
          event.preventDefault();
          copySelection();
        }
      };
      window.addEventListener("keydown", globalKeyListener);

      if (!readOnly) {
        term.onData((data) => {
          if (ws.readyState === WebSocket.OPEN) {
            sendInput(data);
          }
        });
      } else {
        term.writeln("\x1b[33m[Read-only mode]\x1b[0m\r\n");
      }

      const handleResize = () => {
        fitAddon.fit();
        if (ws.readyState === WebSocket.OPEN) {
          const { cols, rows } = term;
          sendResize(cols, rows);
        }
      };

      window.addEventListener("resize", handleResize);

      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
      });
      resizeObserver.observe(containerRef.current);

      return () => {
        didUnmount = true;
        window.removeEventListener("resize", handleResize);
        resizeObserver.disconnect();
        window.removeEventListener("keydown", globalKeyListener);
        if (ws.readyState !== WebSocket.CONNECTING) {
          ws.close();
        }
        pendingInputRef.current = [];
        wsRef.current = null;
        term.dispose();
      };
    }, [sessionId, websocketUrl, readOnly, onData, onConnect, isTtydDirect]);

    useImperativeHandle(
      ref,
      () => ({
        getBufferText: () => {
          const term = terminalRef.current;
          if (!term) {
            return "";
          }
          const buffer = term.buffer.active;
          const lines: string[] = [];
          for (let i = 0; i < buffer.length; i += 1) {
            const line = buffer.getLine(i);
            if (!line) continue;
            lines.push(line.translateToString(true));
          }
          return lines.join("\n").trimEnd();
        },
        focus: () => {
          terminalRef.current?.focus();
        },
        sendCommand: (command: string) => {
          sendInputRef.current(command);
          terminalRef.current?.focus();
        },
      }),
      []
    );

    return (
      <div className="relative flex-1 min-h-0">
        <div
          ref={containerRef}
          className="absolute inset-0 p-2"
          style={{ background: "#0b0f17" }}
        />
        {connectionState === "connecting" && !isConnected && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <div className="size-2 rounded-full bg-yellow-500 animate-pulse" />
              Connecting...
            </div>
          </div>
        )}
        {connectionState === "error" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70">
            <div className="text-center text-slate-200">
              <p className="text-sm font-medium">Connection failed</p>
              <p className="mt-1 text-xs text-slate-400">
                Unable to connect to this terminal session.
              </p>
            </div>
          </div>
        )}
      </div>
    );
  }
);

export const XTerminal = forwardRef<XTerminalHandle, XTerminalProps>(
  function XTerminal(props, ref) {
    return (
      <XTerminalSession
        key={getTerminalSessionKey(props)}
        ref={ref}
        {...props}
      />
    );
  }
);
