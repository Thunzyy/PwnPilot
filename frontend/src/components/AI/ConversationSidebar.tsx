import { useEffect, useState, useRef, type KeyboardEvent } from "react";
import { SquarePen, MoreHorizontal, Pencil, Trash2, MessageSquare, Pin, PinOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chatStore";
import type { ConversationSummary } from "@/types/ai";

function groupByDate(conversations: ConversationSummary[]) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);
  const groups: { label: string; items: ConversationSummary[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 Days", items: [] },
    { label: "Older", items: [] },
  ];
  for (const conv of conversations) {
    const d = new Date(conv.updated_at);
    if (d >= today) groups[0].items.push(conv);
    else if (d >= yesterday) groups[1].items.push(conv);
    else if (d >= weekAgo) groups[2].items.push(conv);
    else groups[3].items.push(conv);
  }
  return groups.filter((g) => g.items.length > 0);
}

interface ConversationSidebarProps {
  projectId: string | null;
}

export function ConversationSidebar({ projectId }: ConversationSidebarProps) {
  const {
    conversations, activeConversationId, isTempChat, fetchConversations,
    createConversation, deleteConversation, renameConversation,
    pinConversation, setActive, startTempChat,
  } = useChatStore();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { fetchConversations(projectId); }, [projectId, fetchConversations]);
  useEffect(() => { if (renamingId && renameRef.current) renameRef.current.focus(); }, [renamingId]);

  const handleNew = async () => { await createConversation(projectId); };

  const startRename = (conv: ConversationSummary) => {
    setRenamingId(conv.id);
    setRenameValue(conv.title);
  };

  const commitRename = () => {
    if (renamingId && renameValue.trim()) renameConversation(renamingId, renameValue.trim());
    setRenamingId(null);
  };

  const handleRenameKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commitRename();
    if (e.key === "Escape") setRenamingId(null);
  };

  const pinnedConvs = conversations.filter((c) => c.pinned);
  const unpinnedConvs = conversations.filter((c) => !c.pinned);
  const groups = groupByDate(unpinnedConvs);

  const renderRow = (conv: ConversationSummary) => {
    const isActive = conv.id === activeConversationId;
    const isRenaming = conv.id === renamingId;
    return (
      <div
        key={conv.id}
        onClick={() => !isRenaming && setActive(conv.id)}
        className={cn(
          "group flex items-center gap-1 px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors",
          isActive
            ? "bg-primary/10 border border-primary/20 text-white"
            : "text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent"
        )}
      >
        {isRenaming ? (
          <Input
            ref={renameRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleRenameKey}
            className="h-6 text-xs bg-white/5 border-white/10 px-2 py-0 min-w-0 flex-1"
          />
        ) : (
          <span className="truncate min-w-0 flex-1" title={conv.title}>{conv.title}</span>
        )}
        {!isRenaming && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "shrink-0 p-0.5 rounded hover:bg-white/10 transition-opacity",
                  isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                )}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" className="w-36 bg-surface border-border">
              <DropdownMenuItem onClick={() => pinConversation(conv.id, !conv.pinned)}>
                {conv.pinned
                  ? <><PinOff className="h-3.5 w-3.5 mr-2" /> Unpin</>
                  : <><Pin className="h-3.5 w-3.5 mr-2" /> Pin</>}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => startRename(conv)}>
                <Pencil className="h-3.5 w-3.5 mr-2" /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-red-400 focus:text-red-400"
                onClick={() => deleteConversation(conv.id)}
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    );
  };

  const hasContent = pinnedConvs.length > 0 || groups.length > 0;

  return (
    <div className="flex flex-col h-full bg-[#0b0f17] border-r border-white/5">
      <div className="flex items-center gap-2 px-3 py-3 border-b border-white/5">
        <button
          onClick={handleNew}
          className="flex items-center gap-2 flex-1 min-w-0 px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-white/5 transition-colors"
        >
          <SquarePen className="h-4 w-4 shrink-0" />
          <span className="truncate">New Chat</span>
        </button>
        <button
          onClick={startTempChat}
          title="Temporary chat (no history saved)"
          className={cn(
            "shrink-0 size-9 flex items-center justify-center rounded-lg border border-dashed transition-colors",
            isTempChat
              ? "border-primary/50 bg-primary/10 text-primary"
              : "border-white/20 text-slate-400 hover:bg-white/5 hover:text-slate-200"
          )}
        >
          <MessageSquare className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
        {!hasContent ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-500">
            <MessageSquare className="h-8 w-8 mb-3 opacity-20" />
            <p className="text-xs font-medium">No conversations yet</p>
          </div>
        ) : (
          <div className="px-2 pb-3">
            {pinnedConvs.length > 0 && (
              <div className="mt-2">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold px-3 py-2 flex items-center gap-1">
                  <Pin className="h-2.5 w-2.5" /> Pinned
                </p>
                {pinnedConvs.map(renderRow)}
              </div>
            )}
            {groups.map((group) => (
              <div key={group.label} className="mt-2">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold px-3 py-2">
                  {group.label}
                </p>
                {group.items.map(renderRow)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
