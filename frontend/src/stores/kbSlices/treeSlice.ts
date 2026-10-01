import type { StateCreator } from "zustand";
import { toast } from "sonner";

import { kbSourceQueryKeys, mapKBSourcesError } from "../../api/kbSources";
import { kbApi } from "../../api/kb";
import { showApiErrorToast } from "../../lib/apiToast";
import { recordKBPerfSample } from "../../lib/perf/kbPerf";
import { queryClient } from "../../lib/queryClient";
import type {
  KBCatalogEntry,
  KBSearchResult,
  KBSource,
  KBSourceCreate,
  KBSourceUpdate,
  KBTreeNode,
  KBAddCommunityRequest,
  KBAddCustomGitRequest,
  SearchSortBy,
  SearchSortDir,
  TreeSortOrder,
} from "../../types/kb";
import type { TabSlice } from "./tabSlice";
import type { DocSlice } from "./docSlice";
import type { NavSlice } from "./navSlice";
import type { PaneSlice } from "./paneSlice";

// ---------------------------------------------------------------------------
// Tree slice -- sidebar state: sources, tree, search, tags, bookmarks, etc.
// ---------------------------------------------------------------------------

/** Recursively search a tree for a doc by ID, return its relative_path or null. */
function findDocInTree(node: KBTreeNode, docId: string): string | null {
  for (const doc of node.docs) {
    if (doc.id === docId) return doc.relative_path;
  }
  for (const child of node.children) {
    const found = findDocInTree(child, docId);
    if (found) return found;
  }
  return null;
}

function upsertSource(sources: KBSource[], source: KBSource) {
  const existingIndex = sources.findIndex((candidate) => candidate.id === source.id);
  if (existingIndex === -1) {
    return [source, ...sources];
  }

  const next = [...sources];
  next[existingIndex] = source;
  return next;
}

function setSourcesCache(
  projectId: string | undefined,
  updater: KBSource[] | ((sources: KBSource[]) => KBSource[]),
) {
  queryClient.setQueryData<KBSource[]>(
    kbSourceQueryKeys.list(projectId),
    (current = []) =>
      typeof updater === "function"
        ? (updater as (sources: KBSource[]) => KBSource[])(current)
        : updater,
  );
}

const getPerfNow = () => globalThis.performance?.now?.() ?? Date.now();

export interface TreeSlice {
  // Source state
  sources: KBSource[];
  catalog: KBCatalogEntry[];

  // Search state
  searchQuery: string;
  searchResults: KBSearchResult[];
  recentSearches: string[];
  isSearching: boolean;
  searchTotal: number;
  searchSortBy: SearchSortBy;
  searchSortDir: SearchSortDir;
  searchFocusRequested: boolean;
  caseSensitive: boolean;
  showSearchOptions: boolean;
  isSearchInputFocused: boolean;
  pendingPrefix: string | null;

  // Tree / sidebar state
  expandedFolders: string[];
  sidebarCollapsed: boolean;
  activeTag: string | null;
  treeData: KBTreeNode | null;
  isTreeLoading: boolean;
  treesPerSource: Record<string, KBTreeNode>;
  treeLoadingSet: string[];
  expandedSources: string[];
  treeSortOrder: TreeSortOrder;

  // Reveal in navigation
  highlightDocId: string | null;

  // Bookmark state (session-only, backend is source of truth)
  bookmarkIds: string[];
  bookmarksLoaded: boolean;

  // UI state
  isLoading: boolean;
  isCatalogLoading: boolean;
  error: string | null;

  // Source actions
  fetchSources: (projectId?: string) => Promise<void>;
  fetchCatalog: () => Promise<void>;
  createLocalSource: (data: KBSourceCreate) => Promise<void>;
  addCommunitySource: (data: KBAddCommunityRequest) => Promise<void>;
  addCustomGitSource: (data: KBAddCustomGitRequest) => Promise<void>;
  updateSource: (sourceId: string, data: KBSourceUpdate) => Promise<void>;
  deleteSource: (sourceId: string) => Promise<void>;
  deleteSourceWithCleanup: (sourceId: string, deleteFiles: boolean) => Promise<void>;
  deleteCommunityByUrl: (remoteUrl: string) => Promise<void>;
  syncSource: (sourceId: string) => Promise<void>;
  triggerIndex: (sourceId: string) => Promise<void>;

