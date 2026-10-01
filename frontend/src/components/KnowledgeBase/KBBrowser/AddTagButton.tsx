import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { kbApi } from "@/api/kb";
import type { KBTagInfo } from "@/types/kb";

interface AddTagButtonProps {
  existingTags: string[];
  onAdd: (tag: string) => void;
}

export function AddTagButton({ existingTags, onAdd }: AddTagButtonProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [allTags, setAllTags] = useState<KBTagInfo[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleOpen = async () => {
    setOpen(true);
    try {
      setAllTags(await kbApi.getTags());
    } catch {
      /* best-effort */
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const filtered = allTags
    .filter(
      (t) =>
        !existingTags.includes(t.tag) &&
        t.tag.toLowerCase().includes(query.toLowerCase()),
    )
    .slice(0, 8);

  const submit = (tag: string) => {
    const trimmed = tag.trim().toLowerCase();
    if (!trimmed || existingTags.includes(trimmed)) return;
    onAdd(trimmed);
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        onClick={open ? () => setOpen(false) : handleOpen}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-slate-500 transition-colors hover:bg-white/[0.05] hover:text-slate-300"
        aria-label="Add tag"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-52 rounded border border-white/10 bg-[#1a2030] shadow-lg">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit(query);
              }
              if (e.key === "Escape") {
                setOpen(false);
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
                  onClick={() => submit(t.tag)}
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
  );
}
