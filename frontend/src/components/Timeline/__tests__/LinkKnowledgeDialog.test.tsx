/**
 * LinkKnowledgeDialog Component Tests (LINK-01 linking dialog)
 *
 * Validates: search input rendering, debounced KB search, result display,
 * link creation on click, already-linked indicator, duplicate error handling,
 * and dialog close after successful link.
 *
 * Uses real timers for debounce because React Query scheduling is involved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { kbApi } from "@/api/kb";
import { linkingApi } from "@/api/linking";
import type { KBSearchResponse, KBSearchResult } from "@/types/kb";
import type { LinkedDoc } from "@/types/linking";
import { createQueryClient } from "@/lib/queryClient";

import { LinkKnowledgeDialog } from "../LinkKnowledgeDialog";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/api/kb", () => ({
  kbApi: {
    search: vi.fn(),
  },
}));

vi.mock("@/api/linking", () => ({
  linkingApi: {
    createLink: vi.fn(),
    getEntryDocs: vi.fn(),
  },
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
const mockToastInfo = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
    info: (...args: unknown[]) => mockToastInfo(...args),
  },
}));

const mockedSearch = vi.mocked(kbApi.search);
const mockedCreateLink = vi.mocked(linkingApi.createLink);
const mockedGetEntryDocs = vi.mocked(linkingApi.getEntryDocs);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(overrides?: Partial<KBSearchResult>): KBSearchResult {
  return {
    id: overrides?.id ?? "doc-1",
    title: overrides?.title ?? "Test Doc",
    relative_path: overrides?.relative_path ?? "test/doc.md",
    source_id: overrides?.source_id ?? "source-1",
    tags: overrides?.tags ?? "test",
    snippet: overrides?.snippet ?? "Test snippet",
    rank: overrides?.rank ?? 1.0,
    ...overrides,
  };
}

function makeLinkedDoc(overrides?: Partial<LinkedDoc>): LinkedDoc {
  return {
    doc_id: overrides?.doc_id ?? "doc-1",
    title: overrides?.title ?? "Linked Doc",
    relative_path: overrides?.relative_path ?? "linked.md",
    source_id: overrides?.source_id ?? "source-1",
    ...overrides,
  };
}

function renderDialog(
  overrides?: Partial<{
    entryId: string;
    projectId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onLinked: () => void;
  }>,
) {
  const props = {
    entryId: overrides?.entryId ?? "entry-1",
    projectId: overrides?.projectId ?? "proj-1",
    open: overrides?.open ?? true,
    onOpenChange: overrides?.onOpenChange ?? vi.fn(),
    onLinked: overrides?.onLinked ?? vi.fn(),
  };
  return {
    ...render(
      <QueryClientProvider client={createQueryClient()}>
        <LinkKnowledgeDialog {...props} />
      </QueryClientProvider>
    ),
    ...props,
  };
}

async function flushDebounce() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
}

/** Type into input and flush debounce. */
async function typeAndFlush(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  await flushDebounce();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LinkKnowledgeDialog", () => {
  beforeEach(() => {
    mockedSearch.mockReset();
    mockedCreateLink.mockReset();
    mockedGetEntryDocs.mockReset();
    mockedGetEntryDocs.mockResolvedValue([]);
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
    mockToastInfo.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders search input when open", async () => {
    vi.useRealTimers();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { getByPlaceholderText } = renderDialog({ open: true });

    expect(getByPlaceholderText("Search articles...")).toBeTruthy();

    await waitFor(() => {
      expect(mockedGetEntryDocs).toHaveBeenCalledWith("entry-1");
    });

    const loggedOutput = consoleErrorSpy.mock.calls.flat().map(String).join("\n");
    expect(loggedOutput).not.toContain("not wrapped in act");
  });

  it("searches KB articles on input", async () => {
    const response: KBSearchResponse = {
      items: [makeResult({ title: "Nmap Cheatsheet" })],
      query: "nmap",
      total: 1,
    };
    mockedSearch.mockResolvedValue(response);

    const { getByPlaceholderText } = renderDialog();
    const input = getByPlaceholderText("Search articles...");

    await typeAndFlush(input, "nmap");

    await waitFor(() => {
      expect(mockedSearch).toHaveBeenCalledWith("nmap", undefined, 10);
    });
  });

  it("displays search results", async () => {
    const results = [
      makeResult({ id: "r1", title: "Nmap Cheatsheet" }),
      makeResult({ id: "r2", title: "Gobuster Guide" }),
    ];
    mockedSearch.mockResolvedValue({
      items: results,
      query: "pentest",
      total: 2,
    });

    const { getByPlaceholderText, getByText } = renderDialog();
    const input = getByPlaceholderText("Search articles...");

    await typeAndFlush(input, "pentest");

    await waitFor(() => {
      expect(getByText("Nmap Cheatsheet")).toBeTruthy();
      expect(getByText("Gobuster Guide")).toBeTruthy();
    });
  });

  it("clicking result creates link", async () => {
    mockedSearch.mockResolvedValue({
      items: [makeResult({ id: "doc-42", title: "Target Doc" })],
      query: "target",
      total: 1,
    });
    mockedCreateLink.mockResolvedValue({
      id: "link-1",
      timeline_entry_id: "entry-1",
      doc_id: "doc-42",
      created_at: "2026-01-31T00:00:00Z",
    });

    const onOpenChange = vi.fn();
    const { getByPlaceholderText, getByText } = renderDialog({ onOpenChange });
    const input = getByPlaceholderText("Search articles...");

    await typeAndFlush(input, "target");

    await waitFor(() => {
      expect(getByText("Target Doc")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(getByText("Target Doc"));
    });

    expect(mockedCreateLink).toHaveBeenCalledWith("entry-1", "doc-42");
  });

  it("shows already-linked indicator", async () => {
    // Mock getEntryDocs returning an already-linked doc
    const linkedDocs: LinkedDoc[] = [
      makeLinkedDoc({ doc_id: "doc-linked" }),
    ];
    mockedGetEntryDocs.mockResolvedValue(linkedDocs);

    const searchResults = [
      makeResult({ id: "doc-linked", title: "Already Linked Doc" }),
      makeResult({ id: "doc-new", title: "New Doc" }),
    ];
    mockedSearch.mockResolvedValue({
      items: searchResults,
      query: "doc",
      total: 2,
    });

    const { getByPlaceholderText } = renderDialog();

    // Wait for getEntryDocs to resolve
    await waitFor(() => {
      expect(mockedGetEntryDocs).toHaveBeenCalledWith("entry-1");
    });

    const input = getByPlaceholderText("Search articles...");

    await typeAndFlush(input, "doc");

    // Dialog uses Radix portal, so search in document.body not container
    await waitFor(() => {
      expect(document.body.textContent).toContain("Already Linked Doc");
    });

    // The linked doc button should still exist but have the check indicator
    const resultButtons = document.body.querySelectorAll(
      'button[type="button"]',
    );
    const linkedButton = Array.from(resultButtons).find((b) =>
      b.textContent?.includes("Already Linked Doc"),
    );
    expect(linkedButton).toBeTruthy();

    // Clicking an already-linked doc should show info toast
    await act(async () => {
      fireEvent.click(linkedButton!);
    });

    expect(mockToastInfo).toHaveBeenCalledWith("Already linked");
    expect(mockedCreateLink).not.toHaveBeenCalled();
  });

  it("handles duplicate link error", async () => {
    mockedSearch.mockResolvedValue({
      items: [makeResult({ id: "doc-dup", title: "Duplicate Doc" })],
      query: "dup",
      total: 1,
    });

    // Simulate 409 conflict error
    const error409 = { response: { status: 409 } };
    mockedCreateLink.mockRejectedValue(error409);

    const { getByPlaceholderText, getByText } = renderDialog();
    const input = getByPlaceholderText("Search articles...");

    await typeAndFlush(input, "dup");

    await waitFor(() => {
      expect(getByText("Duplicate Doc")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(getByText("Duplicate Doc"));
    });

    // Should show info toast for 409, not error toast
    expect(mockToastInfo).toHaveBeenCalledWith("Already linked");
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("closes dialog after successful link", async () => {
    mockedSearch.mockResolvedValue({
      items: [makeResult({ id: "doc-close", title: "Close Test Doc" })],
      query: "close",
      total: 1,
    });
    mockedCreateLink.mockResolvedValue({
      id: "link-2",
      timeline_entry_id: "entry-1",
      doc_id: "doc-close",
      created_at: "2026-01-31T00:00:00Z",
    });

    const onOpenChange = vi.fn();
    const onLinked = vi.fn();
    const { getByPlaceholderText, getByText } = renderDialog({
      onOpenChange,
      onLinked,
    });
    const input = getByPlaceholderText("Search articles...");

    await typeAndFlush(input, "close");

    await waitFor(() => {
      expect(getByText("Close Test Doc")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(getByText("Close Test Doc"));
    });

    // Dialog should close
    expect(onOpenChange).toHaveBeenCalledWith(false);

    // onLinked callback should fire
    expect(onLinked).toHaveBeenCalled();

    // Success toast should appear
    expect(mockToastSuccess).toHaveBeenCalledWith("KB article linked");
  });
});
