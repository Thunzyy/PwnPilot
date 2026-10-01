import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { HealthDiagnosticsPanel } from "@/components/Diagnostics/HealthDiagnosticsPanel";
import { useDiagnosticsStore } from "@/stores/diagnosticsStore";

describe("HealthDiagnosticsPanel", () => {
  beforeEach(() => {
    useDiagnosticsStore.getState().clearEvents();
  });

  it("opens a diagnostics overlay with recent events and can clear them", () => {
    useDiagnosticsStore.getState().recordEvent({
      category: "ai",
      severity: "error",
      title: "AI provider failed",
      message: "Gemini timed out while generating report update",
      source: "/ai/providers/gemini",
    });

    render(<HealthDiagnosticsPanel />);

    const trigger = screen.getByRole("button", {
      name: /Health diagnostics/i,
    });
    expect(within(trigger).getByText("1")).toBeInTheDocument();

    fireEvent.click(trigger);

    expect(
      screen.getByRole("heading", { name: /Health diagnostics/i })
    ).toBeInTheDocument();
    expect(screen.getByText("AI provider failed")).toBeInTheDocument();
    expect(
      screen.getByText("Gemini timed out while generating report update")
    ).toBeInTheDocument();
    expect(screen.getByText("AI")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Clear events/i }));

    expect(screen.getByText("No diagnostics recorded")).toBeInTheDocument();
    expect(
      screen.queryByText("Gemini timed out while generating report update")
    ).not.toBeInTheDocument();
  });
});
