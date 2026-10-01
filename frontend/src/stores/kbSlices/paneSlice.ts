import type { StateCreator } from "zustand";

import type { KBTab, PaneState } from "../../types/kb";
import type { TabSlice } from "./tabSlice";
import type { DocSlice } from "./docSlice";
import type { NavSlice } from "./navSlice";
import type { TreeSlice } from "./treeSlice";

// ---------------------------------------------------------------------------
// Pane slice -- manages pane layout state for split views
// ---------------------------------------------------------------------------

export interface PaneSlice {
  // State
  panes: Record<string, PaneState>;
  focusedPaneId: string;
  splitDirection: "horizontal" | "vertical" | null;

  // Actions
  splitPane: (
    sourcePaneId: string,
    direction: "horizontal" | "vertical",
    docId: string,
    title: string,
    sourceId?: string,
  ) => void;
  closePane: (paneId: string) => void;
  setFocusedPane: (paneId: string) => void;
  openTabInPane: (
    paneId: string,
    docId: string,
    title: string,
    sourceId?: string,
  ) => void;
  closeTabInPane: (paneId: string, tabId: string) => void;
  setActivePaneTab: (paneId: string, tabId: string) => void;
  navigateToDocInPane: (
    paneId: string,
    docId: string,
    title: string,
    sourceId?: string,
  ) => void;
  closeOtherTabsInPane: (paneId: string, keepTabId: string) => void;
  closeTabsToRightInPane: (paneId: string, tabId: string) => void;
  closeAllTabsInPane: (paneId: string) => void;
  openNewTabInPane: (paneId: string) => void;
  openLinkedView: (sourcePaneId: string) => void;
}

