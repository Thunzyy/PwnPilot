/**
 * BacklinkPanel Component Tests (NAV-02 backlinks)
 *
 * Validates rendering: empty returns null, count badge + titles visible,
 * clicking a backlink calls onNavigate with doc ID.
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { BacklinkPanel } from "../BacklinkPanel";
import { makeBacklink } from "./helpers";

describe("BacklinkPanel", () => {
  it("renders nothing when backlinks array is empty", () => {
    const { container } = render(
      <BacklinkPanel backlinks={[]} onNavigate={vi.fn()} />,
    );

    // Component returns null for empty backlinks
    expect(container.innerHTML).toBe("");
  });

  it("renders backlink count and titles", () => {
    const backlinks = [
      makeBacklink({ id: "bl-1", title: "Recon Notes", relative_path: "recon/notes.md" }),
      makeBacklink({ id: "bl-2", title: "Nmap Guide", relative_path: "tools/nmap.md" }),
      makeBacklink({ id: "bl-3", title: "Cheat Sheet", relative_path: "cheatsheet.md" }),
    ];

    const { container } = render(
      <BacklinkPanel backlinks={backlinks} onNavigate={vi.fn()} />,
    );

    // Count badge shows "3"
    expect(container.textContent).toContain("3");

    // Section header
    expect(container.textContent).toContain("Backlinks");

    // Each backlink title visible
    expect(container.textContent).toContain("Recon Notes");
    expect(container.textContent).toContain("Nmap Guide");
    expect(container.textContent).toContain("Cheat Sheet");

    // Relative paths visible
    expect(container.textContent).toContain("recon/notes.md");
    expect(container.textContent).toContain("tools/nmap.md");
  });

  it("calls onNavigate with doc ID when clicking a backlink", () => {
    const onNavigate = vi.fn();
    const backlinks = [
      makeBacklink({ id: "bl-1", title: "Recon Notes" }),
      makeBacklink({ id: "bl-2", title: "Nmap Guide" }),
    ];

    const { container } = render(
      <BacklinkPanel backlinks={backlinks} onNavigate={onNavigate} />,
    );

    // Click the first backlink
    const list = container.querySelector("ul");
    expect(list).toBeTruthy();
    const buttons = list!.querySelectorAll("button");
    expect(buttons.length).toBe(2);

    fireEvent.click(buttons[0]!);
    expect(onNavigate).toHaveBeenCalledWith("bl-1");

    fireEvent.click(buttons[1]!);
    expect(onNavigate).toHaveBeenCalledWith("bl-2");
  });

  it("renders single backlink correctly", () => {
    const backlinks = [
      makeBacklink({ id: "bl-solo", title: "Solo Link" }),
    ];

    const { container } = render(
      <BacklinkPanel backlinks={backlinks} onNavigate={vi.fn()} />,
    );

    // Count badge shows "1"
    expect(container.textContent).toContain("1");
    expect(container.textContent).toContain("Solo Link");
  });
});
