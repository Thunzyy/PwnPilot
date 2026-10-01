/**
 * SyncStatusIndicator Component Tests (SET-02 sync status display)
 *
 * Validates rendering: completed badge with correct styling,
 * disabled sync button during running state,
 * sync trigger calls syncSource action.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";

import { useKBStore } from "@/stores/kbStore";

import { SyncStatusIndicator } from "../SyncStatusIndicator";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSyncSource = vi.fn();

vi.mock("@/stores/kbStore", () => ({
  useKBStore: vi.fn(),
}));

const mockedUseKBStore = vi.mocked(useKBStore);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SyncStatusIndicator", () => {
  beforeEach(() => {
    mockSyncSource.mockReset();
    mockedUseKBStore.mockImplementation((selector: unknown) => {
      const state = { syncSource: mockSyncSource };
      return typeof selector === "function"
        ? (selector as (s: typeof state) => unknown)(state)
        : state;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("shows completed badge with correct text", () => {
    const { container } = render(
      <SyncStatusIndicator
        sourceId="src-1"
        syncStatus="completed"
        lastSyncedAt="2026-01-15T10:00:00Z"
        sourceType="local"
      />,
    );

    // Badge shows "completed" text
    expect(container.textContent).toContain("completed");

    // Badge has emerald styling (completed status)
    const badge = container.querySelector("[class*='emerald']");
    expect(badge).toBeTruthy();
  });

  it("disables sync button when running", () => {
    const { container } = render(
      <SyncStatusIndicator
        sourceId="src-1"
        syncStatus="running"
        lastSyncedAt={null}
        sourceType="local"
      />,
    );

    // Sync button should be disabled
    const syncBtn = container.querySelector('button[title="Trigger sync"]');
    expect(syncBtn).toBeTruthy();
    expect((syncBtn as HTMLButtonElement).disabled).toBe(true);

    // RefreshCw icon should have animate-spin
    const spinner = container.querySelector("[class*='animate-spin']");
    expect(spinner).toBeTruthy();
  });

  it("calls syncSource on click when idle", () => {
    const { container } = render(
      <SyncStatusIndicator
        sourceId="src-42"
        syncStatus="completed"
        lastSyncedAt="2026-01-15T10:00:00Z"
        sourceType="local"
      />,
    );

    const syncBtn = container.querySelector('button[title="Trigger sync"]');
    expect(syncBtn).toBeTruthy();
    expect((syncBtn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(syncBtn!);

    expect(mockSyncSource).toHaveBeenCalledWith("src-42");
  });
});
