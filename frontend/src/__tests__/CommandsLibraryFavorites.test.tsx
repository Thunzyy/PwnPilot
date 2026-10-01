import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, beforeEach, vi } from "vitest";

const { commandsApiMock } = vi.hoisted(() => ({
  commandsApiMock: {
    listGlobalCommands: vi.fn(),
    seedGlobalCommands: vi.fn(),
    listGlobalFavorites: vi.fn(),
    listProjectCommands: vi.fn(),
    listProjectFavorites: vi.fn(),
    addGlobalFavorite: vi.fn(),
    removeGlobalFavorite: vi.fn(),
    addProjectFavorite: vi.fn(),
    removeProjectFavorite: vi.fn(),
  },
}));

vi.mock("@/api/commands", () => ({
  commandsApi: commandsApiMock,
}));

import { CommandsLibrary } from "@/components/Commands/CommandsLibrary";

describe("CommandsLibrary favorites", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commandsApiMock.seedGlobalCommands.mockResolvedValue({});
  });

  it("filters global favorites with the favorites chip", async () => {
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
      {
        id: "cmd-2",
        name: "Global Two",
        category: "Web",
        command: "curl http://example.com",
        description: null,
        tags: [],
        is_custom: true,
        scope: "global",
        project_id: null,
      },
    ]);
    commandsApiMock.listGlobalFavorites.mockResolvedValue(["cmd-1"]);

    render(<CommandsLibrary variables={{}} onCopyCommand={() => undefined} />);

    expect(await screen.findByText("Global One")).toBeInTheDocument();
    expect(screen.getByText("Global Two")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /^Favorites$/i })
    );

    await waitFor(() => {
      expect(screen.getByText("Global One")).toBeInTheDocument();
      expect(screen.queryByText("Global Two")).not.toBeInTheDocument();
    });
  });

  it("shows global favorites chip in project scope and filters to global favorites", async () => {
    commandsApiMock.listProjectCommands.mockResolvedValue([
      {
        id: "proj-1",
        name: "Project Command",
        category: "Post",
        command: "id",
        description: null,
        tags: [],
        is_custom: true,
        scope: "project",
        project_id: "p1",
      },
    ]);
    commandsApiMock.listProjectFavorites.mockResolvedValue([]);
    commandsApiMock.listGlobalCommands.mockResolvedValue([
      {
        id: "g-1",
        name: "Global Favorite",
        category: "Recon",
        command: "hostname",
        description: null,
        tags: [],
        is_custom: true,
        scope: "global",
        project_id: null,
      },
    ]);
    commandsApiMock.listGlobalFavorites.mockResolvedValue(["g-1"]);

    render(
      <CommandsLibrary
        scope="project"
        projectId="p1"
        variables={{}}
        onCopyCommand={() => undefined}
      />
    );

    expect(await screen.findByText("Project Command")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Global Favorites/i })
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /Global Favorites/i })
    );

    await waitFor(() => {
      expect(screen.getByText("Global Favorite")).toBeInTheDocument();
      expect(screen.queryByText("Project Command")).not.toBeInTheDocument();
    });
  });
});
