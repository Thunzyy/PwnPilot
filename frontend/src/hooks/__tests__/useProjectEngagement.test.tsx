import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useProjectEngagement } from "../useProjectEngagement";
import { createEngagementState } from "../../__tests__/factories/engagementStateFactory";

const getProjectStateMock = vi.fn();
const updateProjectStateMock = vi.fn();

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

vi.mock("@/api/engagement", () => ({
  engagementApi: {
    getProjectState: (...args: unknown[]) => getProjectStateMock(...args),
    updateProjectState: (...args: unknown[]) => updateProjectStateMock(...args),
  },
}));

describe("useProjectEngagement", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getProjectStateMock.mockReset();
    updateProjectStateMock.mockReset();
    getProjectStateMock.mockResolvedValue(createEngagementState({ progress: 10 }));
    updateProjectStateMock.mockResolvedValue(createEngagementState({ progress: 20 }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("silently refreshes project engagement state while a project is open", async () => {
    getProjectStateMock
      .mockResolvedValueOnce(createEngagementState({ progress: 10 }))
      .mockResolvedValueOnce(createEngagementState({ progress: 65 }));

    const { result } = renderHook(() => useProjectEngagement("project-1"));

    await act(async () => {
      await flushPromises();
    });
    expect(result.current.engagementState.progress).toBe(10);
    expect(getProjectStateMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
      await flushPromises();
    });

    expect(result.current.engagementState.progress).toBe(65);
    expect(result.current.isLoading).toBe(false);
    expect(getProjectStateMock).toHaveBeenCalledTimes(2);
  });
});
