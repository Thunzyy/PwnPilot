import { Plus, X, Copy, ChevronDown, ExternalLink, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useTerminalStore } from "@/stores/terminalStore";

interface TerminalTabsProps {
  projectId?: string;
}

export function TerminalTabs({ projectId }: TerminalTabsProps) {
  const {
    sessions,
    activeSessionId,
    capabilities,
    createSession,
    closeSession,
    setActiveSession,
    duplicateSession,
    detachSession,
    renameSession,
  } = useTerminalStore();

  const canCreateSession = capabilities?.canCreateSession ?? true;
  const canDetach = capabilities?.canDetach ?? true;
  const detachUnavailableReason =
    capabilities?.reasonUnavailable ?? "Detach is unavailable";

  const handleNewTab = async () => {
    if (!canCreateSession) return;
    await createSession(`Terminal ${sessions.length + 1}`, projectId);
  };

  const handleDuplicate = async (id: string) => {
    await duplicateSession(id);
  };

  const handleDetach = async (id: string) => {
    if (!canDetach) return;
    await detachSession(id);
  };

  const handleRename = async (id: string, currentName: string) => {
    const newName = window.prompt("Rename terminal", currentName);
    if (!newName) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === currentName) return;
    await renameSession(id, trimmed);
  };

  return (
    <div className="h-9 bg-black/60 border-b border-white/5 flex items-center gap-0.5 px-2 overflow-x-auto shrink-0">
      {sessions.map((session) => (
        <div
          key={session.id}
          className={cn(
            "group flex items-center gap-1.5 h-7 px-2 rounded-t text-xs font-medium cursor-pointer transition-colors",
            session.id === activeSessionId
              ? "bg-[#0b0f17] text-white border-t border-x border-white/10"
              : "text-slate-500 hover:text-slate-300 hover:bg-white/5"
          )}
          onClick={() => setActiveSession(session.id)}
        >
          <div
            className={cn(
              "size-1.5 rounded-full",
              session.isAlive ? "bg-emerald-500" : "bg-red-500"
            )}
          />

          <span className="max-w-[120px] truncate">{session.name}</span>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-4 w-4 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-white"
                onClick={(e) => e.stopPropagation()}
              >
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-40 bg-bg-secondary text-text-primary border border-border shadow-lg"
            >
              <DropdownMenuItem onClick={() => handleDuplicate(session.id)}>
                <Copy className="h-3 w-3 mr-2" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleRename(session.id, session.name)}>
                <Pencil className="h-3 w-3 mr-2" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleDetach(session.id)}
                disabled={!canDetach}
                title={!canDetach ? detachUnavailableReason : undefined}
              >
                <ExternalLink className="h-3 w-3 mr-2" />
                Detach to Native
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => closeSession(session.id)}
                className="text-red-400 focus:text-red-400"
              >
                <X className="h-3 w-3 mr-2" />
                Close
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="icon"
            className="h-4 w-4 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400"
            onClick={(e) => {
              e.stopPropagation();
              closeSession(session.id);
            }}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-slate-500 hover:text-primary shrink-0"
        onClick={handleNewTab}
        disabled={!canCreateSession}
        title="New terminal"
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}
