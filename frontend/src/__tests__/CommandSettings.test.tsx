import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../lib/queryClient";

const {
  loadGlobalSettingsMock,
  loadProjectSettingsMock,
  fetchProjectApiMock,
  projectQueryKeys,
  projectStoreState,
  selectProjectMock,
} = vi.hoisted(() => ({
  loadGlobalSettingsMock: vi.fn(),
  loadProjectSettingsMock: vi.fn(),
  fetchProjectApiMock: vi.fn(),
  projectQueryKeys: {
    all: ["projects"],
    detail: (projectId: string) => ["projects", projectId],
  },
  projectStoreState: {
    currentProject: null as
      | null
      | {
          id: string;
          name: string;
          variables: Record<string, string>;
        },
  },
  selectProjectMock: vi.fn((project: unknown) => {
    projectStoreState.currentProject = project as typeof projectStoreState.currentProject;
  }),
}));

const commandSettingsState = {
  commands: [],
  categories: [],
  filters: [],
  variables: {},
  isLoading: false,
  error: null,
  loadGlobalSettings: loadGlobalSettingsMock,
  loadProjectSettings: loadProjectSettingsMock,
  createGlobalCommand: vi.fn(),
  updateGlobalCommand: vi.fn(),
  deleteGlobalCommand: vi.fn(),
  createProjectCommand: vi.fn(),
  updateProjectCommand: vi.fn(),
  deleteProjectCommand: vi.fn(),
  createGlobalCategory: vi.fn(),
  updateGlobalCategory: vi.fn(),
  deleteGlobalCategory: vi.fn(),
  createProjectCategory: vi.fn(),
  updateProjectCategory: vi.fn(),
  deleteProjectCategory: vi.fn(),
  createGlobalFilter: vi.fn(),
  updateGlobalFilter: vi.fn(),
  deleteGlobalFilter: vi.fn(),
  createProjectFilter: vi.fn(),
  updateProjectFilter: vi.fn(),
  deleteProjectFilter: vi.fn(),
  updateGlobalVariables: vi.fn(),
  clearError: vi.fn(),
};

vi.mock("../stores/commandSettingsStore", () => ({
  useCommandSettingsStore: (
    selector?: (state: typeof commandSettingsState) => unknown
  ) => (selector ? selector(commandSettingsState) : commandSettingsState),
}));

const projectState = {
  currentProject: projectStoreState.currentProject,
  selectProject: selectProjectMock,
  updateProject: vi.fn(),
};

vi.mock("../stores/projectStore", () => ({
  useProjectStore: (
    selector?: (state: {
      currentProject: typeof projectStoreState.currentProject;
      selectProject: typeof selectProjectMock;
      updateProject: typeof projectState.updateProject;
    }) => unknown
  ) => {
    const state = {
      currentProject: projectStoreState.currentProject,
      selectProject: selectProjectMock,
      updateProject: projectState.updateProject,
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock("../api/projects", () => ({
  fetchProject: fetchProjectApiMock,
  projectQueryKeys,
}));

import { CommandSettingsPage } from "../pages/CommandSettings";
import { ProjectCommandSettingsPage } from "../pages/ProjectCommandSettings";

describe("Command settings pages", () => {
  beforeEach(() => {
    projectStoreState.currentProject = {
      id: "p1",
      name: "Test Project",
      variables: {},
    };
    fetchProjectApiMock.mockReset();
    fetchProjectApiMock.mockResolvedValue(projectStoreState.currentProject);
    selectProjectMock.mockClear();
    commandSettingsState.commands = [
      {
        id: "cmd-1",
        name: "Nmap",
        category: "Recon",
        command: "nmap -sV {{target}}",
        description: "Recon command",
        tags: ["recon"],
        is_custom: true,
        scope: "project",
        project_id: "p1",
      },
    ];
    commandSettingsState.categories = [
      {
        id: "cat-1",
        name: "Recon",
        sort_order: 1,
        scope: "project",
        project_id: "p1",
      },
    ];
    commandSettingsState.filters = [
      {
        id: "filter-1",
        name: "Favorites",
        sort_order: 1,
        scope: "project",
        project_id: "p1",
      },
    ];
  });

  it("renders global command settings sections", () => {
    render(
      <MemoryRouter initialEntries={["/commands/settings"]}>
        <Routes>
          <Route path="/commands/settings" element={<CommandSettingsPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: /Command Settings/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Commands/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Categories/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Filters/i })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: /Variables/i }).length).toBeGreaterThan(0);
  });

  it("loads project command settings through react query when store cache is empty", async () => {
    const project = {
      id: "p1",
      name: "Test Project",
      variables: {},
    };
    projectStoreState.currentProject = null;
    fetchProjectApiMock.mockResolvedValue(project);

    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={["/projects/p1/commands/settings"]}>
          <Routes>
            <Route
              path="/projects/:projectId/commands/settings"
              element={<ProjectCommandSettingsPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(
      await screen.findByRole("heading", {
        name: /Project Command Settings/i,
      })
    ).toBeInTheDocument();
    expect(fetchProjectApiMock).toHaveBeenCalledWith("p1");
  });

  it("renders project command settings sections", async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={["/projects/p1/commands/settings"]}>
          <Routes>
            <Route
              path="/projects/:projectId/commands/settings"
              element={<ProjectCommandSettingsPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(
      screen.getByRole("heading", { name: /Project Command Settings/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Commands/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Categories/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Filters/i })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: /Variables/i }).length).toBeGreaterThan(0);
  });

  it("renders labeled fields for the project command create form", async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={["/projects/p1/commands/settings"]}>
          <Routes>
            <Route
              path="/projects/:projectId/commands/settings"
              element={<ProjectCommandSettingsPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(
      screen.getByRole("heading", { name: /Project Command Settings/i })
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/new command name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/new command category/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/new command body/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/new command description/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/new command tags/i)).toBeInTheDocument();
  });

  it("keeps the project command create form available when the project has no saved commands yet", () => {
    commandSettingsState.commands = [];
    commandSettingsState.categories = [];
    commandSettingsState.filters = [];
    projectStoreState.currentProject = {
      id: "p1",
      name: "Empty Project",
      variables: {},
    };
    fetchProjectApiMock.mockResolvedValue(projectStoreState.currentProject);

    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={["/projects/p1/commands/settings"]}>
          <Routes>
            <Route
              path="/projects/:projectId/commands/settings"
              element={<ProjectCommandSettingsPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(screen.getByRole("heading", { name: /Project Command Settings/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/new command name/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add command/i })).toBeInTheDocument();
  });
});
