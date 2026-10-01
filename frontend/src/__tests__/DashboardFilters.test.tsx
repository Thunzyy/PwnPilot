import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../lib/queryClient";
import { Dashboard } from "../pages/Dashboard";

const {
  updateProject,
  deleteProject,
  fetchProjects,
  createProject,
  engagementApi,
  navigateMock,
  settingsState,
  projectQueryKeys,
} = vi.hoisted(() => ({
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  fetchProjects: vi.fn(),
  createProject: vi.fn(),
  engagementApi: {
    getProjectState: vi.fn(),
  },
  navigateMock: vi.fn(),
  settingsState: {
    settings: {
      workspace_base_path: "C:/PwnPilot/workspace",
    },
  },
  projectQueryKeys: {
    all: ["projects"],
    detail: (projectId: string) => ["projects", projectId],
  },
}));

vi.mock("../stores/projectStore", () => ({
  useProjectStore: () => {
    throw new Error("Dashboard should use React Query for project server state");
  },
}));

vi.mock("../stores/settingsStore", () => ({
  useSettingsStore: (selector?: (state: typeof settingsState) => unknown) =>
    selector ? selector(settingsState) : settingsState,
}));

vi.mock("../api/projects", () => ({
  fetchProjects,
  createProject,
  updateProject,
  deleteProject,
  projectQueryKeys,
}));

vi.mock("../api/engagement", () => ({
  engagementApi,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );

  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

const projectOne = {
  id: "p1",
  name: "Project One",
  type: "custom" as const,
  status: "active" as const,
  variables: {},
  slug: "project-one",
  workspace_path: "/tmp/project-one",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

const projectTwo = {
  id: "p2",
  name: "Project Two",
  type: "custom" as const,
  status: "completed" as const,
  variables: {},
  slug: "project-two",
  workspace_path: "/tmp/project-two",
  created_at: "2024-01-02T00:00:00Z",
  updated_at: "2024-01-02T00:00:00Z",
};

const getCardByName = (name: string) => {
  const title = screen.getByText(name);
  const card = title.closest(".group");
  if (!card) {
    throw new Error(`Card not found for project: ${name}`);
  }
  return card;
};

const renderDashboard = () =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>
  );

describe("Dashboard filters", () => {
  beforeAll(() => {
    if (!window.PointerEvent) {
      // @ts-expect-error - jsdom polyfill for Radix pointer events
      window.PointerEvent = window.MouseEvent;
    }
  });

  beforeEach(() => {
    updateProject.mockClear();
    deleteProject.mockClear();
    fetchProjects.mockClear();
    createProject.mockClear();
    navigateMock.mockClear();
    engagementApi.getProjectState.mockReset();
    fetchProjects.mockResolvedValue([]);
    createProject.mockResolvedValue(projectOne);
    engagementApi.getProjectState.mockResolvedValue({
      version: "v1",
      sections: [],
      graph: { nodes: [], edges: [] },
      progress: 65,
      source: "derived",
    });
  });

  it("loads projects through the query layer", async () => {
    fetchProjects.mockResolvedValue([projectOne]);

    renderDashboard();

    await waitFor(() => expect(fetchProjects).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Project One")).toBeInTheDocument();
  });

  it("renders engagement progress instead of status fallback when available", async () => {
    fetchProjects.mockResolvedValue([projectOne]);
    engagementApi.getProjectState.mockResolvedValue({
      version: "v1",
      sections: [],
      graph: { nodes: [], edges: [] },
      progress: 100,
      source: "stored",
    });

    renderDashboard();

    await screen.findByText("Project One");
    await waitFor(() =>
      expect(engagementApi.getProjectState).toHaveBeenCalledWith("p1")
    );

    const card = getCardByName("Project One");
    expect(within(card).getByText("100%")).toBeInTheDocument();
    expect(within(card).queryByText("65%")).not.toBeInTheDocument();
  });

  it("includes active projects with complete engagement progress in the completed filter", async () => {
    const activeIncompleteProject = {
      ...projectTwo,
      status: "active" as const,
    };
    fetchProjects.mockResolvedValue([projectOne, activeIncompleteProject]);
    engagementApi.getProjectState.mockImplementation(async (projectId: string) => ({
      version: "v1",
      sections: [],
      graph: { nodes: [], edges: [] },
      progress: projectId === "p1" ? 100 : 26,
      source: "stored",
    }));

    renderDashboard();

    await screen.findByText("Project One");
    await waitFor(() =>
      expect(engagementApi.getProjectState).toHaveBeenCalledWith("p2")
    );

    fireEvent.click(screen.getByRole("button", { name: /^Completed$/i }));

    expect(screen.getByText("Project One")).toBeInTheDocument();
    expect(screen.queryByText("Project Two")).not.toBeInTheDocument();
  });

  it("renders dashboard stats header", async () => {
    renderDashboard();
    await waitFor(() => expect(fetchProjects).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/Projects Dashboard/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /New Project/i })
    ).toBeInTheDocument();
  });

  it("renders filter controls", async () => {
    renderDashboard();
    await waitFor(() => expect(fetchProjects).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: /All Projects/i })).toBeInTheDocument();
    expect(screen.getByText(/Sort: Most Recent/i)).toBeInTheDocument();
  });

  it("uses a scrollable root container so long project lists are not clipped", async () => {
    const view = renderDashboard();

    await waitFor(() => expect(fetchProjects).toHaveBeenCalledTimes(1));

    const root = view.container.firstElementChild;
    expect(root).not.toBeNull();
    expect(root).toHaveClass("min-h-0");
    expect(root).toHaveClass("overflow-y-auto");
  });

  it("archives, restores, and deletes from the actions menu", async () => {
    fetchProjects.mockResolvedValue([projectOne, projectTwo]);
    renderDashboard();
    await screen.findByText("Project One");

    const cardOne = getCardByName("Project One");
    const cardOneTrigger = within(cardOne).getByLabelText(/Project actions/i);
    fireEvent.pointerDown(cardOneTrigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /^Archive$/i }));
    await waitFor(() =>
      expect(updateProject).toHaveBeenCalledWith("p1", { status: "completed" })
    );

    const cardTwo = getCardByName("Project Two");
    const cardTwoTrigger = within(cardTwo).getByLabelText(/Project actions/i);
    fireEvent.pointerDown(cardTwoTrigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /^Restore$/i }));
    await waitFor(() =>
      expect(updateProject).toHaveBeenCalledWith("p2", { status: "active" })
    );

    fireEvent.pointerDown(cardOneTrigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /^Delete$/i }));
    fireEvent.click(
      await screen.findByRole("button", { name: /^Delete project$/i })
    );
    await waitFor(() => expect(deleteProject).toHaveBeenCalledWith("p1"));
  });

  it("sorts projects by newest first", async () => {
    fetchProjects.mockResolvedValue([projectOne, projectTwo]);
    renderDashboard();
    await screen.findByText("Project One");

    const newerProject = screen.getByText("Project Two");
    const olderProject = screen.getByText("Project One");

    const position = newerProject.compareDocumentPosition(olderProject);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("opens a focused project card with Space", async () => {
    fetchProjects.mockResolvedValue([projectOne]);
    renderDashboard();
    await screen.findByText("Project One");

    const card = getCardByName("Project One");
    fireEvent.keyDown(card, { key: " " });

    expect(navigateMock).toHaveBeenCalledWith("/projects/p1");
  });
});
