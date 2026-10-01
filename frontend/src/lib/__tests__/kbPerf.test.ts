import { beforeEach, describe, expect, it } from "vitest";

import {
  clearKBPerfSamples,
  recordKBPerfSample,
  useKBPerfStore,
} from "../perf/kbPerf";

describe("kbPerf", () => {
  beforeEach(() => {
    clearKBPerfSamples();
  });

  it("records KB perf samples with status and metadata", () => {
    recordKBPerfSample({
      operation: "kb.search",
      durationMs: 184,
      status: "success",
      metadata: { queryLength: 7, resultCount: 12 },
    });

    const state = useKBPerfStore.getState();

    expect(state.samples).toHaveLength(1);
    expect(state.samples[0]).toMatchObject({
      operation: "kb.search",
      durationMs: 184,
      status: "success",
      metadata: { queryLength: 7, resultCount: 12 },
    });
    expect(state.samples[0].recordedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
    );
  });

  it("keeps a bounded session-only sample buffer", () => {
    for (let index = 1; index <= 75; index += 1) {
      recordKBPerfSample({
        operation: "kb.tree",
        durationMs: index,
        status: "success",
      });
    }

    const { samples } = useKBPerfStore.getState();

    expect(samples).toHaveLength(50);
    expect(samples[0].durationMs).toBe(75);
    expect(samples.at(-1)?.durationMs).toBe(26);
  });

  it("builds per-operation summaries", () => {
    recordKBPerfSample({
      operation: "kb.search",
      durationMs: 120,
      status: "success",
    });
    recordKBPerfSample({
      operation: "kb.search",
      durationMs: 300,
      status: "error",
    });
    recordKBPerfSample({
      operation: "kb.document.open",
      durationMs: 80,
      status: "success",
    });

    const summaries = useKBPerfStore.getState().getOperationSummaries();

    expect(summaries).toEqual([
      {
        operation: "kb.document.open",
        count: 1,
        latestDurationMs: 80,
        averageDurationMs: 80,
        maxDurationMs: 80,
        lastStatus: "success",
      },
      {
        operation: "kb.search",
        count: 2,
        latestDurationMs: 300,
        averageDurationMs: 210,
        maxDurationMs: 300,
        lastStatus: "error",
      },
    ]);
  });

  it("clears recorded samples", () => {
    recordKBPerfSample({
      operation: "kb.sources.list",
      durationMs: 90,
      status: "success",
    });

    clearKBPerfSamples();

    const state = useKBPerfStore.getState();
    expect(state.samples).toEqual([]);
    expect(state.getOperationSummaries()).toEqual([]);
  });
});