  // Search actions
  setSearchQuery: (query: string) => void;
  setSearchResults: (results: KBSearchResult[], total?: number) => void;
  addRecentSearch: (query: string) => void;
  clearRecentSearches: () => void;
  removeRecentSearch: (query: string) => void;
  searchDocs: (query: string, limit?: number) => Promise<void>;
  setSearchSortBy: (sortBy: SearchSortBy) => void;
  setSearchSortDir: (dir: SearchSortDir) => void;
  requestSearchFocus: () => void;
  toggleCaseSensitive: () => void;
  toggleShowSearchOptions: () => void;
  setSearchInputFocused: (focused: boolean) => void;
  setPendingPrefix: (prefix: string | null) => void;

  // Tree / sidebar actions
  toggleFolder: (folderId: string) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setActiveTag: (tag: string | null) => void;
  fetchTree: (sourceId?: string) => Promise<void>;
  fetchTreeForSource: (sourceId: string) => Promise<void>;
  toggleSourceExpanded: (sourceId: string) => void;
  hydrateExpandedTrees: () => void;
  cycleTreeSortOrder: () => void;
  collapseAllFolders: () => void;

  // Reveal actions
  clearHighlight: () => void;
  revealInNavigation: (docId: string) => void;

  // Bookmark actions
  fetchBookmarks: () => Promise<void>;
  toggleBookmark: (docId: string) => Promise<void>;
  isBookmarked: (docId: string) => boolean;

  // UI actions
  clearError: () => void;
}

type CombinedState = TabSlice & DocSlice & NavSlice & TreeSlice & PaneSlice;

export const createTreeSlice: StateCreator<
  CombinedState,
  [],
  [],
  TreeSlice
