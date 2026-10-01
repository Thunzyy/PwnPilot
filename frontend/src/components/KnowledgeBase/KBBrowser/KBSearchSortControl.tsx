/**
 * KBSearchSortControl -- Dropdown sort control for the search overlay.
 *
 * Lets the user pick a sort field (relevance, filename, modified, created)
 * and a direction (ascending / descending).  Changing the sort field
 * resets direction to its natural default.
 */
import { ArrowDown, ArrowUp } from "lucide-react";

import { useKBStore } from "@/stores/kbStore";
import type { SearchSortBy, SearchSortDir } from "@/types/kb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const SORT_OPTIONS: { value: SearchSortBy; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "filename", label: "Filename" },
  { value: "modified", label: "Modified" },
  { value: "created", label: "Created" },
];

export function KBSearchSortControl() {
  const searchSortBy = useKBStore((s) => s.searchSortBy);
  const searchSortDir = useKBStore((s) => s.searchSortDir);
  const setSearchSortBy = useKBStore((s) => s.setSearchSortBy);
  const setSearchSortDir = useKBStore((s) => s.setSearchSortDir);

  const currentLabel =
    SORT_OPTIONS.find((o) => o.value === searchSortBy)?.label ?? "Relevance";
  const DirIcon = searchSortDir === "asc" ? ArrowUp : ArrowDown;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-white/5 hover:text-slate-300"
          aria-label={`Sort: ${currentLabel}, ${searchSortDir === "asc" ? "ascending" : "descending"}`}
        >
          <DirIcon className="h-3 w-3" />
          <span>{currentLabel}</span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="w-40 border-white/10 bg-[#121722]"
      >
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-slate-500">
          Sort by
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={searchSortBy}
          onValueChange={(v) => setSearchSortBy(v as SearchSortBy)}
        >
          {SORT_OPTIONS.map((opt) => (
            <DropdownMenuRadioItem
              key={opt.value}
              value={opt.value}
              className="text-xs text-slate-300 focus:bg-white/10 focus:text-slate-100"
            >
              {opt.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator className="bg-white/5" />

        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-slate-500">
          Direction
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={searchSortDir}
          onValueChange={(v) => setSearchSortDir(v as SearchSortDir)}
        >
          <DropdownMenuRadioItem
            value="asc"
            className="text-xs text-slate-300 focus:bg-white/10 focus:text-slate-100"
          >
            Ascending
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            value="desc"
            className="text-xs text-slate-300 focus:bg-white/10 focus:text-slate-100"
          >
            Descending
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
