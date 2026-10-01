import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { createTabSlice, type TabSlice } from "./kbSlices/tabSlice";
import { createDocSlice, type DocSlice } from "./kbSlices/docSlice";
import { createNavSlice, type NavSlice } from "./kbSlices/navSlice";
import { createTreeSlice, type TreeSlice } from "./kbSlices/treeSlice";
import { createPaneSlice, type PaneSlice } from "./kbSlices/paneSlice";

// ---------------------------------------------------------------------------
// Combined KB store -- slices + persist middleware
// ---------------------------------------------------------------------------

export type KBState = TabSlice & DocSlice & NavSlice & TreeSlice & PaneSlice;

export const useKBStore = create<KBState>()(
  persist(
    (...a) => ({
      ...createTabSlice(...a),
      ...createDocSlice(...a),
      ...createNavSlice(...a),
      ...createTreeSlice(...a),
      ...createPaneSlice(...a),
    }),
    {
      name: "pwnpilot:kb-store",
      version: 7,
      storage: createJSONStorage(() => window.localStorage),
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as Record<string, unknown>;
        if (version < 2) {
          // v1 -> v2: add tab state fields
          state.openTabs = [];
          state.activeTabId = null;
        }
        if (version < 3) {
          // v2 -> v3: add type discriminator to existing tabs
          const tabs = state.openTabs as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(tabs)) {
            state.openTabs = tabs.map((t) => ({ ...t, type: t.type ?? "doc" }));
          }
        }
        if (version < 4) {
          // v3 -> v4: add pinned tab IDs
          state.pinnedTabIds = [];
        }
        if (version < 5) {
          // v4 -> v5: wrap existing tab state into default pane
          state.panes = {
            default: {
              id: "default",
              type: "editor",
              linkedToPaneId: null,
              openTabs: state.openTabs ?? [],
              activeTabId: state.activeTabId ?? null,
              activeDocId: state.activeDocId ?? null,
              pinnedTabIds: state.pinnedTabIds ?? [],
              navStack: [],
              navCursor: -1,
              scrollPositions: {},
            },
          };
          state.focusedPaneId = "default";
          state.splitDirection = null;
        }
        if (version < 6) {
          // v5 -> v6: add type/linkedToPaneId to existing panes
          const panes = state.panes as Record<string, Record<string, unknown>> | undefined;
          if (panes) {
            for (const pane of Object.values(panes)) {
              if (!pane.type) pane.type = "editor";
              if (pane.linkedToPaneId === undefined) pane.linkedToPaneId = null;
            }
          }
        }
        if (version < 7) {
          // v6 -> v7: add tree sort order
          state.treeSortOrder = "name-asc";
        }
        return state;
      },
      partialize: (state) => ({
        activeDocId: state.activeDocId,
        expandedFolders: state.expandedFolders,
        recentSearches: state.recentSearches,
        expandedSources: state.expandedSources,
        openTabs: state.openTabs,
        activeTabId: state.activeTabId,
        pinnedTabIds: state.pinnedTabIds,
        panes: state.panes,
        focusedPaneId: state.focusedPaneId,
        splitDirection: state.splitDirection,
        caseSensitive: state.caseSensitive,
        showSearchOptions: state.showSearchOptions,
        treeSortOrder: state.treeSortOrder,
      }),
    }
  )
);
