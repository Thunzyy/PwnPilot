import { QueryClientProvider } from "@tanstack/react-query";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  waitForElementToBeRemoved,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { createQueryClient } from "../lib/queryClient";

const { fetchProjects, createProject, engagementApi, projectQueryKeys } = vi.hoisted(() => ({
  fetchProjects: vi.fn(async () => []),
  createProject: vi.fn(async () => ({
    id: "proj-1",
    name: "HTB - Forest",
    type: "custom",
    status: "active",
    variables: {},
    slug: "htb-forest",
    workspace_path: "/tmp/htb-forest",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  })),
  engagementApi: {
    getProjectState: vi.fn(async () => ({
      version: "v1",
      sections: [],
      graph: { nodes: [], edges: [] },
      progress: 0,
      source: "derived",
    })),
  },
  projectQueryKeys: {
    all: ["projects"],
    detail: (projectId: string) => ["projects", projectId],
  },
}));

vi.mock("../stores/authStore", () => ({
  useAuthStore: () => ({
    user: {
      id: "user-1",
      username: "operator",
      email: "operator@example.com",
      is_super_admin: true,
    },
    initialize: vi.fn(),
    isLoading: false,
    logout: vi.fn(),
  }),
}));

vi.mock("../stores/projectStore", () => ({
  useProjectStore: () => {
    throw new Error("Dashboard should use React Query for project server state");
  },
}));

vi.mock("../stores/settingsStore", () => ({
  useSettingsStore: (selector?: (state: { settings: { workspace_base_path: string } }) => unknown) =>
    selector
      ? selector({ settings: { workspace_base_path: "C:/PwnPilot/workspace" } })
      : { settings: { workspace_base_path: "C:/PwnPilot/workspace" } },
}));

vi.mock("../api/projects", () => ({
  fetchProjects,
  createProject,
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  projectQueryKeys,
}));

vi.mock("../api/engagement", () => ({
  engagementApi,
}));

vi.mock("../components/Layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../pages/ProjectView", () => ({
  ProjectView: () => <div>Project View</div>,
}));

import App from "../App";

describe("New project flow", () => {
  it("navigates to project after creation", async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter>
          <App />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitForElementToBeRemoved(
      () => screen.queryByText(/Loading dashboard/i),
      { timeout: 15_000 }
    );

    fireEvent.click(
      await screen.findByRole("button", { name: /New Project/i })
    );
    const nameInput = await screen.findByLabelText(/Project Name/i);
    fireEvent.change(nameInput, { target: { value: "HTB - Forest" } });
    fireEvent.click(
      screen.getByRole("button", { name: /Initialize Project/i })
    );

    await waitFor(() =>
      expect(screen.getByText(/Project View/i)).toBeInTheDocument()
    );
    expect(fetchProjects).toHaveBeenCalledTimes(1);
    expect(createProject).toHaveBeenCalledTimes(1);
  }, 20_000);
});
