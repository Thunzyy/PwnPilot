import type { StateCreator } from "zustand";
import { toast } from "sonner";

import { kbApi } from "../../api/kb";
import { showApiErrorToast } from "../../lib/apiToast";
import type { KBDocDetail } from "../../types/kb";
import type { TabSlice } from "./tabSlice";
import type { NavSlice } from "./navSlice";
import type { TreeSlice } from "./treeSlice";
import type { PaneSlice } from "./paneSlice";

// ---------------------------------------------------------------------------
// Doc slice -- manages document cache, edit buffers/modes, and doc CRUD
// ---------------------------------------------------------------------------

export interface DocSlice {
  // State
  docCache: Record<string, KBDocDetail>;
  editBuffers: Record<string, string>;
  editModes: Record<string, boolean>;
  activeDocId: string | null;

  // Actions
  setActiveDoc: (docId: string | null) => void;
  cacheDoc: (doc: KBDocDetail) => void;
  getCachedDoc: (docId: string) => KBDocDetail | undefined;
  invalidateCache: () => void;
  setEditMode: (docId: string, enabled: boolean) => void;
  setEditBuffer: (docId: string, content: string) => void;
  clearEditBuffer: (docId: string) => void;
  isDocDirty: (docId: string) => boolean;
  saveDoc: (docId: string) => Promise<void>;
  createDoc: (sourceId: string, folder: string, filename: string, replaceTabId?: string) => Promise<void>;
  createUntitledNote: (replaceTabId?: string) => Promise<void>;
  renameDoc: (docId: string, newTitle: string) => Promise<void>;
  deleteDoc: (docId: string) => Promise<void>;
  fetchDoc: (docId: string) => Promise<KBDocDetail | undefined>;
}

type CombinedState = TabSlice & DocSlice & NavSlice & TreeSlice & PaneSlice;

export const createDocSlice: StateCreator<
  CombinedState,
  [],
  [],
  DocSlice
