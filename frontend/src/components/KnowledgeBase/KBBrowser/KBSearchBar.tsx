/**
 * KBSearchBar -- Live search bar driving the full-sidebar search overlay.
 *
 * Orchestrates: input -> useDebounce -> kbApi.search -> store (overlay reads store).
 * Race conditions prevented via requestIdRef counter.
 * Escape clears search and returns to tree view.
 *
 * Toggle buttons:
 *   - "Aa" toggles case-sensitive client-side filtering
 *   - Filter icon toggles the search options/history panel visibility
 *
 * pendingPrefix: External components can set a prefix (e.g. "path:") that
 * this bar picks up, writes into the query, focuses, and clears.
 */
import { useCallback, useEffect, useRef } from "react";
import { Filter, Search, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { useKBStore } from "@/stores/kbStore";
import { kbApi } from "@/api/kb";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface KBSearchBarProps {
  sourceId?: string;
  onSelectResult: (
    docId: string,
    sourceId: string,
    title: string,
    openInNewTab?: boolean
  ) => void;
}

export function KBSearchBar({ sourceId }: KBSearchBarProps) {
  // Store selectors (fine-grained)
  const query = useKBStore((s) => s.searchQuery);
  const setSearchResults = useKBStore((s) => s.setSearchResults);
  const setSearchQuery = useKBStore((s) => s.setSearchQuery);
  const addRecentSearch = useKBStore((s) => s.addRecentSearch);
  const searchSortBy = useKBStore((s) => s.searchSortBy);
  const searchSortDir = useKBStore((s) => s.searchSortDir);

  // Toggle state
  const caseSensitive = useKBStore((s) => s.caseSensitive);
  const toggleCaseSensitive = useKBStore((s) => s.toggleCaseSensitive);
  const showSearchOptions = useKBStore((s) => s.showSearchOptions);
  const toggleShowSearchOptions = useKBStore((s) => s.toggleShowSearchOptions);

  // Focus state
  const setSearchInputFocused = useKBStore((s) => s.setSearchInputFocused);

  // Pending prefix for external prefix insertion
  const pendingPrefix = useKBStore((s) => s.pendingPrefix);
  const setPendingPrefix = useKBStore((s) => s.setPendingPrefix);

  // "Go to file" focus trigger from store
  const searchFocusRequested = useKBStore((s) => s.searchFocusRequested);

  // Refs
  const inputRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef(0);

  // Focus search input when requested from elsewhere (Ctrl+O or new tab page)
  useEffect(() => {
    if (searchFocusRequested) {
      inputRef.current?.focus();
      useKBStore.setState({ searchFocusRequested: false });
    }
  }, [searchFocusRequested]);

  // Pending prefix effect: when an external component sets a prefix,
  // write it into the query, focus the input, and clear it.
  useEffect(() => {
    if (pendingPrefix) {
      setSearchQuery(pendingPrefix);
      setPendingPrefix(null);
      inputRef.current?.focus();
      requestAnimationFrame(() => {
        const len = pendingPrefix.length;
        inputRef.current?.setSelectionRange(len, len);
      });
    }
  }, [pendingPrefix, setPendingPrefix, setSearchQuery]);

  // Debounce
  const debouncedQuery = useDebounce(query, 300);

  // Search effect: fires on debounced query or sort changes
  useEffect(() => {
    const trimmed = debouncedQuery.trim();

    if (!trimmed) {
      setSearchResults([]);
      setSearchQuery("");
      useKBStore.setState({ isSearching: false });
      useKBStore.getState().setSearchSortBy(useKBStore.getState().searchSortBy);
      return;
    }

    const currentId = ++requestIdRef.current;
    useKBStore.setState({ isSearching: true });

    kbApi
      .search(trimmed, sourceId || undefined, 100, searchSortBy, searchSortDir)
      .then((response) => {
        // Only apply if this is the latest request (race condition guard)
        if (currentId === requestIdRef.current) {
          setSearchResults(response.items, response.total);
          setSearchQuery(trimmed);
          addRecentSearch(trimmed);
          useKBStore.setState({ isSearching: false });
        }
      })
      .catch(() => {
        if (currentId === requestIdRef.current) {
          useKBStore.setState({ isSearching: false });
        }
      });
  }, [
    addRecentSearch,
    debouncedQuery,
    searchSortBy,
    searchSortDir,
    setSearchQuery,
    setSearchResults,
    sourceId,
  ]);

  // Keyboard: Escape clears search and returns to tree
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setSearchQuery("");
        setSearchResults([]);
        inputRef.current?.blur();
      }
    },
    [setSearchQuery, setSearchResults]
  );

  return (
    <div className="px-2 py-2">
      <div className="flex items-center gap-1">
        {/* Search input wrapper */}
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            ref={inputRef}
            type="text"
            role="searchbox"
            aria-label="Search knowledge base"
            placeholder="Search all sources..."
            className="w-full rounded-md border border-white/10 bg-white/5 py-1.5 pl-8 pr-8 text-sm text-slate-200 placeholder:text-slate-500 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
            value={query}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setSearchInputFocused(true)}
            onBlur={() => {
              setTimeout(() => setSearchInputFocused(false), 150);
            }}
          />

          {/* Clear button */}
          {query && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              onClick={() => {
                setSearchQuery("");
                setSearchResults([]);
                inputRef.current?.focus();
              }}
              onMouseDown={(e) => e.preventDefault()}
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Toggle buttons */}
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-pressed={caseSensitive}
                aria-label="Match case"
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded text-xs font-semibold transition-colors",
                  caseSensitive
                    ? "bg-primary/20 text-primary"
                    : "text-slate-500 hover:text-slate-300"
                )}
                onClick={() => toggleCaseSensitive()}
              >
                Aa
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Match case</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-pressed={showSearchOptions}
                aria-label="Toggle search options"
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded transition-colors",
                  showSearchOptions
                    ? "bg-primary/20 text-primary"
                    : "text-slate-500 hover:text-slate-300"
                )}
                onClick={() => toggleShowSearchOptions()}
              >
                <Filter className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Toggle search options</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
