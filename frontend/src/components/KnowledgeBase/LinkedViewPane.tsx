/**
 * LinkedViewPane -- Shows backlinks and outlinks for the source pane's
 * active document.
 *
 * Auto-updates when the source pane's activeDocId changes.
 * Clicking a backlink navigates in the source pane.
 * Outlinks are displayed as a read-only list (navigation deferred).
 */
import { ArrowRight, FileText, Link2, X } from "lucide-react";

import { useKBStore } from "@/stores/kbStore";
import { usePaneId } from "./PaneContext";
import { Button } from "@/components/ui/button";

export function LinkedViewPane() {
  const paneId = usePaneId();
  const pane = useKBStore((s) => s.panes[paneId]);
  const linkedToPaneId = pane?.linkedToPaneId;

  // Track source pane's active document -- re-renders when source doc changes
  const sourceDocId = useKBStore((s) =>
    linkedToPaneId ? (s.panes[linkedToPaneId]?.activeDocId ?? null) : null,
  );
  const sourceDoc = useKBStore((s) =>
    sourceDocId ? (s.docCache[sourceDocId] ?? null) : null,
  );

  const closePane = useKBStore((s) => s.closePane);
  const navigateInSource = useKBStore((s) => s.openTabInPane);

  const backlinks = sourceDoc?.backlinks ?? [];

  const outlinks = sourceDoc?.wikilinks
    ? sourceDoc.wikilinks.map((w) => ({
        target: (w as { target?: string }).target ?? String(w),
      }))
    : [];

  if (!sourceDocId || !sourceDoc) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-9 items-center justify-between border-b border-white/5 bg-black/40 px-3">
          <span className="text-xs font-medium text-slate-400">
            Linked View
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => closePane(paneId)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
        <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
          No document selected in source pane
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex h-9 items-center justify-between border-b border-white/5 bg-black/40 px-3">
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400 min-w-0">
          <Link2 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Links: {sourceDoc.title}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-slate-500 hover:text-slate-300"
          onClick={() => closePane(paneId)}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Backlinks section */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
            Backlinks ({backlinks.length})
          </h3>
          {backlinks.length === 0 ? (
            <p className="text-xs text-slate-600">No backlinks found</p>
          ) : (
            <ul className="space-y-1">
              {backlinks.map((bl) => (
                <li key={bl.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-slate-300 hover:bg-white/5 cursor-pointer"
                    onClick={() => {
                      if (linkedToPaneId) {
                        navigateInSource(linkedToPaneId, bl.id, bl.title);
                      }
                    }}
                  >
                    <FileText className="h-3 w-3 shrink-0 text-slate-500" />
                    <span className="truncate">{bl.title}</span>
                    <ArrowRight className="ml-auto h-3 w-3 shrink-0 text-slate-600" />
                  </button>
                  {bl.context_line && (
                    <p className="ml-7 text-[11px] text-slate-600 truncate">
                      {bl.context_line}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Outlinks section (read-only) */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
            Outlinks ({outlinks.length})
          </h3>
          {outlinks.length === 0 ? (
            <p className="text-xs text-slate-600">No outlinks found</p>
          ) : (
            <ul className="space-y-1">
              {outlinks.map((link, idx) => (
                <li key={idx}>
                  <div className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-slate-400">
                    <Link2 className="h-3 w-3 shrink-0 text-slate-500" />
                    <span className="truncate">{link.target}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
