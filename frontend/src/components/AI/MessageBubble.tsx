import { useState } from "react";
import {
  Bot, User, Copy, Check, SquareCode, Loader2,
  AlertTriangle, Pencil, ChevronLeft, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AttachmentPreview } from "./AttachmentPreview";
import { ProviderBadge } from "./ProviderBadge";
import { ToolCallBlock } from "./ToolCallBlock";
import type { ChatMessage } from "@/types/ai";

// ---------- helpers ----------

export function parseContent(text: string) {
  const parts: { type: "text" | "code"; content: string; language?: string }[] = [];
  const regex = /```(\w*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push({ type: "text", content: text.slice(lastIndex, match.index) });
    parts.push({ type: "code", content: match[2], language: match[1] || "bash" });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push({ type: "text", content: text.slice(lastIndex) });
  return parts;
}

function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => { navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <button onClick={handleCopy} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-slate-500 hover:text-slate-200 hover:bg-white/10 transition-colors" title="Copy message">
      {copied ? (<><Check className="h-3 w-3 text-emerald-400" /><span className="text-[9px] text-emerald-400">Copied</span></>) : (<><Copy className="h-3 w-3" /><span className="text-[9px]">Copy</span></>)}
    </button>
  );
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  return (
    <Card className="mt-4 bg-black/40 border-white/10 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-white/[0.02] border-b border-white/10">
        <div className="flex items-center gap-2">
          <SquareCode className="h-3 w-3 text-primary" />
          <span className="text-[10px] text-slate-400 font-mono tracking-wider uppercase">{language}</span>
        </div>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[10px] text-slate-500 hover:text-white" onClick={() => navigator.clipboard.writeText(code)}>
          <Copy className="h-3 w-3" /> Copy
        </Button>
      </div>
      <div className="p-4 font-mono text-xs text-emerald-400 whitespace-pre overflow-x-auto">{code}</div>
    </Card>
  );
}

// ---------- sibling nav ----------

function SiblingNav({ message, allMessages, onSwitch }: {
  message: ChatMessage;
  allMessages: ChatMessage[];
  onSwitch: (targetId: string) => void;
}) {
  const count = message.siblingCount ?? 1;
  if (count <= 1) return null;

  const siblings = allMessages.filter((m) => m.parentId === message.parentId && m.role === message.role);
  const currentIdx = siblings.findIndex((s) => s.id === message.id);

  return (
    <div className="flex items-center gap-1 text-[10px] text-slate-500">
      <button disabled={currentIdx <= 0} onClick={() => onSwitch(siblings[currentIdx - 1].id)} className="p-0.5 hover:text-slate-300 disabled:opacity-30">
        <ChevronLeft className="h-3 w-3" />
      </button>
      <span>{currentIdx + 1}/{siblings.length}</span>
      <button disabled={currentIdx >= siblings.length - 1} onClick={() => onSwitch(siblings[currentIdx + 1].id)} className="p-0.5 hover:text-slate-300 disabled:opacity-30">
        <ChevronRight className="h-3 w-3" />
      </button>
    </div>
  );
}

// ---------- message bubble ----------

export function MessageBubble({ message, allMessages, conversationId, onEdit, onSiblingSwitch }: {
  message: ChatMessage;
  allMessages: ChatMessage[];
  conversationId: string | null;
  onEdit: (messageId: string, content: string) => void;
  onSiblingSwitch: (targetId: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.content);
  const parts = parseContent(message.content);

  const handleSaveSubmit = () => {
    if (!editText.trim()) return;
    onEdit(message.id, editText.trim());
    setIsEditing(false);
  };

  return (
    <div className={cn("group flex gap-4 max-w-[90%]", message.role === "user" ? "ml-auto flex-row-reverse" : "")}>
      <div className={cn(
        "size-8 rounded-lg flex items-center justify-center shrink-0 mt-1 border",
        message.role === "assistant"
          ? "bg-primary/10 border-primary/20 text-primary shadow-[0_0_10px_rgba(163,114,248,0.1)]"
          : "bg-slate-900 border-white/10 text-slate-400"
      )}>
        {message.role === "assistant" ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
      </div>
      <div className={cn("flex flex-col gap-2 min-w-0", message.role === "user" ? "items-end" : "")}>
        <div className="flex items-center gap-2 px-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            {message.role === "assistant" ? "Pilot AI" : "Operator"}
          </span>
          {message.isStreaming && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
          {message.model && (
            <Badge className="h-4 px-1.5 text-[8px] bg-primary/10 text-primary border-primary/20 uppercase font-bold">{message.model}</Badge>
          )}
          {message.role === "assistant" && (
            <ProviderBadge
              providerName={message.provider}
              sourceMode={message.sourceMode}
            />
          )}
          <span className="text-[9px] text-slate-600 font-mono italic">{formatTime(message.timestamp)}</span>
          <SiblingNav message={message} allMessages={allMessages} onSwitch={onSiblingSwitch} />
          {message.role === "user" && !message.isStreaming && conversationId && (
            <button
              onClick={() => { setEditText(message.content); setIsEditing(true); }}
              className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-white/10 transition-all"
              title="Edit message"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
        </div>

        {isEditing ? (
          <div className="w-full space-y-2">
            <textarea
              className="w-full bg-white/[0.03] border border-white/10 rounded-xl p-3 text-sm text-slate-200 resize-none focus:outline-none focus:border-primary/50 min-h-[60px]"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSaveSubmit(); }
                if (e.key === "Escape") setIsEditing(false);
              }}
              autoFocus
            />
            <div className="flex items-center gap-2 justify-end">
              <Button variant="ghost" size="sm" className="h-7 text-xs text-slate-400" onClick={() => setIsEditing(false)}>Cancel</Button>
              <Button size="sm" className="h-7 text-xs bg-primary hover:bg-primary/90" onClick={handleSaveSubmit}>Save & Submit</Button>
            </div>
          </div>
        ) : (
          <div className={cn(
            "p-4 text-sm leading-relaxed shadow-sm",
            message.role === "assistant"
              ? "rounded-2xl rounded-tl-none bg-white/[0.03] border border-white/5 text-slate-200"
              : "rounded-2xl rounded-tr-none bg-primary text-white font-medium"
          )}>
            {message.error ? (
              <div className="flex items-center gap-2 text-red-400 text-xs">
                <AlertTriangle className="h-3 w-3 shrink-0" />{message.error}
              </div>
            ) : (
              <>
                {parts.map((part, idx) =>
                  part.type === "text"
                    ? <span key={idx} className="whitespace-pre-wrap">{part.content}</span>
                    : <CodeBlock key={idx} language={part.language!} code={part.content} />
                )}
                {message.isStreaming && message.role === "assistant" && (
                  <span className="caret-blink text-primary" aria-hidden="true" />
                )}
              </>
            )}
          </div>
        )}

        {message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2">
            {message.toolCalls
              .sort((a, b) => a.seq - b.seq)
              .map((tc) => (
                <ToolCallBlock key={tc.callId} toolCall={tc} />
              ))}
          </div>
        )}

        {message.attachments && message.attachments.length > 0 && <AttachmentPreview attachments={message.attachments} />}
        {!message.isStreaming && message.content && !isEditing && <CopyButton content={message.content} />}
      </div>
    </div>
  );
}

// ---------- branch traversal ----------

export function buildActiveBranch(messages: ChatMessage[], activeBranches: Record<string, string>): ChatMessage[] {
  if (messages.length === 0) return [];

  const hasBranching = messages.some((m) => (m.siblingCount ?? 1) > 1 || m.parentId != null);
  if (!hasBranching) return messages;

  const byParent = new Map<string, ChatMessage[]>();
  for (const m of messages) {
    const key = m.parentId ?? "__root";
    const group = byParent.get(key) ?? [];
    group.push(m);
    byParent.set(key, group);
  }

  const result: ChatMessage[] = [];
  let currentParent = "__root";

  while (true) {
    const children = byParent.get(currentParent);
    if (!children || children.length === 0) break;

    const activeId = activeBranches[currentParent];
    const active = activeId ? children.find((c) => c.id === activeId) : children[children.length - 1];
    if (!active) break;

    result.push(active);
    currentParent = active.id;
  }

  return result;
}
