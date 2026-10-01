import { useEffect, useRef, useState } from "react";
import { AlertCircle, Copy, Loader2, Terminal as TerminalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTerminalStore } from "@/stores/terminalStore";
import { TerminalTabs } from "./TerminalTabs";
import { XTerminal, XTerminalHandle } from "./XTerminal";

interface AdvancedTerminalProps {
  projectId?: string;
  onSendToAI?: (text: string) => void;
}

export function AdvancedTerminal({
  projectId,
  onSendToAI,
}: AdvancedTerminalProps) {
  const {
    sessions,
    activeSessionId,
    capabilities,
    isCapabilitiesLoading,
    error,
    fetchCapabilities,
    fetchSessions,
    createSession,
    queuedCommand,
    setQueuedCommand,
  } =
    useTerminalStore();
  const xtermRef = useRef<XTerminalHandle>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle"
  );
  const [hasLoadedSessions, setHasLoadedSessions] = useState(false);
  const pendingInitialRef = useRef(false);
  const providerUnavailableReason =
    capabilities && !capabilities.canCreateSession
      ? capabilities.reasonUnavailable ?? "Terminal sessions are unavailable."
      : null;

  useEffect(() => {
    let cancelled = false;
    setHasLoadedSessions(false);
    Promise.all([
      fetchCapabilities().catch(() => undefined),
      fetchSessions(projectId).catch(() => undefined),
    ])
      .finally(() => {
        if (!cancelled) {
          setHasLoadedSessions(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fetchCapabilities, fetchSessions, projectId]);

  useEffect(() => {
    if (!hasLoadedSessions) {
      return;
    }
    if (capabilities && !capabilities.canCreateSession) {
      return;
    }
    if (sessions.length === 0 && !pendingInitialRef.current) {
      pendingInitialRef.current = true;
      createSession("Terminal 1", projectId).finally(() => {
        pendingInitialRef.current = false;
      });
    }
  }, [hasLoadedSessions, sessions.length, capabilities, createSession, projectId]);

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  useEffect(() => {
    if (!queuedCommand || !activeSession || !xtermRef.current) return;
    xtermRef.current.sendCommand(`${queuedCommand}\r`);
    setQueuedCommand(null);
  }, [queuedCommand, activeSession, setQueuedCommand]);

  const handleCopyOutput = async () => {
    const contents = xtermRef.current?.getBufferText() ?? "";
    if (!contents.trim()) {
      setCopyState("error");
      setTimeout(() => setCopyState("idle"), 2000);
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(contents);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = contents;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopyState("copied");
    } catch {
      setCopyState("error");
    } finally {
      setTimeout(() => setCopyState("idle"), 2000);
    }
  };

  const handleSendToAI = () => {
    if (!activeSession || !onSendToAI) {
      return;
    }

    const contents = xtermRef.current?.getBufferText() ?? "";
    if (!contents.trim()) {
      return;
    }

    onSendToAI(
      [
        `Terminal session: ${activeSession.name}`,
        `Session ID: ${activeSession.id.slice(0, 8)}`,
        "",
        "Transcript:",
        contents,
      ].join("\n")
    );
  };

  return (
    <div className="flex-1 flex flex-col bg-[#0b0f17] font-mono text-[13px] overflow-hidden">

      <TerminalTabs projectId={projectId} />

      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {isCapabilitiesLoading && !hasLoadedSessions ? (
          <div className="flex-1 flex items-center justify-center text-slate-500">
            <div className="text-center">
              <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin opacity-40" />
              <p className="text-sm">Loading terminal capabilities...</p>
            </div>
          </div>
        ) : providerUnavailableReason && !activeSession ? (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <div className="text-center max-w-sm px-6">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 text-amber-400/70" />
              <p className="text-sm text-slate-200">Terminal unavailable</p>
              <p className="text-xs opacity-70 mt-2">{providerUnavailableReason}</p>
            </div>
          </div>
        ) : error && !activeSession ? (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <div className="text-center max-w-sm px-6">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 text-amber-400/70" />
              <p className="text-sm text-slate-200">Terminal unavailable</p>
              <p className="text-xs opacity-70 mt-2">{error}</p>
            </div>
          </div>
        ) : activeSession ? (
          <XTerminal
            ref={xtermRef}
            sessionId={activeSession.id}
            websocketUrl={activeSession.websocketUrl}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-500">
            <div className="text-center">
              <TerminalIcon className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p className="text-sm">No active terminal</p>
              <p className="text-xs opacity-50 mt-1">
                Click + to create a new session
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="h-10 border-t border-white/5 bg-black/40 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopyOutput}
            className="h-6 text-[10px] font-bold text-slate-500 hover:text-white uppercase tracking-tighter gap-1.5 px-2"
          >
            <Copy className="h-3 w-3" />{" "}
            {copyState === "copied"
              ? "Copied!"
              : copyState === "error"
              ? "Copy Failed"
              : "Copy Output"}
          </Button>
          {onSendToAI && activeSession ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSendToAI}
              className="h-6 text-[10px] font-bold text-slate-500 hover:text-white uppercase tracking-tighter gap-1.5 px-2"
            >
              <TerminalIcon className="h-3 w-3" />
              Send to AI
            </Button>
          ) : null}
          <div className="h-3 w-px bg-white/10" />
          <div className="text-[10px] text-slate-600 font-mono tracking-tight">
            {activeSession ? `ID: ${activeSession.id.slice(0, 8)}` : "No session"}
            {" • "}
            Sessions: {sessions.length}
            {capabilities ? ` • ${capabilities.provider}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[9px] text-slate-600">
          {activeSession?.isAlive ? (
            <span className="text-emerald-400">● CONNECTED</span>
          ) : (
            <span className="text-red-400">● DISCONNECTED</span>
          )}
        </div>
      </div>
    </div>
  );
}
