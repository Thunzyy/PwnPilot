import { useCallback, useState } from "react";
import { ChevronRight, Lock, Pencil, Trash2 } from "lucide-react";
import { kbApi } from "@/api/kb";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TagPill } from "@/components/KnowledgeBase/KBBrowser/TagPill";
import { TagBulkToolbar } from "./TagBulkToolbar";
import { useKBStore } from "@/stores/kbStore";
import type { KBDoc, KBTagInfo } from "@/types/kb";

interface TagDetailRowProps {
  tag: KBTagInfo;
  onRename: (tag: KBTagInfo) => void;
  onDelete: (tag: KBTagInfo) => void;
  onBulkComplete: () => void;
}

export function TagDetailRow({
  tag,
  onRename,
  onDelete,
  onBulkComplete,
}: TagDetailRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [docs, setDocs] = useState<KBDoc[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const sources = useKBStore((s) => s.sources);

  const isReadOnly = useCallback(
    (sourceId: string) => {
      const src = sources.find((s) => s.id === sourceId);
      return src?.read_only === true;
    },
    [sources],
  );

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await kbApi.listDocuments(undefined, undefined, 100, tag.tag);
      setDocs(res.items);
      setHasMore(res.has_more);
    } catch {
      /* best-effort */
    } finally {
      setLoading(false);
    }
  }, [tag.tag]);

  function toggleExpand() {
    if (!expanded) {
      fetchDocs();
      setSelectedIds(new Set());
    }
    setExpanded((prev) => !prev);
  }

  const writableDocs = docs.filter((d) => !isReadOnly(d.source_id));
  const allWritableSelected =
    writableDocs.length > 0 &&
    writableDocs.every((d) => selectedIds.has(d.id));

  function toggleSelectAll() {
    if (allWritableSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(writableDocs.map((d) => d.id)));
    }
  }

  function toggleDoc(docId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  }

  function handleBulkComplete() {
    setSelectedIds(new Set());
    fetchDocs();
    onBulkComplete();
  }

  return (
    <div>
      {/* Collapsed/header row */}
      <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-800/50">
        <button
          type="button"
          onClick={toggleExpand}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <ChevronRight
            className={`size-3.5 text-slate-500 transition-transform ${expanded ? "rotate-90" : ""}`}
          />
          <TagPill tag={tag.tag} size="sm" />
          <span className="text-xs tabular-nums text-slate-500">
            {tag.count}
          </span>
        </button>
        <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-slate-500 hover:text-white"
            onClick={(e) => {
              e.stopPropagation();
              onRename(tag);
            }}
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-slate-500 hover:text-red-400"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(tag);
            }}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Expanded doc list */}
      {expanded && (
        <div className="ml-4 mt-1 space-y-1 border-l border-white/5 pl-3">
          {loading ? (
            <p className="py-2 text-xs text-slate-600">Loading...</p>
          ) : (
            <>
              {selectedIds.size > 0 && (
                <TagBulkToolbar
                  selectedIds={Array.from(selectedIds)}
                  currentTag={tag.tag}
                  onComplete={handleBulkComplete}
                />
              )}

              {writableDocs.length > 0 && (
                <label className="flex cursor-pointer items-center gap-2 px-1 py-1 text-xs text-slate-400 hover:text-slate-300">
                  <Checkbox
                    checked={allWritableSelected}
                    onCheckedChange={toggleSelectAll}
                  />
                  Select all ({writableDocs.length} writable)
                </label>
              )}

              {docs.map((doc) => {
                const ro = isReadOnly(doc.source_id);
                const docTags = doc.tags ? doc.tags.split(" ") : [];
                return (
                  <div
                    key={doc.id}
                    className={`flex items-center gap-2 rounded px-1 py-1 text-xs ${
                      ro ? "opacity-50" : "hover:bg-slate-800/40"
                    }`}
                  >
                    {ro ? (
                      <Lock className="size-3.5 shrink-0 text-slate-600" />
                    ) : (
                      <Checkbox
                        checked={selectedIds.has(doc.id)}
                        onCheckedChange={() => toggleDoc(doc.id)}
                      />
                    )}
                    <span className="truncate font-medium text-slate-300">
                      {doc.title}
                    </span>
                    <span className="truncate text-slate-600">
                      {doc.relative_path}
                    </span>
                    <div className="ml-auto flex shrink-0 gap-1">
                      {docTags.slice(0, 3).map((t) => (
                        <TagPill key={t} tag={t} size="sm" />
                      ))}
                      {docTags.length > 3 && (
                        <span className="text-slate-600">
                          +{docTags.length - 3}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

              {hasMore && (
                <p className="py-1 text-center text-xs text-slate-600">
                  (more documents not shown)
                </p>
              )}

              {docs.length === 0 && !loading && (
                <p className="py-2 text-xs text-slate-600">No documents.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
