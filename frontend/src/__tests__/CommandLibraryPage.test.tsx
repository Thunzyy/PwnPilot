import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import { CommandLibraryPage } from "@/pages/CommandLibrary";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn().mockResolvedValue({ data: [] }), post: vi.fn() },
}));

vi.mock("@/components/Commands/CommandsLibrary", () => ({
  CommandsLibrary: () => <div>Commands</div>,
}));

vi.mock("@/stores/commandGlobalsStore", () => ({
  useCommandGlobalsStore: () => ({
    variables: { target_ip: "192.168.1.1" },
    setVariable: vi.fn(),
    removeVariable: vi.fn(),
    addVariable: vi.fn(),
    resetDefaults: vi.fn(),
  }),
}));

describe("CommandLibraryPage", () => {
  it("renders the global command library layout", () => {
    render(
      <MemoryRouter>
        <CommandLibraryPage />
      </MemoryRouter>
    );

    expect(screen.getByText(/Global Variables/i)).toBeInTheDocument();
  });

  it("keeps global variables collapsed by default and expands on demand", () => {
    render(
      <MemoryRouter>
        <CommandLibraryPage />
      </MemoryRouter>
    );

    expect(screen.queryByDisplayValue("192.168.1.1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /show global variables/i }));

    expect(screen.getByDisplayValue("192.168.1.1")).toBeInTheDocument();
  });
});
