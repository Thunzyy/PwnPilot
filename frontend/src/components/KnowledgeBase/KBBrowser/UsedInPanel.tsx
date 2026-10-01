/**
 * UsedInPanel -- Shows timeline engagements linked to the current KB document.
 *
 * Fetches linked engagements via linkingApi and renders them as compact cards.
 * Returns null when no engagements exist (same pattern as BacklinkPanel).
 */
import { useQuery } from "@tanstack/react-query";
import { Link2 } from "lucide-react";

import { linkingApi } from "@/api/linking";
import type { LinkedEngagement } from "@/types/linking";

interface UsedInPanelProps {
  docId: string;
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function UsedInPanel({ docId }: UsedInPanelProps) {
  const engagementsQuery = useQuery<LinkedEngagement[]>({
    queryKey: ["kb", "doc-engagements", docId],
    queryFn: () => linkingApi.getDocEngagements(docId),
  });
  const engagements = engagementsQuery.data ?? [];
  const isLoading = engagementsQuery.isPending;

  if (isLoading || engagements.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-white/10 pt-3">
      <h3 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-400">
        <Link2 className="h-3.5 w-3.5" />
        Used in Engagements
        <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">
          {engagements.length}
        </span>
      </h3>
      <ul className="space-y-1">
        {engagements.map((eng) => (
          <li
            key={`${eng.timeline_entry_id}-${eng.project_id}`}
            className="rounded border border-white/5 bg-white/[0.02] px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-200">
                {eng.project_name}
              </span>
              <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {eng.entry_type}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              {truncate(eng.entry_content, 80)}
            </p>
            <span className="text-[10px] text-slate-500">
              {formatDate(eng.created_at)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
