import type { StateCreator } from "zustand";

import type { TabSlice } from "./tabSlice";
import type { DocSlice } from "./docSlice";
import type { TreeSlice } from "./treeSlice";
import type { PaneSlice } from "./paneSlice";

// ---------------------------------------------------------------------------
// Nav slice -- manages navigation history (back/forward stack)
// ---------------------------------------------------------------------------

export interface NavSlice {
  // State
  navStack: Array<{ docId: string; title: string }>;
  navCursor: number;

  // Actions
  navigateToDoc: (docId: string, title: string) => void;
  navigateBack: () => void;
  navigateForward: () => void;
  clearHistory: () => void;
}

type CombinedState = TabSlice & DocSlice & NavSlice & TreeSlice & PaneSlice;

export const createNavSlice: StateCreator<
  CombinedState,
  [],
  [],
  NavSlice
> = (set, get) => ({
  // State defaults
  navStack: [],
  navCursor: -1,

  // Actions
  navigateToDoc: (docId, title) => {
    const { navStack, navCursor } = get();
    if (navStack[navCursor]?.docId === docId) return;
    const trimmed = navStack.slice(0, navCursor + 1);
    set({
      navStack: [...trimmed, { docId, title }],
      navCursor: trimmed.length,
      activeDocId: docId,
    });
  },

  navigateBack: () => {
    const { navStack, navCursor } = get();
    if (navCursor <= 0) return;
    const newCursor = navCursor - 1;
    set({
      navCursor: newCursor,
      activeDocId: navStack[newCursor].docId,
    });
  },

  navigateForward: () => {
    const { navStack, navCursor } = get();
    if (navCursor >= navStack.length - 1) return;
    const newCursor = navCursor + 1;
    set({
      navCursor: newCursor,
      activeDocId: navStack[newCursor].docId,
    });
  },

  clearHistory: () => set({ navStack: [], navCursor: -1 }),
});
