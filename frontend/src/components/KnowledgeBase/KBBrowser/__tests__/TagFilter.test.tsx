/**
 * TagFilter Component Tests (NAV-03)
 *
 * Validates rendering: null tag returns null, active tag displays correctly,
 * clicking clear button calls onClearTag.
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TagFilter } from "../TagFilter";

describe("TagFilter", () => {
  it("renders nothing when activeTag is null", () => {
    const { container } = render(
      <TagFilter activeTag={null} onClearTag={vi.fn()} />,
    );

    // Component returns null
    expect(container.innerHTML).toBe("");
  });

  it("shows active tag with filter label", () => {
    const { container } = render(
      <TagFilter activeTag="recon" onClearTag={vi.fn()} />,
    );

    expect(container.textContent).toContain("Filtered by tag:");
    expect(container.textContent).toContain("recon");
  });

  it("calls onClearTag when clicking clear button", () => {
    const onClearTag = vi.fn();
    const { container } = render(
      <TagFilter activeTag="nmap" onClearTag={onClearTag} />,
    );

    // The clear button has aria-label
    const clearBtn = container.querySelector(
      '[aria-label="Clear tag filter: nmap"]',
    );
    expect(clearBtn).toBeTruthy();

    fireEvent.click(clearBtn!);
    expect(onClearTag).toHaveBeenCalledOnce();
  });

  it("displays different tags correctly", () => {
    const { container: c1 } = render(
      <TagFilter activeTag="privesc" onClearTag={vi.fn()} />,
    );
    expect(c1.textContent).toContain("privesc");

    const { container: c2 } = render(
      <TagFilter activeTag="enumeration" onClearTag={vi.fn()} />,
    );
    expect(c2.textContent).toContain("enumeration");
  });
});
