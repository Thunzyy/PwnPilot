/**
 * KBNewTabPage -- Obsidian-style blank tab landing page.
 *
 * Shows centered action buttons: New note, Go to file, Close.
 * "New note" creates an "Untitled.md" instantly (no dialog), like Obsidian.
 */
import { useState } from "react";
import { FilePlus, Search, X } from "lucide-react";

import { useKBStore } from "@/stores/kbStore";
import { showApiErrorToast } from "@/lib/apiToast";

interface KBNewTabPageProps {
  tabId: string;
}

export function KBNewTabPage({ tabId }: KBNewTabPageProps) {
  const closeTab = useKBStore((s) => s.closeTab);
  const requestSearchFocus = useKBStore((s) => s.requestSearchFocus);
  const createUntitledNote = useKBStore((s) => s.createUntitledNote);

  const [creating, setCreating] = useState(false);

  const handleNewNote = async () => {
    setCreating(true);
    try {
      await createUntitledNote(tabId);
    } catch (error) {
      showApiErrorToast(
        "Failed to create note",
        error,
        "Could not create a new note.",
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 text-slate-500">
      <div className="flex flex-col items-center gap-2">
        <h2 className="text-lg font-medium text-slate-400">New tab</h2>
        <p className="text-sm text-slate-600">
          Create a note or search your knowledge base
        </p>
      </div>

      <div className="flex flex-col gap-2 w-56">
        <button
          type="button"
          disabled={creating}
          className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3 text-sm text-slate-400 transition-colors hover:border-white/10 hover:bg-white/5 hover:text-slate-200 disabled:opacity-50"
          onClick={handleNewNote}
        >
          <FilePlus className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">
            {creating ? "Creating..." : "New note"}
          </span>
          <kbd className="text-[10px] text-slate-600 font-mono">Ctrl+N</kbd>
        </button>

        <button
          type="button"
          className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3 text-sm text-slate-400 transition-colors hover:border-white/10 hover:bg-white/5 hover:text-slate-200"
          onClick={() => requestSearchFocus()}
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">Go to file</span>
          <kbd className="text-[10px] text-slate-600 font-mono">Ctrl+O</kbd>
        </button>

        <button
          type="button"
          className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3 text-sm text-slate-400 transition-colors hover:border-white/10 hover:bg-white/5 hover:text-slate-200"
          onClick={() => closeTab(tabId)}
        >
          <X className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">Close tab</span>
        </button>
      </div>
    </div>
  );
}
