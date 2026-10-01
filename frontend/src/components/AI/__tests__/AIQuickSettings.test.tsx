import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AIQuickSettings } from "../AIQuickSettings";

vi.mock("@/components/Settings/AISettings", () => ({
  AISettings: () => <div>Mock AI settings panel</div>,
}));

describe("AIQuickSettings", () => {
  it("opens the provider settings dialog from the labeled CTA", () => {
    render(<AIQuickSettings label="Open AI Settings" />);

    fireEvent.click(screen.getByRole("button", { name: "Open AI Settings" }));

    expect(
      screen.getByRole("heading", { name: "AI Providers" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/configure ai providers and default models/i)
    ).toBeInTheDocument();
    expect(screen.getByText("Mock AI settings panel")).toBeInTheDocument();
  });
});
