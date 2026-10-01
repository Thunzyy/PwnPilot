import { MessageSquare, Bot } from "lucide-react";
import { cn } from "@/lib/utils";

type Mode = "question" | "agent";

interface ModeToggleProps {
  mode: Mode;
  onChange: (mode: Mode) => void;
}

export function ModeToggle({ mode, onChange }: ModeToggleProps) {
  return (
    <div className="flex items-center rounded-lg border border-white/10 bg-white/[0.02] p-0.5">
      <button
        type="button"
        onClick={() => onChange("question")}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
          mode === "question"
            ? "bg-white/10 text-slate-200 shadow-sm"
            : "text-slate-500 hover:text-slate-400",
        )}
      >
        <MessageSquare className="h-3 w-3" />
        Question
      </button>
      <button
        type="button"
        onClick={() => onChange("agent")}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
          mode === "agent"
            ? "bg-primary/20 text-primary shadow-sm"
            : "text-slate-500 hover:text-slate-400",
        )}
      >
        <Bot className="h-3 w-3" />
        Agent
      </button>
    </div>
  );
}
