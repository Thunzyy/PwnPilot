import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import {
  clearTimelinePerfSamples,
  recordTimelinePerfSample,
} from "@/lib/perf/timelinePerf";
import { TimelinePerformancePanel } from "../TimelinePerformancePanel";

describe("TimelinePerformancePanel", () => {
  beforeEach(() => {
    clearTimelinePerfSamples();
  });

  it("renders operation summaries from timeline telemetry samples", () => {
    recordTimelinePerfSample({
      operation: "timeline.load",
      durationMs: 180,
      status: "success",
    });
    recordTimelinePerfSample({
      operation: "timeline.filter",
      durationMs: 22,
      status: "success",
    });
    recordTimelinePerfSample({
      operation: "timeline.filter",
      durationMs: 40,
      status: "error",
    });

    render(<TimelinePerformancePanel />);

    expect(
      screen.getByText("Timeline Performance Diagnostics")
    ).toBeInTheDocument();
    expect(screen.getByText("timeline.load")).toBeInTheDocument();
    expect(screen.getByText("timeline.filter")).toBeInTheDocument();
    expect(screen.getByText("40 ms")).toBeInTheDocument();
    expect(screen.getByText("31 ms")).toBeInTheDocument();
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("clears samples from the panel", () => {
    recordTimelinePerfSample({
      operation: "timeline.load",
      durationMs: 90,
      status: "success",
    });

    render(<TimelinePerformancePanel />);

    fireEvent.click(screen.getByRole("button", { name: /clear samples/i }));

    expect(
      screen.getByText("No timeline performance samples recorded yet.")
    ).toBeInTheDocument();
  });
});
