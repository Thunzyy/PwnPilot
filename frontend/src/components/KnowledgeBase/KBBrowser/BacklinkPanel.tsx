/**
 * BacklinkPanel -- Renders a list of documents linking to the current doc.
 *
 * Shows a count badge header, clickable backlink entries, and collapsible
 * context snippets showing the line containing each [[wikilink]] reference.
 * Returns null when there are no backlinks.
 */
import { useState } from "react";

import { ArrowUpLeft, ChevronDown, ChevronRight } from "lucide-react";

import type { KBBacklink } from "@/types/kb";

interface BacklinkPanelProps {
  backlinks: KBBacklink[];
  onNavigate: (docId: string) => void;
}

export function BacklinkPanel({ backlinks, onNavigate }: BacklinkPanelProps) {
  const [showContext, setShowContext] = useState(true);

  if (backlinks.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-white/10 pt-3">
      <h3 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-400">
        <ArrowUpLeft className="h-3.5 w-3.5" />
        Backlinks
        <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">
          {backlinks.length}
        </span>
        <button
          type="button"
          onClick={() => setShowContext(!showContext)}
          className="ml-auto rounded p-0.5 text-slate-500 hover:text-slate-300 hover:bg-white/10"
          aria-label={showContext ? "Hide context" : "Show context"}
        >
          {showContext ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </button>
      </h3>
      <ul className="space-y-0.5">
        {backlinks.map((bl) => (
          <li key={bl.id}>
            <button
              type="button"
              onClick={() => onNavigate(bl.id)}
              className="flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left hover:bg-white/[0.05] cursor-pointer"
            >
              <span className="text-sm text-slate-200 truncate">
                {bl.title}
              </span>
              <span className="text-xs text-slate-500 truncate">
                {bl.relative_path}
              </span>
            </button>
            {showContext && bl.context_line && (
              <p className="px-2 pb-1 text-xs text-slate-500 italic truncate">
                {bl.context_line}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
