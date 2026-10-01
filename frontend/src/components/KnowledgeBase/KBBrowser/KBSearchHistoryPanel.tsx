/**
 * KBSearchHistoryPanel -- Displays recent searches with remove and clear actions.
 * Appears below KBSearchOptionsPanel when the search input is focused and empty.
 * onMouseDown preventDefault on every clickable element prevents blur-before-click.
 */
import { Clock, X } from "lucide-react";

interface KBSearchHistoryPanelProps {
  recentSearches: string[];
  onSelectRecent: (query: string) => void;
  onRemoveRecent: (query: string) => void;
  onClearAll: () => void;
}

export function KBSearchHistoryPanel({
  recentSearches,
  onSelectRecent,
  onRemoveRecent,
  onClearAll,
}: KBSearchHistoryPanelProps) {
  if (recentSearches.length === 0) return null;

  return (
    <div className="px-3 py-2">
      {/* Header row */}
      <div className="flex items-center justify-between px-2 pb-1.5">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-600">
          History
        </h3>
        <button
          type="button"
          className="text-[10px] text-slate-500 hover:text-slate-300"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClearAll}
        >
          Clear all
        </button>
      </div>

      {/* Recent search list */}
      <ul className="space-y-0.5">
        {recentSearches.map((q) => (
          <li key={q}>
            <div className="group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-white/5">
              <Clock className="h-3.5 w-3.5 shrink-0 text-slate-500" />
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-sm text-slate-300"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelectRecent(q)}
              >
                {q}
              </button>
              <button
                type="button"
                className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 text-slate-500 hover:text-slate-300"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onRemoveRecent(q)}
                aria-label={`Remove "${q}" from history`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
