import { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { kbApi } from "@/api/kb";
import { showApiErrorToast } from "@/lib/apiToast";
import { Button } from "@/components/ui/button";
import type { KBTagInfo } from "@/types/kb";

interface TagBulkToolbarProps {
  selectedIds: string[];
  currentTag: string;
  onComplete: () => void;
}

export function TagBulkToolbar({
  selectedIds,
  currentTag,
  onComplete,
}: TagBulkToolbarProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [allTags, setAllTags] = useState<KBTagInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setAddOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function openAddDropdown() {
    setAddOpen(true);
    try {
      setAllTags(await kbApi.getTags());
    } catch {
      /* best-effort */
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  const filtered = allTags
    .filter((t) => t.tag.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8);

  async function addTag(tag: string) {
    const trimmed = tag.trim().toLowerCase();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const res = await kbApi.bulkEditTags(selectedIds, [trimmed], []);
      const parts = [`Added "${trimmed}" to ${res.docs_updated} doc(s)`];
      if (res.read_only_skipped > 0)
        parts.push(`${res.read_only_skipped} read-only skipped`);
      toast.success(parts.join(". "));
      setAddOpen(false);
      setQuery("");
      onComplete();
    } catch (error) {
      showApiErrorToast(
        "Failed to add tag",
        error,
        "Could not add this tag to the selected documents.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeCurrentTag() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await kbApi.bulkEditTags(selectedIds, [], [currentTag]);
      const parts = [
        `Removed "${currentTag}" from ${res.docs_updated} doc(s)`,
      ];
      if (res.read_only_skipped > 0)
        parts.push(`${res.read_only_skipped} read-only skipped`);
      toast.success(parts.join(". "));
      onComplete();
    } catch (error) {
      showApiErrorToast(
        "Failed to remove tag",
        error,
        "Could not remove this tag from the selected documents.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-md bg-slate-800/60 px-3 py-1.5 text-xs">
      <span className="text-slate-400">
        {selectedIds.length} selected
      </span>

      {/* Add tag dropdown */}
      <div ref={wrapRef} className="relative">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-xs text-slate-300 hover:text-white"
          onClick={addOpen ? () => setAddOpen(false) : openAddDropdown}
          disabled={busy}
        >
          <Plus className="size-3" />
          Add tag
        </Button>

        {addOpen && (
          <div className="absolute left-0 top-full z-30 mt-1 w-52 rounded border border-white/10 bg-[#1a2030] shadow-lg">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag(query);
                }
                if (e.key === "Escape") {
                  setAddOpen(false);
                  setQuery("");
                }
              }}
              placeholder="Search or create tag..."
              className="w-full border-b border-white/10 bg-transparent px-2.5 py-1.5 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none"
            />
            {filtered.length > 0 && (
              <div className="max-h-40 overflow-y-auto">
                {filtered.map((t) => (
                  <button
                    key={t.tag}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => addTag(t.tag)}
                    className="flex w-full items-center justify-between px-2.5 py-1 text-left text-xs text-slate-300 hover:bg-white/[0.05]"
                  >
                    <span>{t.tag}</span>
                    <span className="text-slate-500">{t.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Remove current tag */}
      <Button
        variant="ghost"
        size="sm"
        className="h-6 gap-1 px-2 text-xs text-red-400 hover:text-red-300"
        onClick={removeCurrentTag}
        disabled={busy}
      >
        <Minus className="size-3" />
        Remove &ldquo;{currentTag}&rdquo;
      </Button>
    </div>
  );
}
