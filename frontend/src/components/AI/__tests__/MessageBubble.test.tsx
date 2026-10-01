import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MessageBubble } from "../MessageBubble";
import type { ChatMessage } from "@/types/ai";

describe("MessageBubble", () => {
  it("shows CLI source metadata for orchestrated CLI responses", () => {
    const message: ChatMessage = {
      id: "msg-1",
      role: "assistant",
      content: "Scan complete",
      timestamp: new Date("2026-04-16T10:00:00Z"),
      model: "claude-sonnet-4-20250514",
      provider: "Claude Code",
      sourceMode: "cli_orchestrated",
    };

    render(
      <MessageBubble
        message={message}
        allMessages={[message]}
        conversationId="conv-1"
        onEdit={vi.fn()}
        onSiblingSwitch={vi.fn()}
      />
    );

    expect(screen.getByText(/claude code/i)).toBeInTheDocument();
    expect(screen.getByText(/cli/i)).toBeInTheDocument();
  });
});
