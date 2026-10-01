import { useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  FileArchive,
  Flag,
  HardDrive,
  KeyRound,
  Search,
  Server,
  ShieldAlert,
  TerminalSquare,
  UserRound,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { AttackGraphNode } from "./types";

type IconType = typeof Server;

const typeIcon: Record<AttackGraphNode["type"], IconType> = {
  host: Server,
  service: HardDrive,
  credential: KeyRound,
  session: TerminalSquare,
  finding: ShieldAlert,
  loot: Flag,
  user: UserRound,
  action: Search,
  artifact: FileArchive,
};

function getSubtitle(node: AttackGraphNode): string {
  const m = node.meta;
  if (typeof m.ip === "string") return m.ip;
  if (typeof m.command === "string") return m.command;
  if (typeof m.title === "string") return m.title;
  if (typeof m.username === "string") return m.username;
  if (typeof m.path === "string") return m.path;
  return node.tags[0] ?? "";
}

function score(node: AttackGraphNode, query: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const label = node.label.toLowerCase();
  const subtitle = getSubtitle(node).toLowerCase();
  const type = node.type;
  const tags = node.tags.map((t) => t.toLowerCase());

  if (label === q) return 100;
  if (label.startsWith(q)) return 80;
  if (label.includes(q)) return 60;
  if (subtitle.includes(q)) return 50;
  if (type.includes(q)) return 40;
  if (tags.some((t) => t.includes(q))) return 30;
  return 0;
}

interface GraphSearchPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodes: AttackGraphNode[];
  onSelect: (nodeId: string) => void;
}

export function GraphSearchPalette({
  open,
  onOpenChange,
  nodes,
  onSelect,
}: GraphSearchPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setQuery("");
      setActiveIndex(0);
    }
    onOpenChange(nextOpen);
  };

  const results = useMemo(() => {
    const scored = nodes
      .map((node) => ({ node, s: score(node, query) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 20);
    return scored.map((r) => r.node);
  }, [nodes, query]);
  const activeResultIndex =
    results.length === 0 ? 0 : Math.min(activeIndex, results.length - 1);

  const commit = (index: number) => {
    const node = results[index];
    if (!node) return;
    onSelect(node.id);
    handleOpenChange(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      commit(activeResultIndex);
    }
  };

  useEffect(() => {
    const activeEl = listRef.current?.querySelector<HTMLDivElement>(
      `[data-index="${activeResultIndex}"]`
    );
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [activeResultIndex]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[25%] z-50 w-full max-w-[560px] -translate-x-1/2 overflow-hidden rounded-xl border border-[#252b3a] bg-[#121722] shadow-2xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95"
        >
          <DialogPrimitive.Title className="sr-only">
            Search attack graph
          </DialogPrimitive.Title>
          <div className="flex items-center gap-3 border-b border-[#252b3a] px-4 py-3">
            <Search className="size-4 shrink-0 text-slate-400" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search nodes by label, IP, tag, type..."
              className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
            <kbd className="hidden sm:inline-flex items-center rounded border border-[#252b3a] bg-[#0b0f17] px-1.5 py-0.5 text-[10px] font-mono text-slate-500">
              ESC
            </kbd>
          </div>

          <div
            ref={listRef}
            className="max-h-[360px] overflow-y-auto py-1"
            role="listbox"
          >
            {results.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-slate-500">
                {query ? "No matching nodes" : "Type to search graph nodes"}
              </div>
            )}
            {results.map((node, idx) => {
              const Icon = typeIcon[node.type];
              const subtitle = getSubtitle(node);
              const isActive = idx === activeResultIndex;
              return (
                <div
                  key={node.id}
                  data-index={idx}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => commit(idx)}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 px-4 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-primary/10 text-white"
                      : "text-slate-300 hover:bg-white/[0.03]"
                  )}
                >
                  <div
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded border",
                      isActive
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-[#252b3a] bg-[#0b0f17] text-slate-400"
                    )}
                  >
                    <Icon className="size-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{node.label}</span>
                      <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                        {node.type}
                      </span>
                    </div>
                    {subtitle && (
                      <div className="truncate text-[11px] text-slate-500 font-mono">
                        {subtitle}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between border-t border-[#252b3a] px-4 py-2 text-[10px] text-slate-500">
            <div className="flex items-center gap-3">
              <span>
                <kbd className="font-mono text-slate-400">↑↓</kbd> navigate
              </span>
              <span>
                <kbd className="font-mono text-slate-400">↵</kbd> open
              </span>
            </div>
            <span>{results.length} results</span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
