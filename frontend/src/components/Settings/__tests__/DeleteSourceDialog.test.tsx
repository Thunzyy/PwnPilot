/**
 * DeleteSourceDialog Component Tests (SET-02 source deletion)
 *
 * Validates rendering: confirmation with source name,
 * onConfirm with false when checkbox unchecked,
 * onConfirm with true when checkbox checked (community source).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { useState } from "react";

import { DeleteSourceDialog } from "../DeleteSourceDialog";
import { makeSource } from "./helpers";

function renderControlledDialog(
  source: ReturnType<typeof makeSource>,
  onConfirm = vi.fn(),
) {
  const onOpenChange = vi.fn();

  function Wrapper() {
    const [open, setOpen] = useState(true);

    return (
      <DeleteSourceDialog
        source={source}
        open={open}
        onOpenChange={(nextOpen) => {
          onOpenChange(nextOpen);
          setOpen(nextOpen);
        }}
        onConfirm={onConfirm}
      />
    );
  }

  return { ...render(<Wrapper />), onConfirm, onOpenChange };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DeleteSourceDialog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders confirmation with source name", () => {
    const source = makeSource({ name: "My Pentest Vault" });

    renderControlledDialog(source);

    // AlertDialog renders via portal in document.body
    const body = document.body;
    expect(body.textContent).toContain("My Pentest Vault");
    expect(body.textContent).toContain("Remove");
  });

  it("calls onConfirm with false when checkbox unchecked", () => {
    const source = makeSource({ source_type: "local" });
    const onConfirm = vi.fn();

    renderControlledDialog(source, onConfirm);

    // For local sources, no checkbox is shown -- just click Remove
    const buttons = document.body.querySelectorAll("button");
    const removeBtn = Array.from(buttons).find((b) =>
      b.textContent?.includes("Remove"),
    );
    expect(removeBtn).toBeTruthy();
    fireEvent.click(removeBtn!);

    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it("calls onConfirm with true when checkbox checked for community source", async () => {
    const source = makeSource({ source_type: "community" });
    const onConfirm = vi.fn();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { onOpenChange } = renderControlledDialog(source, onConfirm);

    // Community sources show the "delete files" checkbox
    const checkbox = document.body.querySelector('[role="checkbox"]');
    expect(checkbox).toBeTruthy();

    // Click the label to toggle checkbox (uses htmlFor="delete-files")
    const label = document.body.querySelector('label[for="delete-files"]');
    expect(label).toBeTruthy();
    fireEvent.click(label!);

    // Click Remove
    const buttons = document.body.querySelectorAll("button");
    const removeBtn = Array.from(buttons).find((b) =>
      b.textContent?.includes("Remove"),
    );
    fireEvent.click(removeBtn!);

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith(true);
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    const loggedOutput = consoleErrorSpy.mock.calls.flat().map(String).join("\n");
    expect(loggedOutput).not.toContain("not wrapped in act");
  });
});
