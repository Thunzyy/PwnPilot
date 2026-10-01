import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createQueryClient } from "../lib/queryClient";

const {
  updateProjectMock,
  deleteProjectMock,
  fetchProjectApiMock,
  getProjectAccessErrorStateMock,
  projectQueryKeys,
  projectStoreState,
  selectProjectMock,
} = vi.hoisted(() => ({
  updateProjectMock: vi.fn(),
  deleteProjectMock: vi.fn(),
  fetchProjectApiMock: vi.fn(),
  getProjectAccessErrorStateMock: vi.fn(() => null),
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
          type: "custom";
          status: "active";
          variables: Record<string, string>;
          slug: string;
          workspace_path: string;
          created_at: string;
          updated_at: string;
        },
  },
  selectProjectMock: vi.fn((project: unknown) => {
    projectStoreState.currentProject = project as typeof projectStoreState.currentProject;
  }),
}));

const project = {
  id: "p1",
  name: "Test Project",
  type: "custom",
  status: "active",
  variables: {},
  slug: "test-project",
  workspace_path: "/tmp/test",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

const { fetchSettingsMock, settingsQueryKeys } = vi.hoisted(() => ({
  fetchSettingsMock: vi.fn(async () => ({
    workspace_base_path: "PwnPilot/project",
    vault_path: "",
    vpn_path: "",
    vpn_content: "",
    vpn_platform_defaults: {
      htb: {
        label: "Hack The Box",
        config_path: "/vpn/htb.ovpn",
        connect_command: "sudo openvpn {{vpn_path}}",
      },
      academy: {
        label: "HTB Academy",
        config_path: "/vpn/academy.ovpn",
        connect_command: "sudo openvpn {{vpn_path}}",
        file_name: "academy.ovpn",
        managed: true,
      },
    },
  })),
  settingsQueryKeys: {
    current: ["settings"],
  },
}));

const { authState } = vi.hoisted(() => ({
  authState: {
    user: {
      id: "user-1",
      username: "operator",
      email: "operator@example.test",
      is_super_admin: true,
    },
  },
}));

vi.mock("../api/projects", () => ({
  fetchProject: fetchProjectApiMock,
  getProjectAccessErrorState: getProjectAccessErrorStateMock,
  projectQueryKeys,
}));

vi.mock("../stores/projectStore", () => ({
  useProjectStore: () => ({
    currentProject: projectStoreState.currentProject,
    selectProject: selectProjectMock,
    updateProject: updateProjectMock,
    deleteProject: deleteProjectMock,
  }),
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (
    selector?: (state: typeof authState) => unknown
  ) => (selector ? selector(authState) : authState),
}));

vi.mock("../components/Projects/ProjectTeamPanel", () => ({
  ProjectTeamPanel: () => <div data-testid="project-team-panel" />,
}));

vi.mock("../components/Settings/SystemPromptSelector", () => ({
  SystemPromptSelector: ({ scope }: { scope: string }) => (
    <div data-testid="system-prompt-selector">{scope}-system-prompt</div>
  ),
}));

vi.mock("@/api/settings", () => ({
  fetchSettings: fetchSettingsMock,
  settingsQueryKeys,
}));

import { ProjectSettingsPage } from "../pages/ProjectSettings";

const renderSettings = () =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={["/projects/p1/settings"]}>
        <Routes>
          <Route
            path="/projects/:projectId/settings"
            element={<ProjectSettingsPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

describe("ProjectSettingsPage", () => {
  beforeEach(() => {
    projectStoreState.currentProject = project;
    updateProjectMock.mockReset();
    deleteProjectMock.mockReset();
    fetchProjectApiMock.mockReset();
    getProjectAccessErrorStateMock.mockReset();
    getProjectAccessErrorStateMock.mockReturnValue(null);
    fetchProjectApiMock.mockResolvedValue(project);
    selectProjectMock.mockClear();
    fetchSettingsMock.mockClear();
    authState.user = {
      id: "user-1",
      username: "operator",
      email: "operator@example.test",
      is_super_admin: true,
    };
  });

  it("loads project detail through react query when store cache is empty", async () => {
    projectStoreState.currentProject = null;

    renderSettings();

    expect(await screen.findByText("Test Project")).toBeInTheDocument();
    expect(fetchProjectApiMock).toHaveBeenCalledWith("p1");
    expect(selectProjectMock).toHaveBeenCalledWith(project);
  });

  it("does not fetch global settings for non-super-admin project members", async () => {
    authState.user = {
      id: "user-2",
      username: "member",
      email: "member@example.test",
      is_super_admin: false,
    };

    renderSettings();

    expect(await screen.findByText("Test Project")).toBeInTheDocument();
    expect(fetchSettingsMock).not.toHaveBeenCalled();
  });

  it("renders nav and sections", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    renderSettings();

    expect(screen.getAllByText(/Overview/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Variables/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/VPN/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Notes/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Team/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Danger Zone/i).length).toBeGreaterThan(0);
    expect(screen.getByTestId("system-prompt-selector")).toBeInTheDocument();

    await new Promise((resolve) => setTimeout(resolve, 0));

    const loggedOutput = consoleErrorSpy.mock.calls.flat().map(String).join("\n");
    expect(loggedOutput).not.toContain("socket hang up");
  });

  it("saves overview updates", async () => {
    updateProjectMock.mockResolvedValue({ ...project, name: "New Name" });

    renderSettings();

    fireEvent.change(screen.getByLabelText(/Project Name/i), {
      target: { value: "New Name" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save Overview/i }));

    await waitFor(() =>
      expect(updateProjectMock).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ name: "New Name" })
      )
    );
  });

  it("saves variables updates", async () => {
    updateProjectMock.mockResolvedValue({
      ...project,
      variables: { target_ip: "10.10.10.5" },
    });

    renderSettings();

    const variablesHeading = screen.getByRole("heading", { name: /Variables/i });
    const variablesSection = variablesHeading.closest("section");
    if (!variablesSection) {
      throw new Error("Variables section not found");
    }

    const keyInputs = within(variablesSection).getAllByLabelText(/Variable Key/i);
    const valueInputs = within(variablesSection).getAllByLabelText(/Variable Value/i);

    fireEvent.change(keyInputs[0], { target: { value: "target_ip" } });
    fireEvent.change(valueInputs[0], { target: { value: "10.10.10.5" } });
    fireEvent.click(
      within(variablesSection).getByRole("button", { name: /Save Variables/i })
    );

    await waitFor(() =>
      expect(updateProjectMock).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({
          variables: expect.objectContaining({ target_ip: "10.10.10.5" }),
        })
      )
    );
  });

  it("saves vpn and notes updates", async () => {
    const vpnProject = {
      ...project,
      variables: {
        vpn_platform: "academy",
      },
    };
    projectStoreState.currentProject = vpnProject;
    fetchProjectApiMock.mockResolvedValue(vpnProject);
    updateProjectMock.mockResolvedValue({
      ...vpnProject,
      variables: {
        vpn_platform: "htb",
        vpn_path: "/opt/vpn.ovpn",
        vpn_content: "client\nremote 10.0.0.1",
        notes: "Initial recon",
      },
    });

    renderSettings();

    const vpnHeading = screen.getByRole("heading", { name: /VPN/i });
    const vpnSection = vpnHeading.closest("section");
    if (!vpnSection) {
      throw new Error("VPN section not found");
    }

    await screen.findByDisplayValue("academy");
    fireEvent.change(within(vpnSection).getByLabelText(/VPN Platform/i), {
      target: { value: "htb" },
    });
    fireEvent.change(within(vpnSection).getByLabelText(/VPN file path/i), {
      target: { value: "/opt/vpn.ovpn" },
    });
    fireEvent.change(within(vpnSection).getByLabelText(/VPN file content/i), {
      target: { value: "client\nremote 10.0.0.1" },
    });
    fireEvent.click(within(vpnSection).getByRole("button", { name: /Save VPN/i }));

    const notesHeading = screen.getByRole("heading", { name: /Notes/i });
    const notesSection = notesHeading.closest("section");
    if (!notesSection) {
      throw new Error("Notes section not found");
    }

    fireEvent.change(within(notesSection).getByLabelText(/Notes/i), {
      target: { value: "Initial recon" },
    });
    fireEvent.click(
      within(notesSection).getByRole("button", { name: /Save Notes/i })
    );

    await waitFor(() =>
      expect(updateProjectMock).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({
          variables: expect.objectContaining({
            vpn_platform: "htb",
            vpn_path: "/opt/vpn.ovpn",
            vpn_content: "client\nremote 10.0.0.1",
          }),
        })
      )
    );

    await waitFor(() =>
      expect(updateProjectMock).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({
          variables: expect.objectContaining({ notes: "Initial recon" }),
        })
      )
    );
  });

  it("deletes project from danger zone", async () => {
    deleteProjectMock.mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    renderSettings();

    const dangerHeading = screen.getByRole("heading", { name: /Danger Zone/i });
    const dangerSection = dangerHeading.closest("section");
    if (!dangerSection) {
      throw new Error("Danger section not found");
    }

    fireEvent.click(
      within(dangerSection).getByRole("button", { name: /Delete Project/i })
    );

    await waitFor(() => {
      expect(deleteProjectMock).toHaveBeenCalledWith("p1");
    });

    confirmSpy.mockRestore();
  });
});
