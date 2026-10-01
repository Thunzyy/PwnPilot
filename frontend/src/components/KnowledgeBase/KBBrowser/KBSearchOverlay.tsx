/**
 * KBSearchOverlay -- Full-sidebar search overlay replacing the tree view.
 *
 * Renders a header with total count + sort control, then grouped results
 * per source via KBSearchGroup. Shows a loading spinner or empty state
 * when appropriate.
 */
import { useMemo } from "react";
import { Loader2, Search } from "lucide-react";

import { useKBStore } from "@/stores/kbStore";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { KBSearchResult } from "@/types/kb";

import { KBSearchGroup } from "./KBSearchGroup";
import { KBSearchSortControl } from "./KBSearchSortControl";

interface KBSearchOverlayProps {
  onSelectResult: (
    docId: string,
    sourceId: string,
    title: string,
    openInNewTab?: boolean,
  ) => void;
}

export function KBSearchOverlay({ onSelectResult }: KBSearchOverlayProps) {
  const searchResults = useKBStore((s) => s.searchResults);
  const searchTotal = useKBStore((s) => s.searchTotal);
  const isSearching = useKBStore((s) => s.isSearching);
  const sources = useKBStore((s) => s.sources);

  // Map sourceId -> sourceName for display
  const sourceLookup = useMemo(
    () => new Map(sources.map((s) => [s.id, s.name])),
    [sources],
  );

  // Group results by source_id
  const grouped = useMemo(() => {
    const groups = new Map<string, KBSearchResult[]>();
    for (const result of searchResults) {
      const list = groups.get(result.source_id);
      if (list) {
        list.push(result);
      } else {
        groups.set(result.source_id, [result]);
      }
    }
    return groups;
  }, [searchResults]);

  // Build count label
  const countLabel = (() => {
    if (searchTotal > searchResults.length) {
      return `Showing ${searchResults.length} of ${searchTotal}`;
    }
    const n = searchTotal || searchResults.length;
    return `${n} result${n !== 1 ? "s" : ""}`;
  })();

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-1.5">
        <span className="text-xs text-slate-400">{countLabel}</span>
        <KBSearchSortControl />
      </div>

      {/* Results area */}
      {isSearching ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
        </div>
      ) : searchResults.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-slate-500">
          <Search className="h-5 w-5" />
          <span className="text-sm">No results found</span>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="px-1.5 py-1">
            {[...grouped.entries()].map(([sourceId, results]) => (
              <KBSearchGroup
                key={sourceId}
                sourceName={sourceLookup.get(sourceId) ?? "Unknown"}
                results={results}
                onSelectResult={onSelectResult}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
