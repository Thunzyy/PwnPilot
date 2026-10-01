import {
  PlayCircle,
  CheckCircle2,
  AlertCircle,
  FileText,
  User,
  Bot,
  Cpu,
  Copy,
  MoreVertical,
  Table as TableIcon,
  Sparkles,
  BotMessageSquare,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { RelatedKnowledge } from "./RelatedKnowledge";

interface TimelineEntryProps {
  type: string;
  content: string;
  timestamp: string;
  author: string;
  output?: string;
  tableData?: { headers: string[]; rows: string[][] };
  entryId?: string;
  projectId?: string;
  onCopy?: () => void;
  onDelete?: () => void;
  onSendToAI?: () => void;
}

const typeConfig: Record<
  string,
  { color: string; bg: string; border: string; icon: typeof PlayCircle }
> = {
  action: {
    color: "text-primary",
    bg: "bg-primary/10",
    border: "border-primary/20",
    icon: PlayCircle,
  },
  result: {
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
    border: "border-emerald-400/20",
    icon: CheckCircle2,
  },
  error: {
    color: "text-red-400",
    bg: "bg-red-400/10",
    border: "border-red-400/20",
    icon: AlertCircle,
  },
  note: {
    color: "text-amber-400",
    bg: "bg-amber-400/10",
    border: "border-amber-400/20",
    icon: FileText,
  },
};

const fallbackTypeConfig = {
  color: "text-slate-400",
  bg: "bg-slate-400/10",
  border: "border-slate-400/20",
  icon: FileText,
};

const authorConfig: Record<string, { label: string; icon: typeof User }> = {
  user: { label: "Operator", icon: User },
  ai: { label: "PwnPilot AI", icon: Bot },
  system: { label: "Core System", icon: Cpu },
};

const fallbackAuthorConfig = { label: "Unknown", icon: Cpu };

export function TimelineEntry({
  type,
  content,
  timestamp,
  author,
  output,
  tableData,
  entryId,
  projectId,
  onCopy,
  onDelete,
  onSendToAI,
}: TimelineEntryProps) {
  const config = typeConfig[type] ?? fallbackTypeConfig;
  const auth = authorConfig[author] ?? fallbackAuthorConfig;
  const AuthIcon = auth.icon;

  return (
    <div
      className="group flex gap-6 relative"
      style={{ contentVisibility: "auto", containIntrinsicSize: "320px" }}
    >
      <div className="flex flex-col items-center shrink-0 relative z-10 pt-1">
        <div
          className={cn(
            "size-4 rounded-full border-2 bg-[#0b0f17] transition-all duration-300 group-hover:scale-125",
            config.border,
            "border-opacity-50"
          )}
        >
          <div
            className={cn(
              "size-full rounded-full animate-pulse-slow opacity-20",
              config.bg
            )}
          />
        </div>
      </div>

      <Card className="flex-1 bg-white/[0.02] border-white/5 mb-8 overflow-hidden transition-all duration-300 hover:border-white/10 hover:bg-white/[0.03] group-hover:translate-x-1">
        <div className="px-4 py-2.5 bg-white/[0.01] border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge
              variant="outline"
              className={cn(
                "h-5 text-[9px] font-bold tracking-tight uppercase px-2",
                config.bg,
                config.color,
                config.border
              )}
            >
              {type}
            </Badge>
            <span className="text-[10px] font-mono text-slate-500">
              {timestamp}
            </span>

            <div className="h-4 w-px bg-white/5" />

            <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              <AuthIcon className="h-3 w-3 text-slate-500" />
              {auth.label}
            </div>
          </div>

          <div className="flex items-center gap-1">
            {onSendToAI ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-slate-500 hover:text-primary"
                onClick={onSendToAI}
                aria-label="Send to AI"
                title="Send to AI"
              >
                <BotMessageSquare className="h-3 w-3" />
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-slate-500 hover:text-white"
              onClick={onCopy}
            >
              <Copy className="h-3 w-3" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-slate-500 hover:text-white"
                >
                  <MoreVertical className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="bg-[#1a2030] border-zinc-800 text-slate-200">
                <DropdownMenuItem onClick={onCopy}>
                  Copy Content
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={onDelete}
                >
                  Delete Entry
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="p-4">
          <p className="text-sm text-slate-200 leading-relaxed font-medium">
            {content}
          </p>

          {output && (
            <div className="mt-4 rounded-lg bg-black/40 border border-white/5 p-3 group/cmd relative transition-colors hover:border-white/10">
              <div
                className="absolute top-2 right-2 opacity-0 group-hover/cmd:opacity-100 transition-opacity"
                onClick={onCopy}
              >
                <Copy className="size-3 text-slate-500 cursor-pointer hover:text-primary" />
              </div>
              <div className="flex gap-3 font-mono text-[11px] leading-relaxed">
                <span className="text-primary font-bold opacity-50">$</span>
                <span className="text-emerald-400/90 whitespace-pre-wrap">
                  {output}
                </span>
              </div>
            </div>
          )}

          {tableData && (
            <div className="mt-4 border border-white/5 rounded-lg overflow-hidden bg-black/20">
              <div className="px-3 py-1.5 bg-white/[0.03] border-b border-white/5 flex items-center gap-2">
                <TableIcon className="size-3 text-slate-500" />
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                  Extracted Data
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="text-[10px] font-bold text-slate-500 border-b border-white/5 font-mono">
                    <tr>
                      {tableData.headers.map((header, idx) => (
                        <th
                          key={idx}
                          className="px-4 py-2 uppercase tracking-tighter bg-white/[0.01]"
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {tableData.rows.map((row, rowIdx) => (
                      <tr
                        key={rowIdx}
                        className="hover:bg-white/[0.02] transition-colors"
                      >
                        {row.map((cell, cellIdx) => (
                          <td
                            key={cellIdx}
                            className={cn(
                              "px-4 py-2 font-mono text-[10px]",
                              cellIdx === 0
                                ? "text-primary font-bold"
                                : "text-slate-300"
                            )}
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {type === "result" && (
            <div className="mt-4 flex justify-end">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[10px] font-bold gap-2 border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 hover:border-primary/40"
              >
                <Sparkles className="h-3 w-3" />
                DRAFT REPORT SECTION
              </Button>
            </div>
          )}

          {entryId && projectId && (
            <RelatedKnowledge entryId={entryId} projectId={projectId} />
          )}
        </div>
      </Card>
    </div>
  );
}
