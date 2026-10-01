/**
 * BookmarkSection -- Sidebar section showing bookmarked documents.
 * Renders above the per-source file trees in the KBSidebar.
 */
import { Bookmark, FileText } from "lucide-react";

import { useKBStore } from "@/stores/kbStore";

interface BookmarkSectionProps {
  onSelectDoc: (docId: string, sourceId: string, title: string) => void;
}

export function BookmarkSection({ onSelectDoc }: BookmarkSectionProps) {
  const bookmarkIds = useKBStore((s) => s.bookmarkIds);
  const docCache = useKBStore((s) => s.docCache);

  if (bookmarkIds.length === 0) return null;

  // Build display list from cache (only show cached docs)
  const entries = bookmarkIds
    .map((id) => docCache[id])
    .filter(Boolean);

  if (entries.length === 0) return null;

  return (
    <div className="mb-1">
      <h3 className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-600">
        <Bookmark className="h-3 w-3" />
        Bookmarks
      </h3>
      <ul className="space-y-0.5 px-1">
        {entries.map((doc) => (
          <li key={doc.id}>
            <button
              type="button"
              onClick={() =>
                onSelectDoc(doc.id, doc.source_id, doc.title)
              }
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm text-slate-300 hover:bg-white/[0.05] hover:text-slate-100 cursor-pointer"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-primary/70" />
              <span className="truncate">{doc.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
