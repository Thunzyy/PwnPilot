import { beforeEach, describe, expect, it } from "vitest";

import {
  clearTimelinePerfSamples,
  recordTimelinePerfSample,
  useTimelinePerfStore,
} from "../perf/timelinePerf";

describe("timelinePerf", () => {
  beforeEach(() => {
    clearTimelinePerfSamples();
  });

  it("records timeline perf samples with metadata", () => {
    recordTimelinePerfSample({
      operation: "timeline.load",
      durationMs: 42,
      status: "success",
      metadata: { totalEntries: 12, commandEntries: 6 },
    });

    const state = useTimelinePerfStore.getState();

    expect(state.samples).toHaveLength(1);
    expect(state.samples[0]).toMatchObject({
      operation: "timeline.load",
      durationMs: 42,
      status: "success",
      metadata: { totalEntries: 12, commandEntries: 6 },
    });
  });

  it("keeps a bounded sample buffer", () => {
    for (let index = 1; index <= 75; index += 1) {
      recordTimelinePerfSample({
        operation: "timeline.filter",
        durationMs: index,
        status: "success",
      });
    }

    const { samples } = useTimelinePerfStore.getState();

    expect(samples).toHaveLength(50);
    expect(samples[0].durationMs).toBe(75);
    expect(samples.at(-1)?.durationMs).toBe(26);
  });

  it("builds timeline operation summaries", () => {
    recordTimelinePerfSample({
      operation: "timeline.load",
      durationMs: 140,
      status: "success",
    });
    recordTimelinePerfSample({
      operation: "timeline.filter",
      durationMs: 18,
      status: "success",
    });
    recordTimelinePerfSample({
      operation: "timeline.filter",
      durationMs: 32,
      status: "error",
    });

    const summaries = useTimelinePerfStore.getState().getOperationSummaries();

    expect(summaries).toEqual([
      {
        operation: "timeline.filter",
        count: 2,
        latestDurationMs: 32,
        averageDurationMs: 25,
        maxDurationMs: 32,
        lastStatus: "error",
      },
      {
        operation: "timeline.load",
        count: 1,
        latestDurationMs: 140,
        averageDurationMs: 140,
        maxDurationMs: 140,
        lastStatus: "success",
      },
    ]);
  });
});