type CombinedState = TabSlice & DocSlice & NavSlice & TreeSlice & PaneSlice;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Remove a pane and return updated state for the remaining single pane. */
function removePaneState(
  panes: Record<string, PaneState>,
  paneId: string,
  focusedPaneId: string,
): Partial<CombinedState> {
  const { [paneId]: _removed, ...remaining } = panes;
  void _removed;
  const remainingIds = Object.keys(remaining);
  if (remainingIds.length === 0) return {};
  const newFocusId =
    focusedPaneId === paneId ? remainingIds[0] : focusedPaneId;
  const focusedPane = remaining[newFocusId];
  return {
    panes: remaining,
    focusedPaneId: newFocusId,
    splitDirection: null,
    activeDocId: focusedPane?.activeDocId ?? null,
    activeTabId: focusedPane?.activeTabId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Slice creator
// ---------------------------------------------------------------------------

export const createPaneSlice: StateCreator<
  CombinedState,
  [],
  [],
  PaneSlice
> = (set, get) => ({
  // State defaults -- single default pane
  panes: {
    default: {
      id: "default",
      type: "editor",
      linkedToPaneId: null,
      openTabs: [],
      activeTabId: null,
      activeDocId: null,
      pinnedTabIds: [],
      navStack: [],
      navCursor: -1,
      scrollPositions: {},
    },
  },
  focusedPaneId: "default",
  splitDirection: null,

  // Actions

  splitPane: (sourcePaneId, direction, docId, title, sourceId = "") => {
    const { panes } = get();
    // Maximum 2 panes -- do nothing if already split
    if (Object.keys(panes).length >= 2) return;
    if (!panes[sourcePaneId]) return;

    const newPaneId = crypto.randomUUID();
    const newTab: KBTab = {
      id: docId,
      type: "doc",
      docId,
      title,
      sourceId,
    };
    const newPane: PaneState = {
      id: newPaneId,
      type: "editor",
      linkedToPaneId: null,
      openTabs: [newTab],
      activeTabId: docId,
      activeDocId: docId,
      pinnedTabIds: [],
      navStack: [{ docId, title }],
      navCursor: 0,
      scrollPositions: {},
    };

    set({
      panes: { ...panes, [newPaneId]: newPane },
      splitDirection: direction,
      // Source pane stays focused -- do NOT update focusedPaneId
    });
  },

  closePane: (paneId) =>
    set((state) => {
      if (!state.panes[paneId]) return {};
      return removePaneState(state.panes, paneId, state.focusedPaneId);
    }),

  setFocusedPane: (paneId) =>
    set((state) => {
      const targetPane = state.panes[paneId];
      if (!targetPane) return {};
      return {
        focusedPaneId: paneId,
        activeDocId: targetPane.activeDocId,
        activeTabId: targetPane.activeTabId,
      };
    }),

  openTabInPane: (paneId, docId, title, sourceId = "") =>
    set((state) => {
      const pane = state.panes[paneId];
      if (!pane) return {};

      const existing = pane.openTabs.find((t) => t.docId === docId);
      if (existing) {
        // Tab already open -- activate it
        const navUpdate =
          pane.navStack[pane.navCursor]?.docId !== docId
            ? {
                navStack: [
                  ...pane.navStack.slice(0, pane.navCursor + 1),
                  { docId, title: existing.title },
                ],
                navCursor: pane.navCursor + 1,
              }
            : {};

        const updatedPane: PaneState = {
          ...pane,
          activeTabId: existing.id,
          activeDocId: docId,
          ...navUpdate,
        };
        const paneUpdate = { panes: { ...state.panes, [paneId]: updatedPane } };
        const topLevel =
          state.focusedPaneId === paneId
            ? { activeDocId: docId, activeTabId: existing.id }
            : {};
        return { ...paneUpdate, ...topLevel };
      }

      // New tab
      const newTab: KBTab = {
        id: docId,
        type: "doc",
        docId,
        title,
        sourceId,
      };
      const trimmed = pane.navStack.slice(0, pane.navCursor + 1);
      const updatedPane: PaneState = {
        ...pane,
        openTabs: [...pane.openTabs, newTab],
        activeTabId: docId,
        activeDocId: docId,
        navStack: [...trimmed, { docId, title }],
        navCursor: trimmed.length,
      };
      const paneUpdate = { panes: { ...state.panes, [paneId]: updatedPane } };
      const topLevel =
        state.focusedPaneId === paneId
          ? { activeDocId: docId, activeTabId: docId }
          : {};
      return { ...paneUpdate, ...topLevel };
    }),

  closeTabInPane: (paneId, tabId) =>
    set((state) => {
      const pane = state.panes[paneId];
      if (!pane) return {};
      // Pinned tabs cannot be closed
      if (pane.pinnedTabIds.includes(tabId)) return {};

      const idx = pane.openTabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return {};

      const remaining = pane.openTabs.filter((t) => t.id !== tabId);

      // If no tabs remain, close the pane only when another pane exists.
      // For the lone pane layout, keep the pane and clear active selection.
      if (remaining.length === 0) {
        if (Object.keys(state.panes).length === 1) {
          const clearedPane: PaneState = {
            ...pane,
            openTabs: [],
            activeTabId: null,
            activeDocId: null,
            pinnedTabIds: [],
            navStack: [],
            navCursor: -1,
          };
          return {
            panes: { ...state.panes, [paneId]: clearedPane },
            ...(state.focusedPaneId === paneId
              ? { activeDocId: null, activeTabId: null }
              : {}),
          };
        }
        return removePaneState(state.panes, paneId, state.focusedPaneId);
      }

      let newActiveTabId = pane.activeTabId;
      let newActiveDocId = pane.activeDocId;
      if (pane.activeTabId === tabId) {
        const nextTab = remaining[idx] ?? remaining[idx - 1] ?? null;
        newActiveTabId = nextTab?.id ?? null;
        newActiveDocId =
          nextTab?.type === "new" ? null : (nextTab?.docId ?? null);
      }

      const updatedPane: PaneState = {
        ...pane,
        openTabs: remaining,
        activeTabId: newActiveTabId,
        activeDocId: newActiveDocId,
      };
      const paneUpdate = { panes: { ...state.panes, [paneId]: updatedPane } };
      const topLevel =
        state.focusedPaneId === paneId
          ? { activeDocId: newActiveDocId, activeTabId: newActiveTabId }
          : {};
      return { ...paneUpdate, ...topLevel };
    }),

  setActivePaneTab: (paneId, tabId) =>
    set((state) => {
      const pane = state.panes[paneId];
      if (!pane) return {};
      const tab = pane.openTabs.find((t) => t.id === tabId);
      if (!tab) return {};

      const newActiveDocId =
        tab.type === "new" ? null : tab.docId;
      const navUpdate =
        tab.type !== "new" && pane.navStack[pane.navCursor]?.docId !== tab.docId
          ? {
              navStack: [
                ...pane.navStack.slice(0, pane.navCursor + 1),
                { docId: tab.docId, title: tab.title },
              ],
              navCursor: pane.navCursor + 1,
            }
          : {};

      const updatedPane: PaneState = {
        ...pane,
        activeTabId: tabId,
        activeDocId: newActiveDocId,
        ...navUpdate,
      };
      const paneUpdate = { panes: { ...state.panes, [paneId]: updatedPane } };
      const topLevel =
        state.focusedPaneId === paneId
          ? { activeDocId: newActiveDocId, activeTabId: tabId }
          : {};
      return { ...paneUpdate, ...topLevel };
    }),

  navigateToDocInPane: (paneId, docId, title, sourceId = "") => {
    // Delegate to openTabInPane which handles nav stack and backward compat
    get().openTabInPane(paneId, docId, title, sourceId);
  },

  closeOtherTabsInPane: (paneId, keepTabId) =>
    set((state) => {
      const pane = state.panes[paneId];
      if (!pane) return {};
      const kept = pane.openTabs.filter(
        (t) => t.id === keepTabId || pane.pinnedTabIds.includes(t.id),
      );
      if (kept.length === 0) {
        return removePaneState(state.panes, paneId, state.focusedPaneId);
      }
      const active = kept.find((t) => t.id === keepTabId) ?? kept[0];
      const newActiveDocId =
        active.type === "new" ? null : active.docId;
      const updatedPane: PaneState = {
        ...pane,
        openTabs: kept,
        activeTabId: active.id,
        activeDocId: newActiveDocId,
      };
      const paneUpdate = { panes: { ...state.panes, [paneId]: updatedPane } };
      const topLevel =
        state.focusedPaneId === paneId
          ? { activeDocId: newActiveDocId, activeTabId: active.id }
          : {};
      return { ...paneUpdate, ...topLevel };
    }),

  closeTabsToRightInPane: (paneId, tabId) =>
    set((state) => {
      const pane = state.panes[paneId];
      if (!pane) return {};
      const idx = pane.openTabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return {};
      const remaining = pane.openTabs.filter(
        (t, i) => i <= idx || pane.pinnedTabIds.includes(t.id),
      );
      if (remaining.length === 0) {
        return removePaneState(state.panes, paneId, state.focusedPaneId);
      }
      const activeStillExists = remaining.some(
        (t) => t.id === pane.activeTabId,
      );
      let newActiveTabId = pane.activeTabId;
      let newActiveDocId = pane.activeDocId;
      if (!activeStillExists) {
        const last = remaining[remaining.length - 1];
        newActiveTabId = last?.id ?? null;
        newActiveDocId =
          last?.type === "new" ? null : (last?.docId ?? null);
      }
      const updatedPane: PaneState = {
        ...pane,
        openTabs: remaining,
        activeTabId: newActiveTabId,
        activeDocId: newActiveDocId,
      };
      const paneUpdate = { panes: { ...state.panes, [paneId]: updatedPane } };
      const topLevel =
        state.focusedPaneId === paneId
          ? { activeDocId: newActiveDocId, activeTabId: newActiveTabId }
          : {};
      return { ...paneUpdate, ...topLevel };
    }),

  closeAllTabsInPane: (paneId) =>
    set((state) => {
      const pane = state.panes[paneId];
      if (!pane) return {};
      const pinned = pane.openTabs.filter((t) =>
        pane.pinnedTabIds.includes(t.id),
      );
      if (pinned.length === 0) {
        // No pinned tabs remain -- close the pane
        return removePaneState(state.panes, paneId, state.focusedPaneId);
      }
      const first = pinned[0];
      const newActiveDocId =
        first.type === "new" ? null : first.docId;
      const updatedPane: PaneState = {
        ...pane,
        openTabs: pinned,
        activeTabId: first.id,
        activeDocId: newActiveDocId,
      };
      const paneUpdate = { panes: { ...state.panes, [paneId]: updatedPane } };
      const topLevel =
        state.focusedPaneId === paneId
          ? { activeDocId: newActiveDocId, activeTabId: first.id }
          : {};
      return { ...paneUpdate, ...topLevel };
    }),

  openNewTabInPane: (paneId) =>
    set((state) => {
      const pane = state.panes[paneId];
      if (!pane) return {};
      const id = `new-tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const newTab: KBTab = {
        id,
        type: "new",
        docId: "",
        title: "New tab",
        sourceId: "",
      };
      const updatedPane: PaneState = {
        ...pane,
        openTabs: [...pane.openTabs, newTab],
        activeTabId: id,
        activeDocId: null,
      };
      const paneUpdate = { panes: { ...state.panes, [paneId]: updatedPane } };
      const topLevel =
        state.focusedPaneId === paneId
          ? { activeDocId: null, activeTabId: id }
          : {};
      return { ...paneUpdate, ...topLevel };
    }),

  openLinkedView: (sourcePaneId) => {
    const { panes } = get();
    // Maximum 2 panes -- do nothing if already split
    if (Object.keys(panes).length >= 2) return;
    if (!panes[sourcePaneId]) return;

    const newPaneId = crypto.randomUUID();
    const linkedPane: PaneState = {
      id: newPaneId,
      type: "linked",
      linkedToPaneId: sourcePaneId,
      openTabs: [],
      activeTabId: null,
      activeDocId: null,
      pinnedTabIds: [],
      navStack: [],
      navCursor: -1,
      scrollPositions: {},
    };

    set({
      panes: { ...panes, [newPaneId]: linkedPane },
      splitDirection: "horizontal",
      // Source pane stays focused -- do NOT update focusedPaneId
    });
  },
});
