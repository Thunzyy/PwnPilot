/**
 * UsedInPanel Component Tests (LINK-02 "Used in" panel)
 *
 * Validates rendering: empty returns null, engagement list with details,
 * project names / entry types / truncated content / formatted dates.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { linkingApi } from "@/api/linking";
import { createQueryClient } from "@/lib/queryClient";
import type { LinkedEngagement } from "@/types/linking";

import { UsedInPanel } from "../UsedInPanel";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/api/linking", () => ({
  linkingApi: {
    getDocEngagements: vi.fn(),
  },
}));

const mockedGetDocEngagements = vi.mocked(linkingApi.getDocEngagements);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderUsedInPanel(docId: string) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <UsedInPanel docId={docId} />
    </QueryClientProvider>
  );
}

function makeEngagement(
  overrides?: Partial<LinkedEngagement>,
): LinkedEngagement {
  return {
    timeline_entry_id: overrides?.timeline_entry_id ?? "entry-1",
    project_id: overrides?.project_id ?? "proj-1",
    project_name: overrides?.project_name ?? "HTB Lame",
    entry_type: overrides?.entry_type ?? "command",
    entry_content: overrides?.entry_content ?? "nmap -sV 10.10.10.2",
    created_at: overrides?.created_at ?? "2026-01-15T10:30:00Z",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("UsedInPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders nothing when no engagements", async () => {
    mockedGetDocEngagements.mockResolvedValue([]);

    const { container } = renderUsedInPanel("doc-1");

    // Wait for the API call to resolve and state to settle
    await waitFor(() => {
      expect(mockedGetDocEngagements).toHaveBeenCalledWith("doc-1");
    });

    // Component returns null for empty engagements
    expect(container.innerHTML).toBe("");
  });

  it("renders engagement list when linked", async () => {
    const engagements = [
      makeEngagement({
        timeline_entry_id: "e-1",
        project_id: "p-1",
        project_name: "HTB Lame",
        entry_type: "command",
      }),
      makeEngagement({
        timeline_entry_id: "e-2",
        project_id: "p-2",
        project_name: "THM Kenobi",
        entry_type: "note",
      }),
    ];
    mockedGetDocEngagements.mockResolvedValue(engagements);

    const { container } = renderUsedInPanel("doc-1");

    await waitFor(() => {
      expect(container.textContent).toContain("HTB Lame");
      expect(container.textContent).toContain("THM Kenobi");
    });

    // Entry types visible
    expect(container.textContent).toContain("command");
    expect(container.textContent).toContain("note");

    // Section header
    expect(container.textContent).toContain("Used in Engagements");

    // Count badge shows "2"
    expect(container.textContent).toContain("2");
  });

  it("shows nothing during loading state", () => {
    // Mock a promise that never resolves to keep isLoading=true
    mockedGetDocEngagements.mockReturnValue(new Promise(() => {}));

    const { container } = renderUsedInPanel("doc-1");

    // Component returns null while isLoading is true
    expect(container.innerHTML).toBe("");
  });

  it("renders engagement details correctly", async () => {
    const engagements = [
      makeEngagement({
        project_name: "HTB Active",
        entry_type: "finding",
        entry_content:
          "Found vulnerable service running on port 445 with SMB signing disabled allowing relay attacks and lateral movement",
        created_at: "2026-03-20T14:00:00Z",
      }),
    ];
    mockedGetDocEngagements.mockResolvedValue(engagements);

    const { container } = renderUsedInPanel("doc-1");

    await waitFor(() => {
      expect(container.textContent).toContain("HTB Active");
    });

    // Entry type badge
    expect(container.textContent).toContain("finding");

    // Content is truncated at 80 chars with "..."
    expect(container.textContent).toContain(
      "Found vulnerable service running on port 445 with SMB signing disabled allowing ...",
    );

    // Formatted date follows the active locale on the machine running the tests.
    const expectedDate = new Date("2026-03-20T14:00:00Z").toLocaleDateString(
      undefined,
      {
        month: "short",
        day: "numeric",
        year: "numeric",
      },
    );
    expect(container.textContent).toContain(expectedDate);
  });
});
