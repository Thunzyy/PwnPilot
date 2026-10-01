import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "@/lib/queryClient";
import { useReportBadge } from "@/hooks/useReportBadge";

const projectStoreState = vi.hoisted(() => ({
  currentProject: {
    id: "project-1",
    name: "Cap",
    variables: {},
  },
}));

const reportApiMocks = vi.hoisted(() => ({
  reportQueryKeys: {
    detail: (projectId: string) => ["report", projectId] as const,
    proposals: (projectId: string) => ["report", projectId, "proposals"] as const,
  },
  fetchReportProposals: vi.fn(),
}));

vi.mock("@/stores/projectStore", () => ({
  useProjectStore: (selector?: (state: typeof projectStoreState) => unknown) =>
    selector ? selector(projectStoreState) : projectStoreState,
}));

vi.mock("@/api/report", () => reportApiMocks);

describe("useReportBadge", () => {
  beforeEach(() => {
    reportApiMocks.fetchReportProposals.mockReset();
  });

  it("returns the pending proposal count for the current project and refreshes after invalidation", async () => {
    reportApiMocks.fetchReportProposals
      .mockResolvedValueOnce({ items: [{ id: "proposal-1" }], total: 1 })
      .mockResolvedValueOnce({ items: [], total: 0 });

    const queryClient = createQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      createElement(QueryClientProvider, { client: queryClient }, children)
    );

    const { result } = renderHook(() => useReportBadge(), { wrapper });

    await waitFor(() => expect(result.current.pendingCount).toBe(1));

    await result.current.invalidate();

    await waitFor(() => expect(result.current.pendingCount).toBe(0));
  });
});
