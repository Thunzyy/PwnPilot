import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CommandsLibrary } from "@/components/Commands/CommandsLibrary";

const { commandsApiMock } = vi.hoisted(() => ({
  commandsApiMock: {
    listGlobalCommands: vi.fn(),
    seedGlobalCommands: vi.fn(),
    listGlobalFavorites: vi.fn(),
    listProjectCommands: vi.fn(),
    listProjectFavorites: vi.fn(),
    deleteProjectCommand: vi.fn(),
  },
}));

vi.mock("@/api/commands", () => ({
  commandsApi: commandsApiMock,
}));

describe("CommandsLibrary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commandsApiMock.seedGlobalCommands.mockResolvedValue({});
    commandsApiMock.listProjectCommands.mockResolvedValue([
      {
        id: "project-cmd-1",
        name: "Project One",
        category: "Recon",
        command: "curl http://target-1",
        description: "Project command one",
        tags: ["http"],
        is_custom: true,
        scope: "project",
        project_id: "p1",
      },
      {
        id: "project-cmd-2",
        name: "Project Two",
        category: "Recon",
        command: "curl http://target-2",
        description: "Project command two",
        tags: ["http"],
        is_custom: true,
        scope: "project",
        project_id: "p1",
      },
    ]);
    commandsApiMock.listProjectFavorites.mockResolvedValue([]);
    commandsApiMock.deleteProjectCommand.mockResolvedValue(undefined);
    commandsApiMock.listGlobalCommands.mockResolvedValue([
      {
        id: "cmd-1",
        name: "Global One",
        category: "Recon",
        command: "whoami",
        description: null,
        tags: [],
        is_custom: true,
        scope: "global",
        project_id: null,
      },
    ]);
    commandsApiMock.listGlobalFavorites.mockResolvedValue([]);
  });

  it("shows the global search placeholder and chips", async () => {
    render(
      <CommandsLibrary variables={{}} onCopyCommand={() => undefined} />
    );

    expect(
      await screen.findByPlaceholderText(/Search global command database/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/All Commands/i)).toBeInTheDocument();
  });

  it("builds an AI handoff prompt from the current search query", async () => {
    const onAskAI = vi.fn();

    render(
      <CommandsLibrary
        variables={{}}
        onCopyCommand={() => undefined}
        onAskAI={onAskAI}
      />
    );

    const searchInput = await screen.findByPlaceholderText(
      /Search global command database/i
    );
    fireEvent.change(searchInput, {
      target: { value: "enumerate smb shares" },
    });
    fireEvent.click(screen.getByTitle(/Ask AI to find a command/i));

    expect(onAskAI).toHaveBeenCalledWith(
      expect.stringContaining("enumerate smb shares")
    );
  });

  it("batch deletes selected project commands from the library", async () => {
    render(
      <CommandsLibrary
        variables={{}}
        onCopyCommand={() => undefined}
        scope="project"
        projectId="p1"
      />
    );

    expect(await screen.findByText("Project One")).toBeInTheDocument();
    expect(screen.getByText("Project Two")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /select/i }));

    fireEvent.click(
      screen.getByRole("button", { name: /select command project one/i })
    );
    fireEvent.click(
      screen.getByRole("button", { name: /select command project two/i })
    );

    fireEvent.click(screen.getByRole("button", { name: /delete selected/i }));
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(commandsApiMock.deleteProjectCommand).toHaveBeenCalledTimes(2);
      expect(screen.queryByText("Project One")).not.toBeInTheDocument();
      expect(screen.queryByText("Project Two")).not.toBeInTheDocument();
    });
  });
});
