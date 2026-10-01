/**
 * KBSearchResultItem -- A single search result row in the dropdown.
 *
 * Renders document title, DOMPurify-sanitized snippet with <mark> highlights,
 * source badge, and file path. Supports keyboard active state via
 * aria-selected and visual bg highlight.
 */
import DOMPurify from "dompurify";
import { FileText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { KBSearchResult } from "@/types/kb";

import "./search.css";

interface KBSearchResultItemProps {
  result: KBSearchResult;
  sourceName: string;
  isActive: boolean;
  onSelect: (result: KBSearchResult) => void;
  id?: string;
}

export function KBSearchResultItem({
  result,
  sourceName,
  isActive,
  onSelect,
  id,
}: KBSearchResultItemProps) {
  const sanitizedSnippet = DOMPurify.sanitize(result.snippet, {
    ALLOWED_TAGS: ["mark"],
  });

  return (
    <div
      id={id}
      role="option"
      aria-selected={isActive}
      data-kb-result-path={result.relative_path}
      className={`cursor-pointer overflow-hidden border-b border-white/5 px-3 py-2 last:border-0 ${
        isActive ? "bg-white/5" : "hover:bg-white/5"
      }`}
      onClick={() => onSelect(result)}
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* Title + source badge */}
      <div className="flex min-w-0 items-center gap-2">
        <FileText className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        <span className="min-w-0 truncate text-sm font-medium text-slate-200">
          {result.title}
        </span>
        <Badge
          variant="secondary"
          className="shrink-0 px-1.5 py-0 text-[10px]"
        >
          {sourceName}
        </Badge>
      </div>

      {/* Snippet with highlighted matches */}
      <p
        className="search-snippet mt-1 line-clamp-2 pl-5.5 text-xs text-slate-400"
        dangerouslySetInnerHTML={{ __html: sanitizedSnippet }}
      />

      {/* File path */}
      <span className="mt-0.5 block truncate pl-5.5 text-[10px] text-slate-600">
        {result.relative_path}
      </span>
    </div>
  );
}
