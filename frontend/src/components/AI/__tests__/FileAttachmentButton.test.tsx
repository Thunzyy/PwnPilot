import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FileAttachmentButton } from "../FileAttachmentButton";
import type { PendingAttachment } from "@/types/ai";

const uploadAttachment = vi.fn();

vi.mock("@/api/ai", () => ({
  aiApi: {
    uploadAttachment: (...args: unknown[]) => uploadAttachment(...args),
  },
}));

function makeAttachment(overrides: Partial<PendingAttachment> = {}): PendingAttachment {
  const file = new File(["content"], overrides.filename ?? "notes.txt", {
    type: "text/plain",
  });

  return {
    id: overrides.id ?? "att-1",
    file,
    filename: overrides.filename ?? file.name,
    status: overrides.status ?? "done",
    progress: overrides.progress ?? 100,
    serverAttachment: overrides.serverAttachment,
  };
}

describe("FileAttachmentButton", () => {
  beforeEach(() => {
    uploadAttachment.mockReset();
  });

  it("shows an inline limit message instead of blocking with alert", () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);

    render(
      <FileAttachmentButton
        attachments={[makeAttachment()]}
        onAttachmentsChange={vi.fn()}
        maxFiles={1}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Attach files/i }));

    expect(alertSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Attachment limit reached: maximum 1 file.",
    );

    alertSpy.mockRestore();
  });

  it("removes attachments through an accessible button", () => {
    const onAttachmentsChange = vi.fn();

    render(
      <FileAttachmentButton
        attachments={[makeAttachment({ id: "att-1", filename: "loot.txt" })]}
        onAttachmentsChange={onAttachmentsChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Remove attachment loot.txt/i }));

    expect(onAttachmentsChange).toHaveBeenCalledWith([]);
  });
});
