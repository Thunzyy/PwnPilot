import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

const { apiMock, recordKBPerfSampleMock } = vi.hoisted(() => ({
  apiMock: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  recordKBPerfSampleMock: vi.fn(),
}));

vi.mock("../api/client", () => ({
  api: apiMock,
  API_BASE_URL: "http://localhost:8000",
}));

vi.mock("../lib/perf/kbPerf", () => ({
  recordKBPerfSample: recordKBPerfSampleMock,
  measureKBPerfAsync: async (
    operation: string,
    run: () => Promise<unknown>,
    options?: {
      metadata?: Record<string, unknown>;
      onSuccess?: (result: unknown) => Record<string, unknown> | undefined;
      onError?: (error: unknown) => Record<string, unknown> | undefined;
    }
  ) => {
    try {
      const result = await run();
      recordKBPerfSampleMock({
        operation,
        durationMs: 1,
        status: "success",
        metadata: {
          ...options?.metadata,
          ...options?.onSuccess?.(result),
        },
      });
      return result;
    } catch (error) {
      recordKBPerfSampleMock({
        operation,
        durationMs: 1,
        status: "error",
        metadata: {
          ...options?.metadata,
          ...options?.onError?.(error),
        },
      });
      throw error;
    }
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { useKBStore } from "../stores/kbStore";
import type { KBDocDetail, KBSource, KBTab, PaneState } from "../types/kb";

const initialState = {
  sources: [] as KBSource[],
  activeDocId: null,
  searchQuery: "",
  searchResults: [],
  docCache: {},
  expandedFolders: [] as string[],
  sidebarCollapsed: false,
  openTabs: [] as KBTab[],
  activeTabId: null as string | null,
  isLoading: false,
  error: null,
};

const STORAGE_KEY = "pwnpilot:kb-store";

const resetStore = () => {
  useKBStore.setState(initialState);
  localStorage.removeItem(STORAGE_KEY);
};

const makeSource = (overrides: Partial<KBSource> = {}): KBSource => ({
  id: "src-1",
  name: "Notes",
  source_type: "local",
  origin: null,
  path: "/notes",
  remote_url: null,
  read_only: false,
  include_paths: null,
  user_id: "u-1",
  project_id: "proj-1",
  sync_status: null,
  opsec_warning: null,
  last_synced_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

const makeDoc = (overrides: Partial<KBDocDetail> = {}): KBDocDetail => ({
  id: "doc-1",
  source_id: "src-1",
  title: "Nmap Guide",
  relative_path: "nmap-guide.md",
  tags: null,
  content_hash: null,
  wikilinks: null,
  frontmatter: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  body: "# Nmap",
  backlinks: [],
  source: makeSource(),
  ...overrides,
});

describe("kbStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------
  describe("initial state", () => {
    it("starts with empty sources array and null activeDocId", () => {
      const state = useKBStore.getState();
      expect(state.sources).toEqual([]);
      expect(state.activeDocId).toBeNull();
    });

    it("isLoading is false and error is null", () => {
      const state = useKBStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // fetchSources
  // ---------------------------------------------------------------------------
  describe("fetchSources", () => {
    it("sets isLoading true then false on success with sources populated", async () => {
      const sources = [makeSource(), makeSource({ id: "src-2", name: "KB2" })];
      apiMock.get.mockResolvedValueOnce({ data: sources });

      const promise = useKBStore.getState().fetchSources();

      // isLoading should be true immediately after call
      expect(useKBStore.getState().isLoading).toBe(true);

      await promise;

      const state = useKBStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.sources).toEqual(sources);
      expect(state.error).toBeNull();
    });

    it("sets error message on API failure and isLoading false", async () => {
      apiMock.get.mockRejectedValueOnce(new Error("Network error"));

      await useKBStore.getState().fetchSources();

      const state = useKBStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe("Failed to load KB sources");
      expect(state.sources).toEqual([]);
    });

    it("clears previous error before fetching", async () => {
      // Set an initial error
      useKBStore.setState({ error: "Previous error" });

      apiMock.get.mockResolvedValueOnce({ data: [] });

      const promise = useKBStore.getState().fetchSources();

      // Error should be cleared immediately
      expect(useKBStore.getState().error).toBeNull();

      await promise;
    });

    it("passes projectId as query param when provided", async () => {
      apiMock.get.mockResolvedValueOnce({ data: [] });

      await useKBStore.getState().fetchSources("proj-1");

      expect(apiMock.get).toHaveBeenCalledWith("/kb/sources", {
        params: { project_id: "proj-1" },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // setActiveDoc
  // ---------------------------------------------------------------------------
  describe("setActiveDoc", () => {
    it("sets activeDocId to the provided value", () => {
      useKBStore.getState().setActiveDoc("doc-42");
      expect(useKBStore.getState().activeDocId).toBe("doc-42");
    });

    it("clears activeDocId when called with null", () => {
      useKBStore.setState({ activeDocId: "doc-42" });
      useKBStore.getState().setActiveDoc(null);
      expect(useKBStore.getState().activeDocId).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Search state
  // ---------------------------------------------------------------------------
  describe("search state", () => {
    it("setSearchQuery updates searchQuery", () => {
      useKBStore.getState().setSearchQuery("nmap scan");
      expect(useKBStore.getState().searchQuery).toBe("nmap scan");
    });

    it("setSearchResults updates searchResults array", () => {
      const results = [
        {
          id: "r1",
          title: "Result 1",
          relative_path: "r1.md",
          source_id: "src-1",
          tags: null,
          snippet: "...nmap...",
          rank: 1.5,
        },
      ];
      useKBStore.getState().setSearchResults(results);
      expect(useKBStore.getState().searchResults).toEqual(results);
    });
  });

  // ---------------------------------------------------------------------------
  // Doc cache
  // ---------------------------------------------------------------------------
  describe("doc cache", () => {
    it("cacheDoc adds a document to docCache keyed by id", () => {
      const doc = makeDoc();
      useKBStore.getState().cacheDoc(doc);

      expect(useKBStore.getState().docCache["doc-1"]).toEqual(doc);
    });

    it("getCachedDoc returns cached document by id", () => {
      const doc = makeDoc({ id: "doc-99" });
      useKBStore.getState().cacheDoc(doc);

      const cached = useKBStore.getState().getCachedDoc("doc-99");
      expect(cached).toEqual(doc);
    });

    it("getCachedDoc returns undefined for non-cached id", () => {
      const cached = useKBStore.getState().getCachedDoc("nonexistent");
      expect(cached).toBeUndefined();
    });

    it("invalidateCache clears the entire docCache", () => {
      useKBStore.getState().cacheDoc(makeDoc({ id: "d1" }));
      useKBStore.getState().cacheDoc(makeDoc({ id: "d2" }));

      expect(Object.keys(useKBStore.getState().docCache)).toHaveLength(2);

      useKBStore.getState().invalidateCache();
      expect(useKBStore.getState().docCache).toEqual({});
    });
  });

  // ---------------------------------------------------------------------------
  // Folder expansion
  // ---------------------------------------------------------------------------
  describe("folder expansion", () => {
    it("toggleFolder adds folder id to expandedFolders", () => {
      useKBStore.getState().toggleFolder("folder-a");
      expect(useKBStore.getState().expandedFolders).toContain("folder-a");
    });

    it("toggleFolder removes folder id when already expanded", () => {
      useKBStore.getState().toggleFolder("folder-a");
      expect(useKBStore.getState().expandedFolders).toContain("folder-a");

      useKBStore.getState().toggleFolder("folder-a");
      expect(useKBStore.getState().expandedFolders).not.toContain("folder-a");
    });
  });

  // ---------------------------------------------------------------------------
  // Persistence (partialize)
  // ---------------------------------------------------------------------------
  describe("persistence", () => {
    const getPersisted = () => {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    };

    it("persists activeDocId to localStorage", () => {
      useKBStore.getState().setActiveDoc("doc-persisted");

      const stored = getPersisted();
      expect(stored.state.activeDocId).toBe("doc-persisted");
    });

    it("does NOT persist searchQuery (session-only state)", () => {
      useKBStore.getState().setSearchQuery("gobuster");

      const stored = getPersisted();
      expect(stored.state.searchQuery).toBeUndefined();
    });

    it("persists expandedFolders to localStorage", () => {
      useKBStore.getState().toggleFolder("f1");
      useKBStore.getState().toggleFolder("f2");

      const stored = getPersisted();
      expect(stored.state.expandedFolders).toEqual(["f1", "f2"]);
    });

    it("does NOT persist sidebarCollapsed (panel layout handles persistence)", () => {
      useKBStore.getState().setSidebarCollapsed(true);

      const stored = getPersisted();
      expect(stored.state).not.toHaveProperty("sidebarCollapsed");
    });

    it("does NOT persist sources (transient API data)", async () => {
      apiMock.get.mockResolvedValueOnce({ data: [makeSource()] });
      await useKBStore.getState().fetchSources();

      const stored = getPersisted();
      expect(stored.state).not.toHaveProperty("sources");
    });

    it("does NOT persist isLoading or error (transient UI state)", () => {
      useKBStore.setState({ isLoading: true, error: "some error" });

      // Trigger persistence by changing a persisted field
      useKBStore.getState().setActiveDoc("trigger");

      const stored = getPersisted();
      expect(stored.state).not.toHaveProperty("isLoading");
      expect(stored.state).not.toHaveProperty("error");
    });

    it("does NOT persist docCache (can grow large)", () => {
      useKBStore.getState().cacheDoc(makeDoc());

      // Trigger persistence by changing a persisted field
      useKBStore.getState().setActiveDoc("trigger");

      const stored = getPersisted();
      expect(stored.state).not.toHaveProperty("docCache");
    });
  });

  // ---------------------------------------------------------------------------
  // clearError
  // ---------------------------------------------------------------------------
  describe("clearError", () => {
    it("clears error to null", () => {
      useKBStore.setState({ error: "Something went wrong" });
      useKBStore.getState().clearError();
      expect(useKBStore.getState().error).toBeNull();
    });
  });

  describe("syncSource", () => {
    it("shows backend details when sync cannot start", async () => {
      useKBStore.setState({
        sources: [makeSource({ id: "src-1", sync_status: null })],
      });
      apiMock.post.mockRejectedValueOnce({
        response: {
          data: {
            detail: "Indexer worker is not reachable.",
          },
        },
      });

      await useKBStore.getState().syncSource("src-1");

      expect(toast.error).toHaveBeenCalledWith("Failed to start sync", {
        description: "Indexer worker is not reachable.",
      });
    });

    it("records an end-to-end sync metric when polling completes", async () => {
      vi.useFakeTimers();
      useKBStore.setState({
        sources: [makeSource({ id: "src-1", sync_status: null })],
      });
      apiMock.post.mockResolvedValueOnce({
        data: { task_id: "task-1", status: "pending" },
      });
      apiMock.get.mockResolvedValueOnce({
        data: {
          task_id: "task-1",
          status: "completed",
          source_id: "src-1",
          started_at: 1,
          stats: {
            added: 1,
            updated: 0,
            deleted: 0,
            errors: [],
            duration_ms: 640,
          },
          error: null,
        },
      });

      await useKBStore.getState().syncSource("src-1");
      await vi.advanceTimersByTimeAsync(2000);

      expect(recordKBPerfSampleMock).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "kb.sync.total",
          status: "success",
          metadata: expect.objectContaining({
            sourceId: "src-1",
            serverDurationMs: 640,
          }),
        })
      );
    });
  });

  describe("document error feedback", () => {
    it("shows backend details when rename fails unexpectedly", async () => {
      apiMock.post.mockRejectedValueOnce({
        response: {
          status: 500,
          data: {
            error: {
              message: "Filesystem rename failed on the vault path.",
            },
          },
        },
      });

      await expect(
        useKBStore.getState().renameDoc("doc-1", "renamed.md"),
      ).rejects.toBeDefined();

      expect(toast.error).toHaveBeenCalledWith("Failed to rename document", {
        description: "Filesystem rename failed on the vault path.",
      });
    });

    it("shows backend details when delete fails", async () => {
      apiMock.delete.mockRejectedValueOnce({
        response: {
          data: {
            message: "Document is locked by another sync job.",
          },
        },
      });

      await useKBStore.getState().deleteDoc("doc-1");

      expect(toast.error).toHaveBeenCalledWith("Failed to delete document", {
        description: "Document is locked by another sync job.",
      });
    });
  });

  // ---------------------------------------------------------------------------
  // setSidebarCollapsed
  // ---------------------------------------------------------------------------
  describe("setSidebarCollapsed", () => {
    it("sets sidebarCollapsed to true", () => {
      useKBStore.getState().setSidebarCollapsed(true);
      expect(useKBStore.getState().sidebarCollapsed).toBe(true);
    });

    it("sets sidebarCollapsed to false", () => {
      useKBStore.setState({ sidebarCollapsed: true });
      useKBStore.getState().setSidebarCollapsed(false);
      expect(useKBStore.getState().sidebarCollapsed).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Tab management
  // ---------------------------------------------------------------------------
  describe("tab management", () => {
    // ---- Initial state ----
    describe("initial state", () => {
      it("openTabs is empty and activeTabId is null", () => {
        const state = useKBStore.getState();
        expect(state.openTabs).toEqual([]);
        expect(state.activeTabId).toBeNull();
      });
    });

    // ---- openTab ----
    describe("openTab", () => {
      it("opens a new tab and sets it as active", () => {
        useKBStore.getState().openTab("doc-1", "Nmap Guide", "src-1");

        const state = useKBStore.getState();
        expect(state.openTabs).toHaveLength(1);
        expect(state.openTabs[0]).toEqual({
          id: "doc-1",
          type: "doc",
          docId: "doc-1",
          title: "Nmap Guide",
          sourceId: "src-1",
        });
        expect(state.activeTabId).toBe("doc-1");
        expect(state.activeDocId).toBe("doc-1");
      });

      it("opens multiple tabs and activates the last one", () => {
        const { openTab } = useKBStore.getState();
        openTab("doc-1", "Doc 1", "src-1");
        openTab("doc-2", "Doc 2", "src-1");
        openTab("doc-3", "Doc 3", "src-2");

        const state = useKBStore.getState();
        expect(state.openTabs).toHaveLength(3);
        expect(state.activeTabId).toBe("doc-3");
        expect(state.activeDocId).toBe("doc-3");
      });

      it("does not create duplicate tab for same docId", () => {
        useKBStore.getState().openTab("doc-1", "Doc 1", "src-1");
        useKBStore.getState().openTab("doc-2", "Doc 2", "src-1");
        useKBStore.getState().openTab("doc-1", "Doc 1", "src-1");

        const state = useKBStore.getState();
        expect(state.openTabs).toHaveLength(2);
      });

      it("switches to existing tab when docId already open", () => {
        useKBStore.getState().openTab("doc-1", "Doc 1", "src-1");
        useKBStore.getState().openTab("doc-2", "Doc 2", "src-1");

        // doc-2 is active now
        expect(useKBStore.getState().activeTabId).toBe("doc-2");

        // Re-open doc-1 -- should switch, not create
        useKBStore.getState().openTab("doc-1", "Doc 1", "src-1");

        const state = useKBStore.getState();
        expect(state.openTabs).toHaveLength(2);
        expect(state.activeTabId).toBe("doc-1");
        expect(state.activeDocId).toBe("doc-1");
      });

      it("defaults sourceId to empty string when omitted", () => {
        useKBStore.getState().openTab("doc-1", "Doc 1");

        const state = useKBStore.getState();
        expect(state.openTabs[0].sourceId).toBe("");
      });
    });

    // ---- closeTab ----
    describe("closeTab", () => {
      it("closes the only tab and sets activeTabId and activeDocId to null", () => {
        useKBStore.getState().openTab("doc-1", "Doc 1", "src-1");
        useKBStore.getState().closeTab("doc-1");

        const state = useKBStore.getState();
        expect(state.openTabs).toHaveLength(0);
        expect(state.activeTabId).toBeNull();
        expect(state.activeDocId).toBeNull();
      });

      it("closing active tab activates right neighbor", () => {
        useKBStore.getState().openTab("doc-1", "Doc 1", "src-1");
        useKBStore.getState().openTab("doc-2", "Doc 2", "src-1");
        useKBStore.getState().openTab("doc-3", "Doc 3", "src-1");

        // Switch to middle tab
        useKBStore.getState().setActiveTab("doc-2");

        // Close middle tab -- right neighbor (doc-3) should activate
        useKBStore.getState().closeTab("doc-2");

        const state = useKBStore.getState();
        expect(state.openTabs).toHaveLength(2);
        expect(state.activeTabId).toBe("doc-3");
        expect(state.activeDocId).toBe("doc-3");
      });

      it("closing last active tab activates left neighbor", () => {
        useKBStore.getState().openTab("doc-1", "Doc 1", "src-1");
        useKBStore.getState().openTab("doc-2", "Doc 2", "src-1");

        // doc-2 is active (last opened)
        expect(useKBStore.getState().activeTabId).toBe("doc-2");

        // Close doc-2 (last position) -- left neighbor (doc-1) should activate
        useKBStore.getState().closeTab("doc-2");

        const state = useKBStore.getState();
        expect(state.openTabs).toHaveLength(1);
        expect(state.activeTabId).toBe("doc-1");
        expect(state.activeDocId).toBe("doc-1");
      });

      it("closing non-active tab does not change activeTabId", () => {
        useKBStore.getState().openTab("doc-1", "Doc 1", "src-1");
        useKBStore.getState().openTab("doc-2", "Doc 2", "src-1");
        useKBStore.getState().openTab("doc-3", "Doc 3", "src-1");

        // doc-3 is active
        expect(useKBStore.getState().activeTabId).toBe("doc-3");

        // Close doc-1 (not active)
        useKBStore.getState().closeTab("doc-1");

        const state = useKBStore.getState();
        expect(state.openTabs).toHaveLength(2);
        expect(state.activeTabId).toBe("doc-3");
        expect(state.activeDocId).toBe("doc-3");
      });

      it("closing non-existent tab is a no-op", () => {
        useKBStore.getState().openTab("doc-1", "Doc 1", "src-1");
        useKBStore.getState().closeTab("non-existent");

        const state = useKBStore.getState();
        expect(state.openTabs).toHaveLength(1);
        expect(state.activeTabId).toBe("doc-1");
      });
    });

    // ---- setActiveTab ----
    describe("setActiveTab", () => {
      it("switches active tab and syncs activeDocId", () => {
        useKBStore.getState().openTab("doc-1", "Doc 1", "src-1");
        useKBStore.getState().openTab("doc-2", "Doc 2", "src-1");

        // doc-2 is active
        useKBStore.getState().setActiveTab("doc-1");

        const state = useKBStore.getState();
        expect(state.activeTabId).toBe("doc-1");
        expect(state.activeDocId).toBe("doc-1");
      });

      it("non-existent tab id is a no-op", () => {
        useKBStore.getState().openTab("doc-1", "Doc 1", "src-1");
        useKBStore.getState().setActiveTab("non-existent");

        const state = useKBStore.getState();
        expect(state.activeTabId).toBe("doc-1");
        expect(state.activeDocId).toBe("doc-1");
      });
    });

    // ---- updateTabTitle ----
    describe("updateTabTitle", () => {
      it("updates title of existing tab", () => {
        useKBStore.getState().openTab("doc-1", "Old Title", "src-1");
        useKBStore.getState().updateTabTitle("doc-1", "New Title");

        const state = useKBStore.getState();
        expect(state.openTabs[0].title).toBe("New Title");
        expect(state.openTabs[0].sourceId).toBe("src-1"); // unchanged
      });

      it("updates sourceId when provided", () => {
        useKBStore.getState().openTab("doc-1", "Doc 1", "src-1");
        useKBStore.getState().updateTabTitle("doc-1", "Doc 1", "src-2");

        expect(useKBStore.getState().openTabs[0].sourceId).toBe("src-2");
      });

      it("non-existent tab id is a no-op", () => {
        useKBStore.getState().openTab("doc-1", "Doc 1", "src-1");
        useKBStore.getState().updateTabTitle("non-existent", "Title");

        const state = useKBStore.getState();
        expect(state.openTabs).toHaveLength(1);
        expect(state.openTabs[0].title).toBe("Doc 1");
      });
    });

    // ---- Persistence ----
    describe("persistence", () => {
      const getPersisted = () => {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
      };

      it("persists openTabs to localStorage", () => {
        useKBStore.getState().openTab("doc-1", "Doc 1", "src-1");

        const stored = getPersisted();
        expect(stored.state.openTabs).toHaveLength(1);
        expect(stored.state.openTabs[0].docId).toBe("doc-1");
      });

      it("persists activeTabId to localStorage", () => {
        useKBStore.getState().openTab("doc-1", "Doc 1", "src-1");

        const stored = getPersisted();
        expect(stored.state.activeTabId).toBe("doc-1");
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Pane tab management
  // ---------------------------------------------------------------------------
  describe("pane tab management", () => {
    const makePane = (
      id: string,
      openTabs: KBTab[],
      activeTabId: string | null,
    ): PaneState => {
      const activeTab = openTabs.find((tab) => tab.id === activeTabId);
      return {
        id,
        type: "editor",
        linkedToPaneId: null,
        openTabs,
        activeTabId,
        activeDocId: activeTab?.type === "doc" ? activeTab.docId : null,
        pinnedTabIds: [],
        navStack: [],
        navCursor: -1,
        scrollPositions: {},
      };
    };

    it("closeTabInPane clears last tab in the only pane", () => {
      useKBStore.setState({
        panes: {
          default: makePane(
            "default",
            [{ id: "doc-1", type: "doc", docId: "doc-1", title: "Doc 1", sourceId: "src-1" }],
            "doc-1",
          ),
        },
        focusedPaneId: "default",
        splitDirection: null,
        activeTabId: "doc-1",
        activeDocId: "doc-1",
      });

      useKBStore.getState().closeTabInPane("default", "doc-1");

      const state = useKBStore.getState();
      expect(state.panes.default.openTabs).toEqual([]);
      expect(state.panes.default.activeTabId).toBeNull();
      expect(state.panes.default.activeDocId).toBeNull();
      expect(state.activeTabId).toBeNull();
      expect(state.activeDocId).toBeNull();
    });
  });
});
