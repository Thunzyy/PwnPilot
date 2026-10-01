import { beforeEach, describe, expect, it, vi } from "vitest";

const { commandsApiMock } = vi.hoisted(() => ({
  commandsApiMock: {
    listGlobalCommands: vi.fn(),
    listGlobalCategories: vi.fn(),
    listGlobalFilters: vi.fn(),
    getGlobalVariables: vi.fn(),
    createProjectCommand: vi.fn(),
    updateProjectCommand: vi.fn(),
    deleteProjectCommand: vi.fn(),
    updateGlobalVariables: vi.fn(),
  },
}));

vi.mock("../api/commands", () => ({
  commandsApi: commandsApiMock,
}));

import { useCommandSettingsStore } from "../stores/commandSettingsStore";

const resetStore = () => {
  useCommandSettingsStore.setState({
    commands: [],
    categories: [],
    filters: [],
    variables: {},
    isLoading: false,
    error: null,
  });
};

describe("commandSettingsStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("loads global settings", async () => {
    commandsApiMock.listGlobalCommands.mockResolvedValue([
      {
        id: "cmd-1",
        name: "Global Command",
        category: "Recon",
        command: "whoami",
        description: null,
        tags: [],
        is_custom: true,
        scope: "global",
        project_id: null,
      },
    ]);
    commandsApiMock.listGlobalCategories.mockResolvedValue([
      {
        id: "cat-1",
        name: "Recon",
        sort_order: 1,
        scope: "global",
        project_id: null,
      },
    ]);
    commandsApiMock.listGlobalFilters.mockResolvedValue([
      {
        id: "filter-1",
        name: "Nmap",
        sort_order: 2,
        scope: "global",
        project_id: null,
      },
    ]);
    commandsApiMock.getGlobalVariables.mockResolvedValue({
      target_ip: "10.10.10.10",
    });

    await useCommandSettingsStore.getState().loadGlobalSettings();

    const state = useCommandSettingsStore.getState();
    expect(state.commands).toHaveLength(1);
    expect(state.categories).toHaveLength(1);
    expect(state.filters).toHaveLength(1);
    expect(state.variables).toEqual({ target_ip: "10.10.10.10" });
    expect(state.error).toBeNull();
  });

  it("updates global variables", async () => {
    commandsApiMock.updateGlobalVariables.mockResolvedValue({
      port: "443",
    });

    await useCommandSettingsStore.getState().updateGlobalVariables({
      port: "443",
    });

    expect(useCommandSettingsStore.getState().variables).toEqual({
      port: "443",
    });
  });

  it("creates a project command", async () => {
    commandsApiMock.createProjectCommand.mockResolvedValue({
      id: "cmd-project-1",
      name: "HTTP probe",
      category: "Recon",
      command: "curl -I http://$target_ip",
      description: "Probe the target over HTTP",
      tags: ["http"],
      is_custom: true,
      scope: "project",
      project_id: "p1",
    });

    await useCommandSettingsStore.getState().createProjectCommand("p1", {
      name: "HTTP probe",
      category: "Recon",
      command: "curl -I http://$target_ip",
      description: "Probe the target over HTTP",
      tags: ["http"],
      is_custom: true,
    });

    expect(commandsApiMock.createProjectCommand).toHaveBeenCalledWith("p1", {
      name: "HTTP probe",
      category: "Recon",
      command: "curl -I http://$target_ip",
      description: "Probe the target over HTTP",
      tags: ["http"],
      is_custom: true,
    });
    expect(useCommandSettingsStore.getState().commands).toEqual([
      expect.objectContaining({
        id: "cmd-project-1",
        name: "HTTP probe",
        scope: "project",
      }),
    ]);
  });

  it("updates a project command in place", async () => {
    useCommandSettingsStore.setState({
      commands: [
        {
          id: "cmd-project-1",
          name: "HTTP probe",
          category: "Recon",
          command: "curl -I http://$target_ip",
          description: "Initial",
          tags: ["http"],
          is_custom: true,
          scope: "project",
          project_id: "p1",
        },
      ],
    });

    commandsApiMock.updateProjectCommand.mockResolvedValue({
      id: "cmd-project-1",
      name: "HTTP probe",
      category: "Recon",
      command: "curl -skI https://$target_ip",
      description: "Updated",
      tags: ["http", "tls"],
      is_custom: true,
      scope: "project",
      project_id: "p1",
    });

    await useCommandSettingsStore.getState().updateProjectCommand(
      "p1",
      "cmd-project-1",
      {
        command: "curl -skI https://$target_ip",
        description: "Updated",
        tags: ["http", "tls"],
      }
    );

    expect(commandsApiMock.updateProjectCommand).toHaveBeenCalledWith(
      "p1",
      "cmd-project-1",
      {
        command: "curl -skI https://$target_ip",
        description: "Updated",
        tags: ["http", "tls"],
      }
    );
    expect(useCommandSettingsStore.getState().commands).toEqual([
      expect.objectContaining({
        command: "curl -skI https://$target_ip",
        description: "Updated",
      }),
    ]);
  });

  it("deletes a project command", async () => {
    useCommandSettingsStore.setState({
      commands: [
        {
          id: "cmd-project-1",
          name: "HTTP probe",
          category: "Recon",
          command: "curl -I http://$target_ip",
          description: "Initial",
          tags: ["http"],
          is_custom: true,
          scope: "project",
          project_id: "p1",
        },
      ],
    });
    commandsApiMock.deleteProjectCommand.mockResolvedValue(undefined);

    await useCommandSettingsStore
      .getState()
      .deleteProjectCommand("p1", "cmd-project-1");

    expect(commandsApiMock.deleteProjectCommand).toHaveBeenCalledWith(
      "p1",
      "cmd-project-1"
    );
    expect(useCommandSettingsStore.getState().commands).toEqual([]);
  });
});
