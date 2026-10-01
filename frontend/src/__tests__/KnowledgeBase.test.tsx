import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { createQueryClient } from "../lib/queryClient";
import { useKBStore } from "../stores/kbStore";
import type { KBTab, PaneState } from "../types/kb";
import { KnowledgeBase } from "../pages/KnowledgeBase";

const mockNavigate = vi.fn();
const { fetchKBSourcesApiMock, kbSourceQueryKeys } = vi.hoisted(() => ({
  fetchKBSourcesApiMock: vi.fn(async () => []),
  kbSourceQueryKeys: {
    list: (projectId?: string | null) => ["kb", "sources", projectId ?? "global"],
  },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("../hooks/useUnsavedChangesGuard", () => ({
  useUnsavedChangesGuard: () => undefined,
}));

vi.mock("../api/kbSources", () => ({
  fetchKBSources: fetchKBSourcesApiMock,
  kbSourceQueryKeys,
  mapKBSourcesError: () => "Failed to load KB sources",
}));

vi.mock("../components/KnowledgeBase/KBResizableLayout", () => ({
  KBResizableLayout: ({ sidebar }: { sidebar: React.ReactNode }) => (
    <div data-testid="kb-layout">{sidebar}</div>
  ),
}));

vi.mock("../components/KnowledgeBase/KBSidebar", () => ({
  KBSidebar: (props: {
    onSelectDoc: (
      docId: string,
      sourceId: string,
      title: string,
      openInNewTab?: boolean,
    ) => void;
  }) => (
    <div data-testid="kb-sidebar">
      <button
        type="button"
        data-testid="select-doc-a"
        onClick={() => props.onSelectDoc("doc-a", "src-1", "Doc A")}
      >
        Select A
      </button>
      <button
        type="button"
        data-testid="select-doc-a-new-tab"
        onClick={() => props.onSelectDoc("doc-a", "src-1", "Doc A", true)}
      >
        Select A New Tab
      </button>
    </div>
  ),
}));

vi.mock("../components/KnowledgeBase/RenameDialog", () => ({
  RenameDialog: () => null,
}));

vi.mock("../components/KnowledgeBase/DeleteConfirmDialog", () => ({
  DeleteConfirmDialog: () => null,
}));

function makePane(openTabs: KBTab[], activeTabId: string | null): PaneState {
  const activeTab = openTabs.find((tab) => tab.id === activeTabId);
  return {
    id: "default",
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
}

function resetPaneState(openTabs: KBTab[], activeTabId: string | null) {
  const pane = makePane(openTabs, activeTabId);
  useKBStore.setState({
    panes: { default: pane },
    focusedPaneId: "default",
    splitDirection: null,
    activeTabId: pane.activeTabId,
    activeDocId: pane.activeDocId,
    fetchSources: vi.fn(() => {
      throw new Error("KnowledgeBase should bootstrap KB sources through React Query");
    }),
    renameDoc: vi.fn().mockResolvedValue(undefined),
    deleteDoc: vi.fn().mockResolvedValue(undefined),
  });
}

function renderKnowledgeBase(path: string, element: React.ReactNode) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>{element}</Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("KnowledgeBase tab selection behavior", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    fetchKBSourcesApiMock.mockClear();
    fetchKBSourcesApiMock.mockResolvedValue([]);
    localStorage.clear();
  });

  it("replaces the current tab instead of duplicating when selected doc is already open", () => {
    resetPaneState(
      [
        { id: "doc-a", type: "doc", docId: "doc-a", title: "Doc A", sourceId: "src-1" },
        { id: "doc-b", type: "doc", docId: "doc-b", title: "Doc B", sourceId: "src-1" },
      ],
      "doc-b",
    );

    renderKnowledgeBase(
      "/notes",
      <Route path="/notes/:docId?" element={<KnowledgeBase />} />,
    );

    fireEvent.click(screen.getByTestId("select-doc-a"));

    const pane = useKBStore.getState().panes.default;
    expect(pane.openTabs).toHaveLength(1);
    expect(pane.openTabs[0]).toMatchObject({
      id: "doc-a",
      docId: "doc-a",
      title: "Doc A",
    });
    expect(pane.activeTabId).toBe("doc-a");
    expect(pane.activeDocId).toBe("doc-a");
  });

  it("opens a new tab only when explicitly requested", () => {
    resetPaneState(
      [{ id: "doc-b", type: "doc", docId: "doc-b", title: "Doc B", sourceId: "src-1" }],
      "doc-b",
    );

    renderKnowledgeBase(
      "/notes",
      <Route path="/notes/:docId?" element={<KnowledgeBase />} />,
    );

    fireEvent.click(screen.getByTestId("select-doc-a-new-tab"));

    const pane = useKBStore.getState().panes.default;
    expect(pane.openTabs).toHaveLength(2);
    expect(pane.openTabs.map((tab) => tab.docId)).toEqual(["doc-b", "doc-a"]);
    expect(pane.activeTabId).toBe("doc-a");
    expect(pane.activeDocId).toBe("doc-a");
  });

  it("embedded mode fetches project sources and does not redirect to /notes", async () => {
    const pane = makePane(
      [{ id: "doc-b", type: "doc", docId: "doc-b", title: "Doc B", sourceId: "src-1" }],
      "doc-b",
    );
    useKBStore.setState({
      panes: { default: pane },
      focusedPaneId: "default",
      splitDirection: null,
      activeTabId: pane.activeTabId,
      activeDocId: pane.activeDocId,
      fetchSources: vi.fn(() => {
        throw new Error("KnowledgeBase should not call fetchSources from the KB store");
      }),
      renameDoc: vi.fn().mockResolvedValue(undefined),
      deleteDoc: vi.fn().mockResolvedValue(undefined),
    });

    renderKnowledgeBase(
      "/projects/p1/notes",
      <Route
        path="/projects/:projectId/:tab?"
        element={<KnowledgeBase embedded projectId="p1" />}
      />,
    );

    await waitFor(() => expect(fetchKBSourcesApiMock).toHaveBeenCalledTimes(1));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("opens the requested notes document from the embedded docId query param", () => {
    resetPaneState(
      [{ id: "doc-b", type: "doc", docId: "doc-b", title: "Doc B", sourceId: "src-1" }],
      "doc-b",
    );

    renderKnowledgeBase(
      "/projects/p1/notes?docId=doc-writeup",
      <Route
        path="/projects/:projectId/:tab?"
        element={<KnowledgeBase embedded projectId="p1" />}
      />,
    );

    const pane = useKBStore.getState().panes.default;
    expect(pane.openTabs.map((tab) => tab.docId)).toContain("doc-writeup");
    expect(pane.activeTabId).toBe("doc-writeup");
    expect(pane.activeDocId).toBe("doc-writeup");
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("fills full width in embedded mode", () => {
    const { container } = renderKnowledgeBase(
      "/projects/p1/notes",
      <Route
        path="/projects/:projectId/:tab?"
        element={<KnowledgeBase embedded projectId="p1" />}
      />,
    );

    expect(container.firstElementChild).toHaveClass("w-full");
  });
});
