/**
 * TagFilter -- Displays the active tag with a clear button.
 *
 * Returns null when no tag is active. Shows a pill-style tag indicator
 * with an X button to clear the filter.
 */
import { Tag, X } from "lucide-react";

interface TagFilterProps {
  activeTag: string | null;
  onClearTag: () => void;
}

export function TagFilter({ activeTag, onClearTag }: TagFilterProps) {
  if (activeTag === null) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 rounded border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm">
      <Tag className="h-3.5 w-3.5 text-slate-400" />
      <span className="text-slate-400">Filtered by tag:</span>
      <span className="rounded bg-primary/20 px-2 py-0.5 text-xs font-medium text-primary">
        {activeTag}
      </span>
      <button
        type="button"
        onClick={onClearTag}
        className="ml-auto rounded p-0.5 text-slate-500 hover:bg-white/10 hover:text-slate-300 cursor-pointer"
        aria-label={`Clear tag filter: ${activeTag}`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
