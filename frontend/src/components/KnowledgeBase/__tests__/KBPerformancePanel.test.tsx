import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import {
  clearKBPerfSamples,
  recordKBPerfSample,
} from "@/lib/perf/kbPerf";
import { KBPerformancePanel } from "../KBPerformancePanel";

describe("KBPerformancePanel", () => {
  beforeEach(() => {
    clearKBPerfSamples();
  });

  it("renders operation summaries from KB telemetry samples", () => {
    recordKBPerfSample({
      operation: "kb.search",
      durationMs: 120,
      status: "success",
    });
    recordKBPerfSample({
      operation: "kb.search",
      durationMs: 240,
      status: "error",
    });
    recordKBPerfSample({
      operation: "kb.document.open",
      durationMs: 80,
      status: "success",
    });

    render(<KBPerformancePanel />);

    expect(screen.getByText("KB Performance Diagnostics")).toBeInTheDocument();
    expect(screen.getByText("kb.document.open")).toBeInTheDocument();
    expect(screen.getByText("kb.search")).toBeInTheDocument();
    expect(screen.getByText("240 ms")).toBeInTheDocument();
    expect(screen.getByText("180 ms")).toBeInTheDocument();
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("clears samples from the panel", () => {
    recordKBPerfSample({
      operation: "kb.sources.list",
      durationMs: 90,
      status: "success",
    });

    render(<KBPerformancePanel />);

    fireEvent.click(screen.getByRole("button", { name: /Clear Samples/i }));

    expect(screen.getByText("No KB performance samples recorded yet.")).toBeInTheDocument();
  });
});
