/**
 * KBSearchOptionsPanel -- Displays 6 filter prefix options as clickable items.
 * Appears when the search input is focused and empty.
 * onMouseDown preventDefault on every clickable element prevents blur-before-click.
 */

const SEARCH_OPTIONS = [
  { prefix: "path:", description: "Match file path" },
  { prefix: "file:", description: "Match file name" },
  { prefix: "tag:", description: "Match tag" },
  { prefix: "line:", description: "Match within same line" },
  { prefix: "section:", description: "Match under same heading" },
  { prefix: "[property]", description: "Match frontmatter property" },
] as const;

interface KBSearchOptionsPanelProps {
  onSelectPrefix: (prefix: string) => void;
}

export function KBSearchOptionsPanel({ onSelectPrefix }: KBSearchOptionsPanelProps) {
  return (
    <div className="px-3 py-2">
      <h3 className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-600">
        Search options
      </h3>
      <ul className="space-y-0.5">
        {SEARCH_OPTIONS.map((opt) => (
          <li key={opt.prefix}>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-white/5"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSelectPrefix(opt.prefix)}
            >
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-primary">
                {opt.prefix}
              </span>
              <span className="text-xs text-slate-400">{opt.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