> = (set, get) => ({
  // State defaults
  docCache: {},
  editBuffers: {},
  editModes: {},
  activeDocId: null,

  // Actions
  setActiveDoc: (docId) => set({ activeDocId: docId }),

  cacheDoc: (doc) =>
    set((state) => ({
      docCache: { ...state.docCache, [doc.id]: doc },
    })),

  getCachedDoc: (docId) => get().docCache[docId],

  invalidateCache: () => set({ docCache: {} }),

  setEditMode: (docId, enabled) => {
    set((state) => ({
      editModes: { ...state.editModes, [docId]: enabled },
    }));
    if (enabled) {
      const cached = get().docCache[docId];
      if (cached && get().editBuffers[docId] === undefined) {
        set((state) => ({
          editBuffers: {
            ...state.editBuffers,
            [docId]: cached.body ?? "",
          },
        }));
      }
    }
  },

  setEditBuffer: (docId, content) =>
    set((state) => ({
      editBuffers: { ...state.editBuffers, [docId]: content },
    })),

  clearEditBuffer: (docId) =>
    set((state) => {
      const { [docId]: _buf, ...rest } = state.editBuffers;
      void _buf;
      const { [docId]: _mode, ...restModes } = state.editModes;
      void _mode;
      return { editBuffers: rest, editModes: restModes };
    }),

  isDocDirty: (docId) => {
    const buffer = get().editBuffers[docId];
    if (buffer === undefined) return false;
    const cached = get().docCache[docId];
    return buffer !== (cached?.body ?? "");
  },

  saveDoc: async (docId) => {
    const buffer = get().editBuffers[docId];
    if (buffer === undefined) return;

    try {
      const updated = await kbApi.updateDocument(docId, { body: buffer });
      set((state) => {
        const { [docId]: _saved, ...restBuffers } = state.editBuffers;
        void _saved;
        return {
          docCache: { ...state.docCache, [docId]: updated },
          editBuffers: restBuffers,
          editModes: { ...state.editModes, [docId]: false },
        };
      });
      toast.success("Document saved");
    } catch (err: unknown) {
      let message = "Failed to save document";
      if (err && typeof err === "object" && "response" in err) {
        const resp = (err as { response?: { data?: { error?: { message?: string } } } }).response;
        message = resp?.data?.error?.message ?? message;
      }
      toast.error(message);
    }
  },

  createDoc: async (sourceId, folder, filename, replaceTabId?) => {
    const doc = await kbApi.createDocument({
      source_id: sourceId,
      folder,
      filename,
    });
    set((state) => ({
      docCache: { ...state.docCache, [doc.id]: doc },
    }));

    const { focusedPaneId, panes } = get();
    const focusedPane = panes[focusedPaneId];

    if (replaceTabId && focusedPane) {
      // Replace a specific tab (e.g. "new tab") in the focused pane
      set((state) => {
        const pane = state.panes[focusedPaneId];
        if (!pane) return {};
        const updatedTabs = pane.openTabs.map((t) =>
          t.id === replaceTabId
            ? { id: doc.id, type: "doc" as const, docId: doc.id, title: doc.title, sourceId: doc.source_id }
            : t,
        );
        return {
          panes: {
            ...state.panes,
            [focusedPaneId]: { ...pane, openTabs: updatedTabs, activeTabId: doc.id, activeDocId: doc.id },
          },
          activeTabId: doc.id,
          activeDocId: doc.id,
        };
      });
    } else {
      get().openTabInPane(focusedPaneId, doc.id, doc.title, doc.source_id);
    }

    get().setEditMode(doc.id, true);
    get().fetchTreeForSource(doc.source_id);
    toast.success("Note created");
  },

  createUntitledNote: async (replaceTabId?) => {
    const { sources, treesPerSource } = get();
    const writable = sources.filter((s) => !s.read_only);
    if (writable.length === 0) {
      toast.error("No writable source. Add a local vault first.");
      return;
    }
    const source = writable[0];
    const tree = treesPerSource[source.id];
    const rootPaths = new Set(tree?.docs?.map((d) => d.relative_path) ?? []);

    const candidates: string[] = [];
    if (!rootPaths.has("Untitled.md")) candidates.push("Untitled.md");
    for (let i = 1; candidates.length < 10 && i < 100; i++) {
      const name = `Untitled ${i}.md`;
      if (!rootPaths.has(name)) candidates.push(name);
    }
    if (candidates.length === 0) candidates.push(`Untitled ${Date.now()}.md`);

    for (const filename of candidates) {
      try {
        await get().createDoc(source.id, "", filename, replaceTabId);
        return;
      } catch (err: unknown) {
        const status = err && typeof err === "object" && "response" in err
          ? (err as { response?: { status?: number } }).response?.status
          : undefined;
        if (status !== 409) throw err;
      }
    }
    toast.error("Could not create note -- too many untitled files");
  },

  renameDoc: async (docId, newTitle) => {
    try {
      const result = await kbApi.renameDocument(docId, newTitle);

      set((state) => {
        // Update pane tabs across all panes
        const updatedPanes: typeof state.panes = {};
        for (const [pid, pane] of Object.entries(state.panes)) {
          updatedPanes[pid] = {
            ...pane,
            openTabs: pane.openTabs.map((t) =>
              t.docId === docId ? { ...t, title: result.title } : t,
            ),
          };
        }
        return {
          docCache: {
            ...state.docCache,
            [docId]: { ...state.docCache[docId], ...result },
          },
          openTabs: state.openTabs.map((t) =>
            t.docId === docId ? { ...t, title: result.title } : t,
          ),
          panes: updatedPanes,
          navStack: state.navStack.map((entry) =>
            entry.docId === docId ? { ...entry, title: result.title } : entry,
          ),
        };
      });

      get().fetchTreeForSource(result.source_id);
      toast.success(`Renamed to "${result.title}"`);
    } catch (err: unknown) {
      const status =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { status?: number } }).response?.status
          : undefined;
      if (status === 409) {
        showApiErrorToast(
          "A file with that name already exists",
          err,
          "Rename the file or choose another folder.",
        );
      } else if (status === 403) {
        showApiErrorToast(
          "Cannot rename read-only document",
          err,
          "This document belongs to a read-only source.",
        );
      } else {
        showApiErrorToast(
          "Failed to rename document",
          err,
          "Could not rename this document.",
        );
      }
      throw err;
    }
  },

  deleteDoc: async (docId) => {
    const cached = get().docCache[docId];
    try {
      await kbApi.deleteDocument(docId);

      set((state) => {
        const { [docId]: _removed, ...restCache } = state.docCache;
        void _removed;
        const { [docId]: _buf, ...restBuffers } = state.editBuffers;
        void _buf;
        const { [docId]: _mode, ...restModes } = state.editModes;
        void _mode;

        const remainingTabs = state.openTabs.filter((t) => t.docId !== docId);

        // Remove tab from all panes and recompute active tab per pane
        const updatedPanes: typeof state.panes = {};
        let newActiveDocId = state.activeDocId;
        let newActiveTabId = state.activeTabId;

        for (const [pid, pane] of Object.entries(state.panes)) {
          const idx = pane.openTabs.findIndex((t) => t.docId === docId);
          if (idx === -1) {
            updatedPanes[pid] = pane;
            continue;
          }
          const remaining = pane.openTabs.filter((t) => t.docId !== docId);
          let paneActiveTabId = pane.activeTabId;
          let paneActiveDocId = pane.activeDocId;
          if (pane.activeDocId === docId) {
            const next = remaining[idx] ?? remaining[idx - 1] ?? null;
            paneActiveTabId = next?.id ?? null;
            paneActiveDocId = next?.type === "new" ? null : (next?.docId ?? null);
          }
          updatedPanes[pid] = {
            ...pane,
            openTabs: remaining,
            activeTabId: paneActiveTabId,
            activeDocId: paneActiveDocId,
            pinnedTabIds: pane.pinnedTabIds.filter((id) => id !== docId),
          };
          // Sync top-level if this is the focused pane
          if (pid === state.focusedPaneId) {
            newActiveTabId = paneActiveTabId;
            newActiveDocId = paneActiveDocId;
          }
        }

        return {
          docCache: restCache,
          openTabs: remainingTabs,
          panes: updatedPanes,
          editBuffers: restBuffers,
          editModes: restModes,
          pinnedTabIds: state.pinnedTabIds.filter((id) => id !== docId),
          bookmarkIds: state.bookmarkIds.filter((id) => id !== docId),
          activeTabId: newActiveTabId,
          activeDocId: newActiveDocId,
        };
      });

      if (cached?.source_id) {
        get().fetchTreeForSource(cached.source_id);
      }
      toast.success("Document deleted");
    } catch (error) {
      showApiErrorToast(
        "Failed to delete document",
        error,
        "Could not delete this document.",
      );
    }
  },

  fetchDoc: async (docId) => {
    const cached = get().docCache[docId];
    if (cached) return cached;

    try {
      const doc = await kbApi.getDocument(docId);
      set((state) => ({
        docCache: { ...state.docCache, [doc.id]: doc },
      }));
      return doc;
    } catch {
      return undefined;
    }
  },
});
