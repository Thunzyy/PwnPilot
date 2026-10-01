/**
 * KBSearchGroup -- Collapsible group for one source's search results.
 *
 * Uses Radix Collapsible for expand/collapse, matching the SourceTreeRoot
 * pattern in KBSidebar. Renders KBSearchResultItem for each result.
 */
import { useState } from "react";
import { ChevronRight, FolderGit2 } from "lucide-react";
import * as Collapsible from "@radix-ui/react-collapsible";

import { cn } from "@/lib/utils";
import type { KBSearchResult } from "@/types/kb";

import { KBSearchResultItem } from "./KBSearchResultItem";

interface KBSearchGroupProps {
  sourceName: string;
  results: KBSearchResult[];
  onSelectResult: (
    docId: string,
    sourceId: string,
    title: string,
    openInNewTab?: boolean,
  ) => void;
}

export function KBSearchGroup({
  sourceName,
  results,
  onSelectResult,
}: KBSearchGroupProps) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <Collapsible.Root open={isOpen} onOpenChange={setIsOpen}>
      <Collapsible.Trigger
        className={cn(
          "flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-sm",
          "text-slate-300 hover:bg-white/[0.05] hover:text-slate-100",
          "cursor-pointer select-none",
        )}
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform duration-150",
            isOpen && "rotate-90",
          )}
        />
        <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-primary/70" />
        <span className="flex-1 truncate text-left">{sourceName}</span>
        <span className="text-[10px] text-slate-500">{results.length}</span>
      </Collapsible.Trigger>

      <Collapsible.Content className="pl-2">
        {results.map((result) => (
          <KBSearchResultItem
            key={result.id}
            result={result}
            sourceName={sourceName}
            isActive={false}
            onSelect={(r) =>
              onSelectResult(r.id, r.source_id, r.title)
            }
          />
        ))}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
