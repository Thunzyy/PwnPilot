import type { StateCreator } from "zustand";

import type { KBTab } from "../../types/kb";
import type { DocSlice } from "./docSlice";
import type { NavSlice } from "./navSlice";
import type { TreeSlice } from "./treeSlice";
import type { PaneSlice } from "./paneSlice";

// ---------------------------------------------------------------------------
// Tab slice -- manages open tabs, active tab, and pinned tab state
// ---------------------------------------------------------------------------

export interface TabSlice {
  // State
  openTabs: KBTab[];
  activeTabId: string | null;
  pinnedTabIds: string[];

  // Actions
  openTab: (docId: string, title: string, sourceId?: string) => void;
  openNewTab: () => void;
  closeTab: (tabId: string) => void;
  closeOtherTabs: (tabId: string) => void;
  closeTabsToRight: (tabId: string) => void;
  closeAllTabs: () => void;
  setActiveTab: (tabId: string) => void;
  updateTabTitle: (tabId: string, title: string, sourceId?: string) => void;
  pinTab: (tabId: string) => void;
  unpinTab: (tabId: string) => void;
  isPinned: (tabId: string) => boolean;
}

type CombinedState = TabSlice & DocSlice & NavSlice & TreeSlice & PaneSlice;

export const createTabSlice: StateCreator<
  CombinedState,
  [],
  [],
  TabSlice
> = (set, get) => ({
  // State defaults
  openTabs: [],
  activeTabId: null,
  pinnedTabIds: [],

  // Actions
  openTab: (docId, title, sourceId = "") => {
    const { openTabs, navStack, navCursor } = get();
    const existing = openTabs.find((t) => t.docId === docId);
    if (existing) {
      if (navStack[navCursor]?.docId !== docId) {
        const trimmed = navStack.slice(0, navCursor + 1);
        set({
          activeTabId: existing.id,
          activeDocId: docId,
          navStack: [...trimmed, { docId, title: existing.title }],
          navCursor: trimmed.length,
        });
      } else {
        set({ activeTabId: existing.id, activeDocId: docId });
      }
      return;
    }
    const newTab: KBTab = { id: docId, type: "doc", docId, title, sourceId };
    const trimmed = navStack.slice(0, navCursor + 1);
    set({
      openTabs: [...openTabs, newTab],
      activeTabId: newTab.id,
      activeDocId: docId,
      navStack: [...trimmed, { docId, title }],
      navCursor: trimmed.length,
    });
  },

  openNewTab: () => {
    const id = `new-tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newTab: KBTab = { id, type: "new", docId: "", title: "New tab", sourceId: "" };
    set((state) => ({
      openTabs: [...state.openTabs, newTab],
      activeTabId: id,
      activeDocId: null,
    }));
  },

  closeTab: (tabId) => {
    if (get().pinnedTabIds.includes(tabId)) return;
    const { openTabs, activeTabId } = get();
    const idx = openTabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;

    const remaining = openTabs.filter((t) => t.id !== tabId);

    if (activeTabId === tabId) {
      const nextTab = remaining[idx] ?? remaining[idx - 1] ?? null;
      set({
        openTabs: remaining,
        activeTabId: nextTab?.id ?? null,
        activeDocId: nextTab?.type === "new" ? null : (nextTab?.docId ?? null),
      });
    } else {
      set({ openTabs: remaining });
    }
  },

  closeOtherTabs: (tabId) => {
    const { openTabs, pinnedTabIds } = get();
    const kept = openTabs.filter(
      (t) => t.id === tabId || pinnedTabIds.includes(t.id),
    );
    if (kept.length === 0) return;
    const active = kept.find((t) => t.id === tabId) ?? kept[0];
    set({
      openTabs: kept,
      activeTabId: active.id,
      activeDocId: active.type === "new" ? null : active.docId,
    });
  },

  closeTabsToRight: (tabId) => {
    const { openTabs, activeTabId, pinnedTabIds } = get();
    const idx = openTabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    const remaining = openTabs.filter(
      (t, i) => i <= idx || pinnedTabIds.includes(t.id),
    );
    const activeStillExists = remaining.some((t) => t.id === activeTabId);
    if (activeStillExists) {
      set({ openTabs: remaining });
    } else {
      const last = remaining[remaining.length - 1];
      set({
        openTabs: remaining,
        activeTabId: last?.id ?? null,
        activeDocId: last?.type === "new" ? null : (last?.docId ?? null),
      });
    }
  },

  closeAllTabs: () => {
    const { openTabs, pinnedTabIds } = get();
    const pinned = openTabs.filter((t) => pinnedTabIds.includes(t.id));
    if (pinned.length === 0) {
      set({ openTabs: [], activeTabId: null, activeDocId: null });
    } else {
      const first = pinned[0];
      set({
        openTabs: pinned,
        activeTabId: first.id,
        activeDocId: first.type === "new" ? null : first.docId,
      });
    }
  },

  setActiveTab: (tabId) => {
    const { openTabs, navStack, navCursor } = get();
    const tab = openTabs.find((t) => t.id === tabId);
    if (!tab) return;
    if (tab.type === "new") {
      set({ activeTabId: tabId, activeDocId: null });
      return;
    }
    if (navStack[navCursor]?.docId !== tab.docId) {
      const trimmed = navStack.slice(0, navCursor + 1);
      set({
        activeTabId: tabId,
        activeDocId: tab.docId,
        navStack: [...trimmed, { docId: tab.docId, title: tab.title }],
        navCursor: trimmed.length,
      });
    } else {
      set({ activeTabId: tabId, activeDocId: tab.docId });
    }
  },

  updateTabTitle: (tabId, title, sourceId) => {
    const { openTabs } = get();
    const exists = openTabs.some((t) => t.id === tabId);
    if (!exists) return;
    set({
      openTabs: openTabs.map((t) =>
        t.id === tabId
          ? { ...t, title, ...(sourceId !== undefined && { sourceId }) }
          : t
      ),
    });
  },

  pinTab: (tabId) =>
    set((state) => ({
      pinnedTabIds: state.pinnedTabIds.includes(tabId)
        ? state.pinnedTabIds
        : [...state.pinnedTabIds, tabId],
    })),

  unpinTab: (tabId) =>
    set((state) => ({
      pinnedTabIds: state.pinnedTabIds.filter((id) => id !== tabId),
    })),

  isPinned: (tabId) => get().pinnedTabIds.includes(tabId),
});
