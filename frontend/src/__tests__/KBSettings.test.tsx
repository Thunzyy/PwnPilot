import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "../lib/queryClient";
import { useKBStore } from "../stores/kbStore";
import type { KBSource } from "../types/kb";
import { KBSettings } from "../pages/KBSettings";

const mockNavigate = vi.fn();
const { fetchKBSourcesApiMock, kbSourceQueryKeys } = vi.hoisted(() => ({
  fetchKBSourcesApiMock: vi.fn(async () => [] as KBSource[]),
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

vi.mock("../api/kbSources", () => ({
  fetchKBSources: fetchKBSourcesApiMock,
  kbSourceQueryKeys,
  mapKBSourcesError: () => "Failed to load KB sources",
}));

vi.mock("../components/KnowledgeBase/SourceCard", () => ({
  SourceCard: ({ name }: { name: string }) => <div>{name}</div>,
}));

vi.mock("../components/KnowledgeBase/AddVaultDialog", () => ({
  AddVaultDialog: () => null,
}));

vi.mock("../components/KnowledgeBase/AddGitSourceDialog", () => ({
  AddGitSourceDialog: () => null,
}));

vi.mock("../components/KnowledgeBase/CommunityCatalogDialog", () => ({
  CommunityCatalogDialog: () => null,
}));

vi.mock("../components/KnowledgeBase/TagManagement", () => ({
  TagManagement: () => <div data-testid="tag-management" />,
}));

vi.mock("../components/KnowledgeBase/KBPerformancePanel", () => ({
  KBPerformancePanel: () => <div data-testid="kb-performance-panel" />,
}));

const makeSource = (overrides: Partial<KBSource> = {}): KBSource => ({
  id: "src-1",
  name: "Vault A",
  source_type: "local",
  origin: null,
  path: "C:/vault-a",
  remote_url: null,
  read_only: false,
  include_paths: null,
  user_id: "user-1",
  project_id: "project-1",
  sync_status: null,
  opsec_warning: null,
  opsec_acknowledged: false,
  last_synced_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("KBSettings", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    fetchKBSourcesApiMock.mockReset();
    fetchKBSourcesApiMock.mockResolvedValue([makeSource()]);
    useKBStore.setState({
      sources: [],
      isLoading: false,
      error: null,
      fetchSources: vi.fn(() => {
        throw new Error("KBSettings should bootstrap KB sources through React Query");
      }),
      deleteSource: vi.fn().mockResolvedValue(undefined),
      deleteCommunityByUrl: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("loads KB sources through react query on mount", async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter>
          <KBSettings />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(fetchKBSourcesApiMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Vault A")).toBeInTheDocument();
    expect(screen.getByTestId("tag-management")).toBeInTheDocument();
    expect(screen.getByTestId("kb-performance-panel")).toBeInTheDocument();
  });
});
