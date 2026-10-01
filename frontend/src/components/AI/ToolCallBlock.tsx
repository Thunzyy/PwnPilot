import { useState } from "react";
import { Check, X, Loader2, ChevronDown, ChevronRight, StopCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolCallData } from "@/types/ai";

interface ToolCallBlockProps {
  toolCall: ToolCallData;
}

export function ToolCallBlock({ toolCall }: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = {
    running: <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />,
    success: <Check className="h-3.5 w-3.5 text-emerald-400" />,
    error: <X className="h-3.5 w-3.5 text-red-400" />,
    cancelled: <StopCircle className="h-3.5 w-3.5 text-slate-400" />,
  }[toolCall.status];

  const borderColor = {
    running: "border-primary/30",
    success: "border-emerald-500/20",
    error: "border-red-500/20",
    cancelled: "border-slate-500/20",
  }[toolCall.status];

  return (
    <div className={cn("my-1.5 rounded-md border bg-white/[0.02] text-xs", borderColor)}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left"
      >
        {statusIcon}
        <span className="font-mono font-medium text-slate-300">{toolCall.name}</span>
        {toolCall.durationMs != null && (
          <span className="text-slate-500">{toolCall.durationMs}ms</span>
        )}
        {toolCall.status === "running" && (
          <span className="text-slate-500">Running...</span>
        )}
        {toolCall.status === "error" && (
          <span className="truncate text-red-400">{toolCall.error}</span>
        )}
        <span className="ml-auto">
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-slate-500" />
          ) : (
            <ChevronRight className="h-3 w-3 text-slate-500" />
          )}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-white/5 px-3 py-2 space-y-2">
          {Object.keys(toolCall.args).length > 0 && (
            <div>
              <span className="text-slate-500">Args:</span>
              <pre className="mt-0.5 max-h-32 overflow-auto rounded bg-black/30 p-2 text-slate-400">
                {JSON.stringify(toolCall.args, null, 2)}
              </pre>
            </div>
          )}
          {toolCall.result != null && (
            <div>
              <span className="text-slate-500">Result:</span>
              <pre className="mt-0.5 max-h-48 overflow-auto rounded bg-black/30 p-2 text-slate-400">
                {typeof toolCall.result === "string"
                  ? toolCall.result
                  : JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
