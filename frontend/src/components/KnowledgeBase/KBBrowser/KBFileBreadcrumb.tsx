/**
 * KBFileBreadcrumb -- File path breadcrumb showing source > folders > filename.
 *
 * Display-only breadcrumb (not clickable). Handles deeply nested paths
 * with overflow-x-auto and truncation per segment.
 */
import { ChevronRight } from "lucide-react";

import type { KBDocDetail } from "@/types/kb";

interface KBFileBreadcrumbProps {
  doc: KBDocDetail;
}

export function KBFileBreadcrumb({ doc }: KBFileBreadcrumbProps) {
  const sourceName = doc.source?.name ?? "Source";
  const pathParts = doc.relative_path
    .split("/")
    .filter((part) => part.length > 0);
  const segments = [sourceName, ...pathParts];

  return (
    <nav
      aria-label="File path"
      className="flex min-w-0 items-center gap-1 overflow-x-auto text-sm whitespace-nowrap"
    >
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;
        return (
          <span key={`${index}-${segment}`} className="flex shrink-0 items-center gap-1">
            {index > 0 && (
              <ChevronRight className="h-3 w-3 text-slate-600" />
            )}
            <span
              className={
                isLast
                  ? "max-w-[200px] truncate text-slate-200"
                  : "max-w-[120px] truncate text-slate-500"
              }
              title={segment}
            >
              {segment}
            </span>
          </span>
        );
      })}
    </nav>
  );
}
