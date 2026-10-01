import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { createQueryClient } from "@/lib/queryClient";
import { useKBStore } from "@/stores/kbStore";
import type { KBSource } from "@/types/kb";
import { SourceManagement } from "../SourceManagement";

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

vi.mock("@/api/kbSources", () => ({
  fetchKBSources: fetchKBSourcesApiMock,
  kbSourceQueryKeys,
  mapKBSourcesError: () => "Failed to load KB sources",
}));

vi.mock("../SourceEditDialog", () => ({
  SourceEditDialog: () => null,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("../DeleteSourceDialog", () => ({
  DeleteSourceDialog: ({
    source,
    open,
    onConfirm,
  }: {
    source: KBSource | null;
    open: boolean;
    onConfirm: (deleteFiles: boolean) => void;
  }) =>
    source && open ? (
      <button type="button" data-testid="confirm-delete-source" onClick={() => onConfirm(false)}>
        Confirm delete {source.name}
      </button>
    ) : null,
}));

vi.mock("../SyncStatusIndicator", () => ({
  SyncStatusIndicator: () => <div data-testid="sync-status" />,
}));

const makeSource = (overrides: Partial<KBSource> = {}): KBSource => ({
  id: "src-1",
  name: "Operator Notes",
  source_type: "local",
  origin: null,
  path: "C:/vault",
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

describe("SourceManagement", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    vi.mocked(toast.error).mockReset();
    vi.mocked(toast.success).mockReset();
    fetchKBSourcesApiMock.mockReset();
    fetchKBSourcesApiMock.mockResolvedValue([makeSource()]);
    useKBStore.setState({
      sources: [],
      isLoading: false,
      error: null,
      fetchSources: vi.fn(() => {
        throw new Error("SourceManagement should bootstrap KB sources through React Query");
      }),
      deleteSourceWithCleanup: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("loads KB sources through react query on mount", async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <SourceManagement />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(fetchKBSourcesApiMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Operator Notes")).toBeInTheDocument();
  });

  it("shows backend details when source removal fails", async () => {
    const deleteSourceWithCleanup = vi.fn().mockRejectedValueOnce({
      response: {
        data: {
          detail: "Source is currently syncing and cannot be removed.",
        },
      },
    });
    useKBStore.setState({ deleteSourceWithCleanup });

    render(
      <QueryClientProvider client={createQueryClient()}>
        <SourceManagement />
      </QueryClientProvider>,
    );

    await screen.findByText("Operator Notes");
    fireEvent.click(screen.getByTitle("Remove source"));
    fireEvent.click(screen.getByTestId("confirm-delete-source"));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Failed to remove source", {
        description: "Source is currently syncing and cannot be removed.",
      }),
    );
  });
});