> = (set, get) => ({
  // Source state defaults
  sources: [],
  catalog: [],

  // Search state defaults
  searchQuery: "",
  searchResults: [],
  recentSearches: [],
  isSearching: false,
  searchTotal: 0,
  searchSortBy: "relevance" as SearchSortBy,
  searchSortDir: "desc" as SearchSortDir,
  searchFocusRequested: false,
  caseSensitive: false,
  showSearchOptions: true,
  isSearchInputFocused: false,
  pendingPrefix: null,

  // Tree / sidebar defaults
  expandedFolders: [],
  sidebarCollapsed: false,
  activeTag: null,
  treeData: null,
  isTreeLoading: false,
  treesPerSource: {},
  treeLoadingSet: [],
  expandedSources: [],
  treeSortOrder: "name-asc" as TreeSortOrder,

  // Reveal defaults
  highlightDocId: null,

  // Bookmark defaults
  bookmarkIds: [],
  bookmarksLoaded: false,

  // UI defaults
  isLoading: false,
  isCatalogLoading: false,
  error: null,

  // Source actions
  fetchSources: async (projectId?) => {
    set({ isLoading: true, error: null });
    try {
      const sources = await kbApi.listSources(projectId);
      setSourcesCache(projectId, sources);
      set({ sources, isLoading: false });
    } catch (err: unknown) {
      const message = mapKBSourcesError(err);
      set({ error: message, isLoading: false });
    }
  },

  fetchCatalog: async () => {
    set({ isCatalogLoading: true });
    try {
      const catalog = await kbApi.getCatalog();
      set({ catalog, isCatalogLoading: false });
    } catch {
      set({ isCatalogLoading: false });
    }
  },

  createLocalSource: async (data) => {
    const source = await kbApi.createSource(data);
    setSourcesCache(undefined, (current) => upsertSource(current, source));
    set((state) => ({ sources: [source, ...state.sources] }));
    get().triggerIndex(source.id);
  },

  addCommunitySource: async (data) => {
    const source = await kbApi.addCommunitySource(data);
    setSourcesCache(undefined, (current) => upsertSource(current, source));
    set((state) => ({ sources: [source, ...state.sources] }));
    get().triggerIndex(source.id);
  },

  addCustomGitSource: async (data) => {
    const source = await kbApi.addCustomGitSource(data);
    setSourcesCache(undefined, (current) => upsertSource(current, source));
    set((state) => ({ sources: [source, ...state.sources] }));
    get().triggerIndex(source.id);
  },

  updateSource: async (sourceId, data) => {
    try {
      const updated = await kbApi.updateSource(sourceId, data);
      setSourcesCache(undefined, (current) =>
        current.map((candidate) => (candidate.id === sourceId ? updated : candidate))
      );
      set((state) => ({
        sources: state.sources.map((s) =>
          s.id === sourceId ? updated : s
        ),
      }));
    } catch {
      set({ error: "Failed to update source" });
    }
  },

  triggerIndex: async (sourceId) => {
    setSourcesCache(undefined, (current) =>
      current.map((source) =>
        source.id === sourceId ? { ...source, sync_status: "pending" } : source
      )
    );
    set((state) => ({
      sources: state.sources.map((s) =>
        s.id === sourceId ? { ...s, sync_status: "pending" } : s
      ),
    }));
    try {
      await kbApi.triggerIndex(sourceId);
    } catch {
      // Index trigger is best-effort; status will refresh on next fetch
    }
  },

  deleteSource: async (sourceId) => {
    await kbApi.deleteSource(sourceId);
    setSourcesCache(undefined, (current) =>
      current.filter((source) => source.id !== sourceId)
    );
    set((state) => ({
      sources: state.sources.filter((s) => s.id !== sourceId),
    }));
  },

  deleteSourceWithCleanup: async (sourceId, deleteFiles) => {
    await kbApi.deleteSourceWithFiles(sourceId, deleteFiles);
    setSourcesCache(undefined, (current) =>
      current.filter((source) => source.id !== sourceId)
    );
    set((state) => ({
      sources: state.sources.filter((s) => s.id !== sourceId),
    }));
  },

  deleteCommunityByUrl: async (remoteUrl) => {
    const toDelete = get().sources.filter(
      (s) => s.source_type === "community" && s.remote_url === remoteUrl
    );
    await Promise.all(toDelete.map((s) => kbApi.deleteSource(s.id)));
    setSourcesCache(undefined, (current) =>
      current.filter(
        (source) =>
          !(source.source_type === "community" && source.remote_url === remoteUrl)
      )
    );
    set((state) => ({
      sources: state.sources.filter(
        (s) =>
          !(s.source_type === "community" && s.remote_url === remoteUrl)
      ),
    }));
  },

  syncSource: async (sourceId) => {
    const syncStartedAt = getPerfNow();
    setSourcesCache(undefined, (current) =>
      current.map((source) =>
        source.id === sourceId ? { ...source, sync_status: "pending" } : source
      )
    );
    set((state) => ({
      sources: state.sources.map((s) =>
        s.id === sourceId ? { ...s, sync_status: "pending" } : s
      ),
    }));

    try {
      const { task_id } = await kbApi.triggerSync(sourceId);

      const poll = setInterval(async () => {
        try {
          const status = await kbApi.getSyncStatus(task_id);
          if (status.status === "completed") {
            clearInterval(poll);
            recordKBPerfSample({
              operation: "kb.sync.total",
              durationMs: getPerfNow() - syncStartedAt,
              status: "success",
              metadata: {
                sourceId,
                taskId: task_id,
                serverDurationMs: status.stats?.duration_ms ?? null,
              },
            });
            setSourcesCache(undefined, (current) =>
              current.map((source) =>
                source.id === sourceId
                  ? {
                      ...source,
                      sync_status: "completed",
                      last_synced_at: new Date().toISOString(),
                    }
                  : source
              )
            );
            set((state) => ({
              sources: state.sources.map((s) =>
                s.id === sourceId
                  ? { ...s, sync_status: "completed", last_synced_at: new Date().toISOString() }
                  : s
              ),
            }));
            toast.success("Sync complete");
          } else if (status.status === "failed") {
            clearInterval(poll);
            recordKBPerfSample({
              operation: "kb.sync.total",
              durationMs: getPerfNow() - syncStartedAt,
              status: "error",
              metadata: {
                sourceId,
                taskId: task_id,
                serverDurationMs: status.stats?.duration_ms ?? null,
              },
            });
            setSourcesCache(undefined, (current) =>
              current.map((source) =>
                source.id === sourceId ? { ...source, sync_status: "failed" } : source
              )
            );
            set((state) => ({
              sources: state.sources.map((s) =>
                s.id === sourceId ? { ...s, sync_status: "failed" } : s
              ),
            }));
            toast.error("Sync failed", {
              description: status.error ?? "Unknown error",
            });
          }
        } catch (error) {
          clearInterval(poll);
          recordKBPerfSample({
            operation: "kb.sync.total",
            durationMs: getPerfNow() - syncStartedAt,
            status: "error",
            metadata: {
              sourceId,
              taskId: task_id,
            },
          });
          setSourcesCache(undefined, (current) =>
            current.map((source) =>
              source.id === sourceId ? { ...source, sync_status: "failed" } : source
            )
          );
          set((state) => ({
            sources: state.sources.map((s) =>
              s.id === sourceId ? { ...s, sync_status: "failed" } : s
            ),
          }));
          showApiErrorToast(
            "Sync failed",
            error,
            "Could not refresh sync status.",
          );
        }
      }, 2000);
    } catch (error) {
      recordKBPerfSample({
        operation: "kb.sync.total",
        durationMs: getPerfNow() - syncStartedAt,
        status: "error",
        metadata: {
          sourceId,
        },
      });
      setSourcesCache(undefined, (current) =>
        current.map((source) =>
          source.id === sourceId ? { ...source, sync_status: "failed" } : source
        )
      );
      set((state) => ({
        sources: state.sources.map((s) =>
          s.id === sourceId ? { ...s, sync_status: "failed" } : s
        ),
      }));
      showApiErrorToast(
        "Failed to start sync",
        error,
        "Could not start the source sync.",
      );
    }
  },

  // Search actions
  setSearchQuery: (query) => set({ searchQuery: query }),

  setSearchResults: (results, total?) =>
    set({
      searchResults: results,
      ...(total !== undefined && { searchTotal: total }),
    }),

  addRecentSearch: (query) =>
    set((state) => ({
      recentSearches: [
        query,
        ...state.recentSearches.filter((q) => q !== query),
      ].slice(0, 10),
    })),

  clearRecentSearches: () => set({ recentSearches: [] }),

  removeRecentSearch: (query) =>
    set((state) => ({
      recentSearches: state.recentSearches.filter((q) => q !== query),
    })),

  searchDocs: async (query, limit = 8) => {
    set({ isSearching: true });
    try {
      const { searchSortBy, searchSortDir } = get();
      const response = await kbApi.search(query, undefined, limit, searchSortBy, searchSortDir);
      set({
        searchResults: response.items,
        searchTotal: response.total,
        searchQuery: query,
        isSearching: false,
      });
    } catch {
      set({ isSearching: false });
    }
  },

  setSearchSortBy: (sortBy) => {
    const defaultDirs: Record<SearchSortBy, SearchSortDir> = {
      relevance: "desc",
      filename: "asc",
      modified: "desc",
      created: "desc",
    };
    set({ searchSortBy: sortBy, searchSortDir: defaultDirs[sortBy] ?? "desc" });
  },

  setSearchSortDir: (dir) => set({ searchSortDir: dir }),

  requestSearchFocus: () => set({ searchFocusRequested: true }),

  toggleCaseSensitive: () =>
    set((state) => ({ caseSensitive: !state.caseSensitive })),

  toggleShowSearchOptions: () =>
    set((state) => ({ showSearchOptions: !state.showSearchOptions })),

  setSearchInputFocused: (focused) => set({ isSearchInputFocused: focused }),

  setPendingPrefix: (prefix) => set({ pendingPrefix: prefix }),

  // Tree / sidebar actions
  toggleFolder: (folderId) =>
    set((state) => {
      const idx = state.expandedFolders.indexOf(folderId);
      if (idx === -1) {
        return { expandedFolders: [...state.expandedFolders, folderId] };
      }
      return {
        expandedFolders: state.expandedFolders.filter((id) => id !== folderId),
      };
    }),

  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

  setActiveTag: (tag) => {
    const current = get().activeTag;
    set({ activeTag: tag === current ? null : tag });
  },

  fetchTree: async (sourceId?) => {
    set({ isTreeLoading: true });
    try {
      const tag = get().activeTag ?? undefined;
      const treeData = await kbApi.getTree(sourceId, tag);
      set({ treeData, isTreeLoading: false });
    } catch {
      set({ isTreeLoading: false });
    }
  },

  fetchTreeForSource: async (sourceId) => {
    const current = get().treeLoadingSet;
    if (current.includes(sourceId)) return;
    set({ treeLoadingSet: [...current, sourceId] });
    try {
      const tag = get().activeTag ?? undefined;
      const tree = await kbApi.getTree(sourceId, tag);
      set((state) => ({
        treesPerSource: { ...state.treesPerSource, [sourceId]: tree },
        treeLoadingSet: state.treeLoadingSet.filter((id) => id !== sourceId),
      }));
    } catch {
      set((state) => ({
        treeLoadingSet: state.treeLoadingSet.filter((id) => id !== sourceId),
      }));
    }
  },

  toggleSourceExpanded: (sourceId) => {
    const expanded = get().expandedSources;
    const idx = expanded.indexOf(sourceId);
    if (idx === -1) {
      set({ expandedSources: [...expanded, sourceId] });
      if (!get().treesPerSource[sourceId]) {
        get().fetchTreeForSource(sourceId);
      }
    } else {
      set({ expandedSources: expanded.filter((id) => id !== sourceId) });
    }
  },

  hydrateExpandedTrees: () => {
    const { expandedSources, treesPerSource, fetchTreeForSource } = get();
    for (const sourceId of expandedSources) {
      if (!treesPerSource[sourceId]) {
        fetchTreeForSource(sourceId);
      }
    }
  },

  cycleTreeSortOrder: () => {
    const order = get().treeSortOrder;
    const next: Record<TreeSortOrder, TreeSortOrder> = {
      "name-asc": "name-desc",
      "name-desc": "modified-desc",
      "modified-desc": "name-asc",
    };
    set({ treeSortOrder: next[order] });
  },

  collapseAllFolders: () => set({ expandedFolders: [] }),

  // Reveal actions
  clearHighlight: () => set({ highlightDocId: null }),

  revealInNavigation: (docId) => {
    const state = get();

    let sourceId: string | null = null;
    let relativePath: string | null = null;

    const cached = state.docCache[docId];
    if (cached) {
      sourceId = cached.source?.id ?? cached.source_id;
      relativePath = cached.relative_path;
    }

    if (!sourceId) {
      for (const [sid, tree] of Object.entries(state.treesPerSource)) {
        const found = findDocInTree(tree, docId);
        if (found) {
          sourceId = sid;
          relativePath = found;
          break;
        }
      }
    }

    if (!sourceId) return;

    const expanded = state.expandedSources;
    if (!expanded.includes(sourceId)) {
      set({ expandedSources: [...expanded, sourceId] });
    }

    if (!state.treesPerSource[sourceId]) {
      get().fetchTreeForSource(sourceId);
    }

    if (relativePath) {
      const parts = relativePath.split("/");
      parts.pop();
      const ancestors: string[] = [];
      for (let i = 0; i < parts.length; i++) {
        ancestors.push(parts.slice(0, i + 1).join("/"));
      }

      if (ancestors.length > 0) {
        const currentFolders = get().expandedFolders;
        const toAdd = ancestors.filter((a) => !currentFolders.includes(a));
        if (toAdd.length > 0) {
          set({ expandedFolders: [...currentFolders, ...toAdd] });
        }
      }
    }

    set({ highlightDocId: docId });
    setTimeout(() => {
      if (get().highlightDocId === docId) {
        set({ highlightDocId: null });
      }
    }, 2000);
  },

  // Bookmark actions
  fetchBookmarks: async () => {
    try {
      const bookmarks = await kbApi.listBookmarks();
      set({
        bookmarkIds: bookmarks.map((b) => b.doc_id),
        bookmarksLoaded: true,
      });
    } catch {
      // Silently fail -- bookmarks are non-critical
    }
  },

  toggleBookmark: async (docId) => {
    const { bookmarkIds } = get();
    const isBookmarked = bookmarkIds.includes(docId);

    if (isBookmarked) {
      set({ bookmarkIds: bookmarkIds.filter((id) => id !== docId) });
    } else {
      set({ bookmarkIds: [...bookmarkIds, docId] });
    }

    try {
      if (isBookmarked) {
        await kbApi.removeBookmark(docId);
        toast.success("Bookmark removed");
      } else {
        await kbApi.addBookmark(docId);
        toast.success("Bookmarked");
      }
    } catch (error) {
      set({ bookmarkIds });
      showApiErrorToast(
        isBookmarked ? "Failed to remove bookmark" : "Failed to bookmark",
        error,
        isBookmarked
          ? "Could not remove this bookmark."
          : "Could not bookmark this document.",
      );
    }
  },

  isBookmarked: (docId) => get().bookmarkIds.includes(docId),

  // UI actions
  clearError: () => set({ error: null }),
});
