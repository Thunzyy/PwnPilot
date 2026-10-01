import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ChatExportDialog } from "../ChatExportDialog";

const exportConversationMock = vi.fn();

vi.mock("@/api/ai", () => ({
  aiApi: {
    exportConversation: (...args: unknown[]) => exportConversationMock(...args),
  },
}));

describe("ChatExportDialog", () => {
  beforeEach(() => {
    exportConversationMock.mockReset();
    exportConversationMock.mockImplementation(
      async (_conversationId: string, format: string) => {
        if (format === "codex") {
          return {
            conversation_id: "conv-1",
            format: "codex",
            filename: "recon-notes-codex.md",
            content: "# Recon Notes\n\n## User\n\nSummarize the findings.",
            resume_command: 'codex --model o4-mini "$(cat recon-notes-codex.md)"',
          };
        }

        return {
          conversation_id: "conv-1",
          format: "markdown",
          filename: "recon-notes.md",
          content: "# Recon Notes\n\n## User\n\nSummarize the findings.",
          resume_command: null,
        };
      },
    );
  });

  it("loads the default markdown export when opened", async () => {
    render(<ChatExportDialog conversationId="conv-1" title="Recon Notes" />);

    fireEvent.click(screen.getByRole("button", { name: /export/i }));

    await waitFor(() => {
      expect(exportConversationMock).toHaveBeenCalledWith("conv-1", "markdown");
    });

    expect(await screen.findByDisplayValue("recon-notes.md")).toBeInTheDocument();
    expect(screen.getByDisplayValue(/# Recon Notes/)).toBeInTheDocument();
  });

  it("switches formats and shows the CLI resume command when available", async () => {
    render(<ChatExportDialog conversationId="conv-1" title="Recon Notes" />);

    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    await screen.findByDisplayValue("recon-notes.md");

    fireEvent.click(screen.getByRole("button", { name: /codex/i }));

    await waitFor(() => {
      expect(exportConversationMock).toHaveBeenLastCalledWith("conv-1", "codex");
    });

    expect(await screen.findByDisplayValue("recon-notes-codex.md")).toBeInTheDocument();
    expect(screen.getByText(/codex --model o4-mini/i)).toBeInTheDocument();
  });
});
