/**
 * OpsecWarningDialog Component Tests (SET-02 OPSEC acknowledgment)
 *
 * Validates rendering: warning text and "I understand" button,
 * onAcknowledge callback fires when clicking "I understand".
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

import { OpsecWarningDialog } from "../OpsecWarningDialog";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OpsecWarningDialog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders warning text and I understand button", () => {
    const onAcknowledge = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <OpsecWarningDialog
        open={true}
        onOpenChange={onOpenChange}
        onAcknowledge={onAcknowledge}
      />,
    );

    // AlertDialog renders via portal in document.body
    const body = document.body;
    expect(body.textContent).toContain("Remote Repository Notice");
    expect(body.textContent).toContain("I understand");
    expect(body.textContent).toContain("remote");
  });

  it("calls onAcknowledge when clicking I understand", () => {
    const onAcknowledge = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <OpsecWarningDialog
        open={true}
        onOpenChange={onOpenChange}
        onAcknowledge={onAcknowledge}
      />,
    );

    // Find the "I understand" button in document.body (portal)
    const buttons = document.body.querySelectorAll("button");
    const iUnderstandBtn = Array.from(buttons).find((b) =>
      b.textContent?.includes("I understand"),
    );
    expect(iUnderstandBtn).toBeTruthy();

    iUnderstandBtn!.click();

    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });
});
