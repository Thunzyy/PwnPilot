import { Download, Loader2, Square, TerminalSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { XTerminal } from "@/components/Terminal/XTerminal";
import type { CLISession } from "@/types/ai";

interface CLITerminalPanelProps {
  session: CLISession;
  providerName?: string | null;
  onImport: () => Promise<void> | void;
  onClose: () => Promise<void> | void;
  isImporting?: boolean;
  isClosing?: boolean;
}

export function CLITerminalPanel({
  session,
  providerName,
  onImport,
  onClose,
  isImporting = false,
  isClosing = false,
}: CLITerminalPanelProps) {
  if (!session.terminal_session_id || !session.terminal_websocket_url) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0b0f17] text-sm text-slate-500">
        Terminal session unavailable
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0b0f17]">
      <div className="flex items-center justify-between gap-3 border-b border-white/5 bg-black/30 px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm text-slate-100">
            <TerminalSquare className="h-4 w-4 text-sky-400" />
            <span className="truncate">{session.terminal_name ?? "CLI Terminal"}</span>
          </div>
          <p className="truncate text-[11px] text-slate-500">
            {providerName ?? session.cli_command}
            {" • "}
            {session.terminal_is_alive ? "connected" : "disconnected"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs text-slate-300 hover:bg-white/10"
            onClick={() => void onImport()}
            disabled={isImporting}
          >
            {isImporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            Import
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs text-slate-300 hover:bg-white/10"
            onClick={() => void onClose()}
            disabled={isClosing}
          >
            {isClosing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
            Close
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <XTerminal
          sessionId={session.terminal_session_id}
          websocketUrl={session.terminal_websocket_url}
        />
      </div>
    </div>
  );
}
