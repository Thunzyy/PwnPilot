import { useState } from "react";
import {
  Terminal,
  Monitor,
  CheckCircle2,
  XCircle,
  Copy,
  Bot,
  Trash2,
  ChevronDown,
  ChevronUp,
  Clock,
  Folder,
  GitBranchPlus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { CommandHistory } from "@/types/ai";

interface CommandEntryProps {
  command: CommandHistory;
  onCopy: () => void;
  onSendToAI: () => void;
  onDelete: () => void;
  onNavigateToTerminal?: () => void;
  onInferGraph?: () => void;
  onRevealEvidence?: () => void;
  canRevealEvidence?: boolean;
  graphProposalStatus?: "pending" | "accepted" | "creating" | null;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);

  if (diffSecs < 60) return "just now";
  if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
  if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ago`;
  return `${Math.floor(diffSecs / 86400)}d ago`;
}

export function CommandEntry({
  command,
  onCopy,
  onSendToAI,
  onDelete,
  onNavigateToTerminal,
  onInferGraph,
  onRevealEvidence,
  canRevealEvidence = false,
  graphProposalStatus = null,
}: CommandEntryProps) {
  const [expanded, setExpanded] = useState(false);
  const isSuccess = command.exit_code === 0;
  const hasOutput = !!command.output_preview || !!command.output;

  const statusConfig = isSuccess
    ? {
        color: "text-emerald-400",
        bg: "bg-emerald-400/10",
        border: "border-emerald-400/20",
        icon: CheckCircle2,
        label: "success",
      }
    : {
        color: "text-red-400",
        bg: "bg-red-400/10",
        border: "border-red-400/20",
        icon: XCircle,
        label: `exit ${command.exit_code}`,
      };

  const StatusIcon = statusConfig.icon;
  const timestamp = new Date(command.created_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const outputToShow = expanded ? command.output : command.output_preview;
  const graphStatusLabel =
    graphProposalStatus === "accepted"
      ? "Graph accepted"
      : graphProposalStatus === "pending"
        ? "Graph proposed"
        : graphProposalStatus === "creating"
          ? "Inferring graph"
          : "Infer graph";
  const graphActionDisabled =
    graphProposalStatus === "accepted" ||
    graphProposalStatus === "pending" ||
    graphProposalStatus === "creating";

  return (
    <div
      className="group flex gap-6 relative"
      style={{ contentVisibility: "auto", containIntrinsicSize: "360px" }}
    >
      {/* Timeline dot */}
      <div className="flex flex-col items-center shrink-0 relative z-10 pt-1">
        <div
          className={cn(
            "size-4 rounded-full border-2 bg-[#0b0f17] transition-all duration-300 group-hover:scale-125",
            "border-cyan-400/50"
          )}
        >
          <div className="size-full rounded-full animate-pulse-slow opacity-20 bg-cyan-400/10" />
        </div>
      </div>

      <Card className="flex-1 bg-white/[0.02] border-white/5 mb-8 overflow-hidden transition-all duration-300 hover:border-white/10 hover:bg-white/[0.03] group-hover:translate-x-1">
        {/* Header */}
        <div className="px-4 py-2.5 bg-white/[0.01] border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge
              variant="outline"
              className="h-5 text-[9px] font-bold tracking-tight uppercase px-2 bg-cyan-400/10 text-cyan-400 border-cyan-400/20"
            >
              <Terminal className="h-2.5 w-2.5 mr-1" />
              CMD
            </Badge>

            {/* Terminal session badge */}
            <Badge
              variant="outline"
              className={cn(
                "h-5 text-[9px] font-medium px-2 bg-primary/10 text-primary border-primary/20",
                onNavigateToTerminal &&
                  "cursor-pointer hover:bg-primary/20 hover:text-primary transition-colors"
              )}
              onClick={(e) => {
                if (onNavigateToTerminal) {
                  e.stopPropagation();
                  onNavigateToTerminal();
                }
              }}
              title={
                onNavigateToTerminal
                  ? "Go to terminal"
                  : undefined
              }
            >
              <Monitor className="h-2.5 w-2.5 mr-1" />
              {command.session_name ||
                command.session_id.slice(-8)}
            </Badge>

            <span className="text-[10px] font-mono text-slate-500">
              {timestamp}
            </span>

            <div className="h-4 w-px bg-white/5" />

            {/* Status badge */}
            <Badge
              variant="outline"
              className={cn(
                "h-5 text-[9px] font-bold tracking-tight px-2",
                statusConfig.bg,
                statusConfig.color,
                statusConfig.border
              )}
            >
              <StatusIcon className="h-2.5 w-2.5 mr-1" />
              {statusConfig.label}
            </Badge>

            {/* Duration */}
            <div className="flex items-center gap-1 text-[10px] text-slate-500">
              <Clock className="h-2.5 w-2.5" />
              {formatDuration(command.duration_ms)}
            </div>

            {/* Relative time */}
            <span className="text-[10px] text-slate-600">
              {formatRelativeTime(command.created_at)}
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-slate-500 hover:text-white"
              onClick={onCopy}
              title="Copy command"
            >
              <Copy className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-slate-500 hover:text-primary"
              onClick={onSendToAI}
              title="Send to AI"
            >
              <Bot className="h-3 w-3" />
            </Button>
            {onInferGraph ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-slate-500 hover:text-cyan-300 disabled:text-slate-600"
                onClick={onInferGraph}
                title={graphStatusLabel}
                aria-label={graphStatusLabel}
                disabled={graphActionDisabled}
              >
                <GitBranchPlus className="h-3 w-3" />
              </Button>
            ) : null}
            {canRevealEvidence && onRevealEvidence ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500 hover:text-primary"
                onClick={onRevealEvidence}
                title="Show evidence"
                aria-label="Show evidence"
              >
                Evidence
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-slate-500 hover:text-red-400"
              onClick={onDelete}
              title="Delete"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4">
          {/* Command */}
          <div className="rounded-lg bg-black/40 border border-white/5 p-3 group/cmd relative transition-colors hover:border-white/10">
            <div className="flex gap-3 font-mono text-sm leading-relaxed">
              <span className="text-primary font-bold opacity-50 select-none">
                $
              </span>
              <span className="text-slate-200 whitespace-pre-wrap break-all">
                {command.command}
              </span>
            </div>
          </div>

          {/* Output preview */}
          {hasOutput && (
            <div className="mt-3">
              <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-2 text-[10px] text-slate-500 hover:text-slate-300 transition-colors mb-2"
              >
                {expanded ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
                {expanded ? "Hide output" : "Show output"}
              </button>

              {(expanded || command.output_preview) && (
                <div className="rounded-lg bg-black/30 border border-white/5 p-3 overflow-x-auto">
                  <pre className="font-mono text-[11px] text-slate-400 whitespace-pre-wrap break-all">
                    {outputToShow}
                    {!expanded &&
                      command.output &&
                      command.output.length > 200 && (
                        <span className="text-slate-600">
                          {"\n"}... (click to expand)
                        </span>
                      )}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Footer: cwd and source */}
          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-1 text-[10px] text-slate-600">
              <Folder className="h-3 w-3" />
              <span className="font-mono truncate max-w-[300px]">
                {command.cwd}
              </span>
            </div>

            {command.source !== "user" && (
              <Badge
                variant="outline"
                className="h-4 text-[8px] px-1.5 border-slate-600 text-slate-500"
              >
                {command.source}
              </Badge>
            )}
            {graphProposalStatus && (
              <Badge
                variant="outline"
                className={cn(
                  "h-4 text-[8px] px-1.5",
                  graphProposalStatus === "accepted"
                    ? "border-emerald-400/30 text-emerald-300"
                    : graphProposalStatus === "creating"
                      ? "border-amber-400/30 text-amber-300"
                      : "border-cyan-400/30 text-cyan-300"
                )}
              >
                {graphStatusLabel}
              </Badge>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
