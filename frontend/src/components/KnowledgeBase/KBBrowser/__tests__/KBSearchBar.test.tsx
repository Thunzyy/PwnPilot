/**
 * KBSearchBar Tests (SEARCH-01 overlay mode)
 *
 * Validates: debounced search, Escape clears query, clear button,
 * store integration (searchQuery, searchResults, isSearching).
 *
 * Note: Result rendering is now handled by KBSearchOverlay (not the search bar).
 * These tests focus on the search bar's input behavior and store-driving logic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, act, cleanup } from "@testing-library/react";

import { useKBStore } from "@/stores/kbStore";
import { kbApi } from "@/api/kb";
import type { KBSearchResponse } from "@/types/kb";

import { KBSearchBar } from "../KBSearchBar";
import { makeSearchResult, makeSource } from "./helpers";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/api/kb", () => ({
  kbApi: {
    search: vi.fn(),
  },
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ sourceId: "source-1" }),
}));

const mockedSearch = vi.mocked(kbApi.search);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  useKBStore.setState({
    sources: [makeSource()],
    searchResults: [],
    recentSearches: [],
    searchQuery: "",
    isSearching: false,
    searchSortBy: "relevance",
    searchSortDir: "desc",
    searchTotal: 0,
  });
}

function renderSearchBar(onSelectResult = vi.fn()) {
  return {
    onSelectResult,
    ...render(
      <KBSearchBar sourceId="source-1" onSelectResult={onSelectResult} />,
    ),
  };
}

/** Advance fake timers past the 300ms debounce, then switch to real timers. */
async function flushDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(350);
  });
  // Switch to real timers so waitFor() polling works
  vi.useRealTimers();
}

/** Type into the search input and flush the debounce. */
async function typeAndFlush(
  input: HTMLElement,
  value: string,
) {
  vi.useFakeTimers();
  fireEvent.change(input, { target: { value } });
  await flushDebounce();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("KBSearchBar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
    mockedSearch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  // -----------------------------------------------------------------------
  // Search input
  // -----------------------------------------------------------------------
  describe("search input", () => {
    it("renders search input with placeholder", () => {
      const { getByPlaceholderText } = renderSearchBar();
      expect(getByPlaceholderText("Search all sources...")).toBeTruthy();
    });

    it("shows clear button when query is non-empty", () => {
      const { getByPlaceholderText, getByLabelText } = renderSearchBar();
      const input = getByPlaceholderText("Search all sources...");

      fireEvent.change(input, { target: { value: "nmap" } });
      expect(getByLabelText("Clear search")).toBeTruthy();
    });

    it("clears input and store when clear button clicked", () => {
      const { getByPlaceholderText, getByLabelText } = renderSearchBar();
      const input = getByPlaceholderText(
        "Search all sources...",
      ) as HTMLInputElement;

      fireEvent.change(input, { target: { value: "nmap" } });
      fireEvent.click(getByLabelText("Clear search"));

      expect(input.value).toBe("");
      expect(useKBStore.getState().searchQuery).toBe("");
    });
  });

  // -----------------------------------------------------------------------
  // Debounced search
  // -----------------------------------------------------------------------
  describe("debounced search", () => {
    it("calls API with limit=100 and sortBy after debounce delay", async () => {
      const response: KBSearchResponse = {
        items: [makeSearchResult()],
        query: "nmap",
        total: 1,
      };
      mockedSearch.mockResolvedValue(response);

      const { getByPlaceholderText } = renderSearchBar();
      const input = getByPlaceholderText("Search all sources...");

      fireEvent.change(input, { target: { value: "nmap" } });

      // Not called yet (debounce pending)
      expect(mockedSearch).not.toHaveBeenCalled();

      // Advance past debounce and switch to real timers
      await flushDebounce();

      await waitFor(() => {
        expect(mockedSearch).toHaveBeenCalledWith(
          "nmap",
          "source-1",
          100,
          "relevance",
          "desc",
        );
      });
    });

    it("updates store with results and total", async () => {
      const results = [
        makeSearchResult({ id: "r1", title: "Nmap Cheatsheet" }),
        makeSearchResult({ id: "r2", title: "Nmap Scripts" }),
      ];
      mockedSearch.mockResolvedValue({
        items: results,
        query: "nmap",
        total: 42,
      });

      const { getByPlaceholderText } = renderSearchBar();
      const input = getByPlaceholderText("Search all sources...");

      await typeAndFlush(input, "nmap");

      await waitFor(() => {
        const state = useKBStore.getState();
        expect(state.searchResults).toHaveLength(2);
        expect(state.searchTotal).toBe(42);
        expect(state.searchQuery).toBe("nmap");
      });
    });

    it("does not call API for empty query after clearing", async () => {
      const response: KBSearchResponse = {
        items: [makeSearchResult()],
        query: "nmap",
        total: 1,
      };
      mockedSearch.mockResolvedValue(response);

      const { getByPlaceholderText } = renderSearchBar();
      const input = getByPlaceholderText("Search all sources...");

      // Type "nmap" and flush debounce
      await typeAndFlush(input, "nmap");

      await waitFor(() => {
        expect(mockedSearch).toHaveBeenCalledTimes(1);
      });

      // Clear input and flush debounce
      await typeAndFlush(input, "");

      // Give time for any pending effects
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // Should not have been called again
      expect(mockedSearch).toHaveBeenCalledTimes(1);
    });

    it("adds query to recent searches on successful search", async () => {
      mockedSearch.mockResolvedValue({
        items: [makeSearchResult()],
        query: "nmap",
        total: 1,
      });

      const { getByPlaceholderText } = renderSearchBar();
      const input = getByPlaceholderText("Search all sources...");

      await typeAndFlush(input, "nmap");

      await waitFor(() => {
        expect(useKBStore.getState().recentSearches).toContain("nmap");
      });
    });
  });

  // -----------------------------------------------------------------------
  // Keyboard: Escape
  // -----------------------------------------------------------------------
  describe("keyboard", () => {
    it("Escape clears query and store search state", async () => {
      mockedSearch.mockResolvedValue({
        items: [makeSearchResult()],
        query: "nmap",
        total: 1,
      });

      const { getByPlaceholderText } = renderSearchBar();
      const input = getByPlaceholderText(
        "Search all sources...",
      ) as HTMLInputElement;

      await typeAndFlush(input, "nmap");

      await waitFor(() => {
        expect(mockedSearch).toHaveBeenCalled();
      });

      fireEvent.keyDown(input, { key: "Escape" });

      expect(input.value).toBe("");
      expect(useKBStore.getState().searchQuery).toBe("");
      expect(useKBStore.getState().searchResults).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Sort integration
  // -----------------------------------------------------------------------
  describe("sort integration", () => {
    it("re-fires search when searchSortBy changes", async () => {
      mockedSearch.mockResolvedValue({
        items: [makeSearchResult()],
        query: "nmap",
        total: 1,
      });

      const { getByPlaceholderText } = renderSearchBar();
      const input = getByPlaceholderText("Search all sources...");

      await typeAndFlush(input, "nmap");

      await waitFor(() => {
        expect(mockedSearch).toHaveBeenCalledTimes(1);
      });

      // Change sort in store -- should re-trigger search
      act(() => {
        useKBStore.getState().setSearchSortBy("filename");
      });

      await waitFor(() => {
        expect(mockedSearch).toHaveBeenCalledWith(
          "nmap",
          "source-1",
          100,
          "filename",
          "asc",
        );
      });
    });
  });
});
