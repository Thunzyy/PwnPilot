import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  Copy,
  Download,
  FileJson,
  FileText,
  Loader2,
  TerminalSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { aiApi } from "@/api/ai";
import type { ConversationExport, ConversationExportFormat } from "@/types/ai";

const EXPORT_OPTIONS: Array<{
  value: ConversationExportFormat;
  label: string;
  description: string;
}> = [
  {
    value: "markdown",
    label: "Markdown",
    description: "Human-readable transcript for notes or sharing.",
  },
  {
    value: "json",
    label: "JSON",
    description: "Native structured export for automation.",
  },
  {
    value: "claude",
    label: "Claude",
    description: "Markdown transcript plus a Claude CLI resume command.",
  },
  {
    value: "codex",
    label: "Codex",
    description: "Prompt-ready transcript for the Codex CLI.",
  },
  {
    value: "gemini",
    label: "Gemini",
    description: "Prompt export tailored for Gemini CLI.",
  },
  {
    value: "aider",
    label: "Aider",
    description: "History export for `aider --restore-chat-history`.",
  },
];

interface ChatExportDialogProps {
  conversationId: string;
  title: string;
  trigger?: ReactNode;
}

export function ChatExportDialog({
  conversationId,
  title,
  trigger,
}: ChatExportDialogProps) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ConversationExportFormat>("markdown");
  const [payload, setPayload] = useState<ConversationExport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    const loadExport = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await aiApi.exportConversation(conversationId, format);
        if (!cancelled) {
          setPayload(result);
        }
      } catch {
        if (!cancelled) {
          setPayload(null);
          setError("Failed to export this conversation.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadExport();

    return () => {
      cancelled = true;
    };
  }, [conversationId, format, open]);

  const selectedOption = useMemo(
    () => EXPORT_OPTIONS.find((option) => option.value === format) ?? EXPORT_OPTIONS[0],
    [format],
  );

  const handleCopy = async (value: string | null | undefined) => {
    if (!value || !navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(value);
  };

  const handleDownload = () => {
    if (!payload) return;

    const blob = new Blob([payload.content], {
      type: payload.format === "json" ? "application/json" : "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = payload.filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const triggerNode = trigger ?? (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 px-3 text-xs text-slate-300 border border-white/10 bg-white/5 hover:bg-white/10"
    >
      <Download className="h-3 w-3" />
      Export
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{triggerNode}</DialogTrigger>
      <DialogContent className="max-w-4xl bg-[#121722] border-white/10 text-slate-200">
        <DialogHeader>
          <DialogTitle className="text-white">Export conversation</DialogTitle>
          <DialogDescription className="text-slate-400">
            Generate a reusable transcript for <span className="text-slate-200">{title}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2 md:grid-cols-3">
            {EXPORT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFormat(option.value)}
                className={cn(
                  "rounded-xl border px-3 py-3 text-left transition-colors",
                  format === option.value
                    ? "border-primary/50 bg-primary/10 text-white"
                    : "border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]",
                )}
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  {option.value === "json" ? (
                    <FileJson className="h-4 w-4" />
                  ) : option.value === "markdown" ? (
                    <FileText className="h-4 w-4" />
                  ) : (
                    <TerminalSquare className="h-4 w-4" />
                  )}
                  {option.label}
                </div>
                <p className="mt-1 text-xs text-slate-400">{option.description}</p>
              </button>
            ))}
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-white">{selectedOption.label} export</p>
                <p className="text-xs text-slate-400">{selectedOption.description}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                  onClick={handleDownload}
                  disabled={!payload}
                >
                  <Download className="h-3 w-3" />
                  Download
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                  onClick={() => void handleCopy(payload?.content)}
                  disabled={!payload?.content}
                >
                  <Copy className="h-3 w-3" />
                  Copy content
                </Button>
              </div>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="grid gap-1 text-xs text-slate-400">
                Filename
                <input
                  readOnly
                  value={payload?.filename ?? ""}
                  className="h-9 rounded-md border border-white/10 bg-[#0b0f17] px-3 text-sm text-slate-200"
                />
              </label>

              {isLoading ? (
                <div className="flex min-h-[240px] items-center justify-center rounded-xl border border-dashed border-white/10 bg-[#0b0f17] text-sm text-slate-400">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Building export...
                </div>
              ) : error ? (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-6 text-sm text-red-200">
                  {error}
                </div>
              ) : (
                <label className="grid gap-1 text-xs text-slate-400">
                  Content preview
                  <textarea
                    readOnly
                    value={payload?.content ?? ""}
                    className="min-h-[260px] rounded-xl border border-white/10 bg-[#0b0f17] px-3 py-3 font-mono text-xs text-slate-200"
                  />
                </label>
              )}

              {payload?.resume_command ? (
                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-slate-400">Resume command</p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-[11px] text-slate-300 hover:bg-white/10"
                      onClick={() => void handleCopy(payload.resume_command)}
                    >
                      <Copy className="h-3 w-3" />
                      Copy command
                    </Button>
                  </div>
                  <code className="rounded-xl border border-white/10 bg-[#0b0f17] px-3 py-3 font-mono text-xs text-slate-200">
                    {payload.resume_command}
                  </code>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
