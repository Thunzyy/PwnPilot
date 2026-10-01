import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, within, act, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { toast } from "sonner";
import { createEngagementState } from "./factories/engagementStateFactory";
import { createQueryClient } from "../lib/queryClient";

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    className,
  }: {
    children?: ReactNode;
    onClick?: () => void;
    className?: string;
  }) => (
    <button type="button" role="menuitem" className={className} onClick={onClick}>
      {children}
    </button>
  ),
}));

const {
  sidebarMock,
  attackGraphMock,
  commandsLibraryMock,
  timelinePanelMock,
  seedPromptMock,
} = vi.hoisted(() => ({
  sidebarMock: vi.fn(),
  attackGraphMock: vi.fn(),
  commandsLibraryMock: vi.fn(),
  timelinePanelMock: vi.fn(),
  seedPromptMock: vi.fn(),
}));

const {
  fetchProjectApiMock,
  fetchProjectVpnStatusMock,
  projectQueryKeys,
  projectStoreState,
  selectProjectMock,
  updateProjectMock,
  apiPostMock,
  createReportProposalMock,
  compareReportBundleArtifactsMock,
  reportQueryKeysMock,
} = vi.hoisted(() => ({
  fetchProjectApiMock: vi.fn(),
  fetchProjectVpnStatusMock: vi.fn(),
  projectQueryKeys: {
    all: ["projects"],
    detail: (projectId: string) => ["projects", projectId],
    vpnStatus: (projectId: string) => ["projects", projectId, "vpn-status"],
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
  updateProjectMock: vi.fn(),
  apiPostMock: vi.fn(),
  createReportProposalMock: vi.fn(),
  compareReportBundleArtifactsMock: vi.fn(),
  reportQueryKeysMock: {
    detail: (projectId: string) => ["report", projectId] as const,
    proposals: (projectId: string) => ["report", projectId, "proposals"] as const,
    evidence: (projectId: string) => ["report", projectId, "evidence"] as const,
    artifactComparison: (
      projectId: string,
      baseArtifactId: string,
      targetArtifactId: string,
    ) => ["report", projectId, "artifact-comparison", baseArtifactId, targetArtifactId] as const,
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

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

const { engagementHookState } = vi.hoisted(() => ({
  engagementHookState: {
    state: {
      version: "v1" as const,
      source: "derived" as const,
      progress: 42,
      sections: [],
      graph: { nodes: [], edges: [] },
    },
    isLoading: false,
    error: null as string | null,
    replaceState: vi.fn(),
    updateGraphNode: vi.fn(),
    addGraphNode: vi.fn(),
    deleteGraphNode: vi.fn(),
    moveGraphNode: vi.fn(),
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

vi.mock("@/hooks/useProjectEngagement", () => ({
  useProjectEngagement: () => ({
    engagementState: engagementHookState.state,
    isLoading: engagementHookState.isLoading,
    error: engagementHookState.error,
    refresh: vi.fn(),
    toggleSection: vi.fn(),
    toggleItem: vi.fn(),
    replaceState: engagementHookState.replaceState,
    updateGraphNode: engagementHookState.updateGraphNode,
    addGraphNode: engagementHookState.addGraphNode,
    deleteGraphNode: engagementHookState.deleteGraphNode,
    moveGraphNode: engagementHookState.moveGraphNode,
  }),
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (
    selector?: (state: typeof authState) => unknown
  ) => (selector ? selector(authState) : authState),
}));

vi.mock("../components/Sidebar/Sidebar", () => ({
  Sidebar: (props: {
    collapsed?: boolean;
    selectedEvidenceItem?: { sectionId: string; itemId: string } | null;
  }) => {
    sidebarMock(props);
    return <div data-testid="sidebar" />;
  },
}));

vi.mock("../components/Terminal/AdvancedTerminal", () => ({
  AdvancedTerminal: (props: { onSendToAI?: (text: string) => void }) => (
    <>
      <div data-testid="terminal" />
      <button
        type="button"
        data-testid="terminal-send-to-ai"
        onClick={() =>
          props.onSendToAI?.("Terminal session: Terminal 1\n\nTranscript:\nwhoami")
        }
      >
        Terminal AI
      </button>
    </>
  ),
}));

vi.mock("../components/Commands/CommandsLibrary", () => ({
  CommandsLibrary: (props: {
    onRunCommand?: (command: string) => void;
    onAskAI?: (prompt: string) => void;
  }) => {
    commandsLibraryMock(props);
    return (
      <>
        <button
          type="button"
          data-testid="run-command"
          onClick={() => props.onRunCommand?.("whoami")}
        >
          Run
        </button>
        <button
          type="button"
          data-testid="ask-ai-command"
          onClick={() => props.onAskAI?.("Find the best command for smb enumeration")}
        >
          Ask AI
        </button>
      </>
    );
  },
}));

vi.mock("../components/AI/AIChatLayout", () => ({
  AIChatLayout: () => <div data-testid="ai" />,
}));

vi.mock("../components/Timeline/TimelineView", () => ({
  TimelineView: (props: {
    onSendToAI?: (text: string) => void;
    evidenceCommandIds?: string[];
    onRevealCommandEvidence?: (commandId: string) => void;
  }) => {
    timelinePanelMock(props);
    return (
      <>
        <button
          type="button"
          data-testid="timeline-send-to-ai"
          onClick={() => props.onSendToAI?.("Command: `nmap -sV target`")}
        >
          Timeline
        </button>
        <button
          type="button"
          data-testid="timeline-reveal-evidence"
          onClick={() => props.onRevealCommandEvidence?.("command-1")}
        >
          Reveal evidence
        </button>
      </>
    );
  },
}));

vi.mock("../components/Graph/AttackGraph", () => ({
  AttackGraph: (props: {
    isCollapsed?: boolean;
    selectedGraphNodeId?: string | null;
    selectedGraphEdgeId?: string | null;
    comparisonOverlay?: unknown;
    onSendEvidenceToAI?: (text: string) => void;
    onAddEvidenceToReport?: (payload: unknown) => Promise<unknown>;
    onOpenReportEvidence?: (target: unknown) => void;
  }) => {
    attackGraphMock(props);
    return <div data-testid="graph" />;
  },
}));

vi.mock("../components/Projects/ProjectTeamPanel", () => ({
  ProjectTeamPanel: () => <div data-testid="team" />,
}));

vi.mock("../components/Projects/ProjectSetupPanel", () => ({
  ProjectSetupPanel: () => <div data-testid="setup" />,
}));

vi.mock("../components/Projects/ProjectContextPanel", () => ({
  ProjectContextPanel: () => <div data-testid="project-context" />,
}));

vi.mock("react-resizable-panels", () => ({
  Group: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="panel-group">{children}</div>
  ),
  Panel: ({
    children,
    id,
    defaultSize,
  }: {
    children: React.ReactNode;
    id?: string;
    defaultSize?: number;
  }) => (
    <div
      data-testid={id ? `panel-${id}` : undefined}
      data-panel-id={id}
      data-default-size={defaultSize}
    >
      {children}
    </div>
  ),
  Separator: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
}));

vi.mock("../pages/KnowledgeBase", () => ({
  KnowledgeBase: () => <div data-testid="project-notes" />,
}));

vi.mock("../pages/Reports", () => ({
  ReportsPage: () => <div data-testid="project-reports" />,
}));

vi.mock("../api/projects", () => ({
  fetchProject: fetchProjectApiMock,
  fetchProjectVpnStatus: fetchProjectVpnStatusMock,
  projectQueryKeys,
  getApiErrorStatus: (error: { response?: { status?: number } }) =>
    error?.response?.status ?? null,
  getProjectAccessErrorState: (error: {
    response?: {
      status?: number;
      data?: {
        error?: {
          code?: string;
          message?: string;
          details?: {
            membership_status?: string;
          };
        };
      };
    };
  }) => {
    if (error?.response?.status !== 403) {
      return null;
    }

    return {
      code: error.response?.data?.error?.code ?? "8006:AUTH_FORBIDDEN",
      message: error.response?.data?.error?.message ?? "Access denied",
      membershipStatus:
        error.response?.data?.error?.details?.membership_status ?? "none",
    };
  },
  requestProjectAccess: async (projectId: string) => {
    const response = await apiPostMock(`/projects/${projectId}/access-requests`);
    return response.data;
  },
}));

vi.mock("../api/client", () => ({
  api: {
    post: apiPostMock,
  },
}));

vi.mock("@/api/settings", () => ({
  fetchSettings: fetchSettingsMock,
  settingsQueryKeys,
}));

vi.mock("@/api/report", () => ({
  createReportProposal: createReportProposalMock,
  compareReportBundleArtifacts: compareReportBundleArtifactsMock,
  reportQueryKeys: reportQueryKeysMock,
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

vi.mock("../stores/projectStore", () => ({
  useProjectStore: (
    selector?: (state: {
      currentProject: typeof projectStoreState.currentProject;
      selectProject: typeof selectProjectMock;
      updateProject: typeof updateProjectMock;
    }) => unknown
  ) => {
    const state = {
      currentProject: projectStoreState.currentProject,
      selectProject: selectProjectMock,
      updateProject: updateProjectMock,
    };
    return selector ? selector(state) : state;
  },
}));

const queuedCommandMock = vi.fn();

vi.mock("../stores/terminalStore", () => ({
  useTerminalStore: (
    selector?: (state: {
      queuedCommand: null;
      setQueuedCommand: typeof queuedCommandMock;
    }) => unknown
  ) => {
    const state = {
      queuedCommand: null,
      setQueuedCommand: queuedCommandMock,
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock("../stores/aiComposerStore", () => ({
  useAIComposerStore: (
    selector?: (state: { seedPrompt: typeof seedPromptMock }) => unknown
  ) => {
    const state = { seedPrompt: seedPromptMock };
    return selector ? selector(state) : state;
  },
}));

import { ProjectView } from "../pages/ProjectView";

function makeDataTransfer() {
  const store = new Map<string, string>();
  return {
    setData: (type: string, value: string) => {
      store.set(type, value);
    },
    getData: (type: string) => store.get(type) ?? "",
    clearData: () => store.clear(),
    effectAllowed: "move",
    dropEffect: "move",
  };
}

async function renderProjectViewAt(
  path = "/projects/p1",
  options?: { waitFor?: "default" | "none" }
) {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/projects/:projectId/:tab?" element={<ProjectView />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

  if (options?.waitFor === "none") {
    return;
  }

  if (path.endsWith("/commands")) {
    await screen.findByTestId("ask-ai-command");
    return;
  }

  if (path.endsWith("/notes")) {
    await screen.findByTestId("project-notes");
    return;
  }

  if (path.endsWith("/context")) {
    await screen.findByTestId("project-context");
    return;
  }

  if (path.endsWith("/ai")) {
    await screen.findByTestId("ai");
    return;
  }

  if (path.endsWith("/reports")) {
    await screen.findByTestId("project-reports");
    return;
  }

  if (path.endsWith("/timeline")) {
    await screen.findByTestId("timeline-send-to-ai");
    return;
  }

  if (path.endsWith("/team")) {
    await screen.findByTestId("team");
    return;
  }

  await screen.findByTestId("terminal", undefined, { timeout: 5000 });
}

async function openVpnActionsMenu(name: RegExp) {
  const trigger = await screen.findByRole("button", { name });
  fireEvent.pointerDown(trigger);
  return trigger;
}

describe("ProjectView", () => {
  beforeEach(() => {
    localStorage.clear();
    engagementHookState.state = createEngagementState();
    engagementHookState.isLoading = false;
    engagementHookState.error = null;
    engagementHookState.replaceState.mockReset();
    engagementHookState.updateGraphNode.mockReset();
    engagementHookState.addGraphNode.mockReset();
    engagementHookState.deleteGraphNode.mockReset();
    engagementHookState.moveGraphNode.mockReset();
    projectStoreState.currentProject = project;
    fetchProjectApiMock.mockReset();
    fetchProjectApiMock.mockResolvedValue(project);
    fetchProjectVpnStatusMock.mockReset();
    fetchProjectVpnStatusMock.mockResolvedValue({
      platform_id: "htb",
      platform_label: "Hack The Box",
      button_label: "Connect HTB VPN",
      state: "disconnected",
      command: "sudo openvpn /vpn/htb.ovpn",
      disconnect_command: null,
      config_path: "/vpn/htb.ovpn",
      source_label: "Hack The Box default",
      reason: null,
      connected_process_pid: null,
      connected_process_name: null,
      connected_process_command: null,
    });
    apiPostMock.mockReset();
    selectProjectMock.mockClear();
    updateProjectMock.mockReset();
    sidebarMock.mockClear();
    attackGraphMock.mockClear();
    commandsLibraryMock.mockClear();
    timelinePanelMock.mockClear();
    seedPromptMock.mockClear();
    queuedCommandMock.mockClear();
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
    createReportProposalMock.mockReset();
    createReportProposalMock.mockResolvedValue({
      proposal: { id: "proposal-graph" },
      duplicate: false,
    });
    compareReportBundleArtifactsMock.mockReset();
    compareReportBundleArtifactsMock.mockResolvedValue({
      base: { reportRevision: 1 },
      target: { reportRevision: 2 },
      reportDiff: { changed: false, diffText: "" },
      commands: { addedIds: [], removedIds: [], unchangedIds: [] },
      graph: {
        addedNodeIds: ["node-2"],
        removedNodeIds: ["node-old"],
        addedEdgeIds: ["edge-2"],
        removedEdgeIds: ["edge-old"],
        addedNodes: [],
        removedNodes: [
          {
            id: "node-old",
            projectId: "p1",
            type: "host",
            label: "Removed host",
            createdAt: "2026-04-26T12:00:00Z",
            updatedAt: "2026-04-26T12:00:00Z",
            createdBy: "import",
            confidence: 1,
            sourceStepIds: [],
            tags: [],
            notes: null,
            position: null,
            meta: { ip: "10.10.10.10" },
          },
        ],
        addedEdges: [],
        removedEdges: [
          {
            id: "edge-old",
            projectId: "p1",
            sourceId: "node-old",
            targetId: "node-2",
            kind: "related_to",
            sourceStepId: null,
            command: null,
            tool: null,
            createdAt: "2026-04-26T12:00:00Z",
            confidence: 1,
            label: null,
            meta: {},
          },
        ],
      },
      summary: {
        addedCommands: 0,
        removedCommands: 0,
        addedNodes: 1,
        removedNodes: 1,
        addedEdges: 1,
        removedEdges: 1,
        reportChanged: false,
      },
    });
    authState.user = {
      id: "user-1",
      username: "operator",
      email: "operator@example.test",
      is_super_admin: true,
    };
    fetchSettingsMock.mockClear();
    mockNavigate.mockClear();
  });

  it("loads project detail through react query when store cache is empty", async () => {
    projectStoreState.currentProject = null;

    await renderProjectViewAt();

    expect(await screen.findByTestId("terminal")).toBeInTheDocument();
    expect(fetchProjectApiMock).toHaveBeenCalledWith("p1");
    expect(selectProjectMock).toHaveBeenCalledWith(project);
  });

  it("shows the backend VPN status failure as an actionable toast", async () => {
    fetchProjectVpnStatusMock.mockRejectedValueOnce({
      response: {
        data: {
          error: {
            message: "HTB VPN API token is missing",
          },
        },
      },
    });

    await renderProjectViewAt("/projects/p1");

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("VPN status unavailable", {
        description: "HTB VPN API token is missing",
      }),
    );
  });

  it("does not fetch global settings for non-super-admin project members", async () => {
    authState.user = {
      id: "user-2",
      username: "member",
      email: "member@example.test",
      is_super_admin: false,
    };

    await renderProjectViewAt();

    expect(await screen.findByTestId("terminal")).toBeInTheDocument();
    expect(fetchSettingsMock).not.toHaveBeenCalled();
  });

  it("shows a request access state instead of redirecting for non-members", async () => {
    projectStoreState.currentProject = null;
    fetchProjectApiMock.mockRejectedValue({
      response: {
        status: 403,
        data: {
          error: {
            code: "8006:AUTH_FORBIDDEN",
            message: "Access denied",
            details: {
              membership_status: "none",
            },
          },
        },
      },
    });

    await renderProjectViewAt("/projects/p1", { waitFor: "none" });

    expect(
      await screen.findByRole("heading", { name: /request project access/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /request access/i })
    ).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalledWith("/", { replace: true });
  });

  it("can submit an access request and transition to the pending state", async () => {
    projectStoreState.currentProject = null;
    fetchProjectApiMock.mockRejectedValue({
      response: {
        status: 403,
        data: {
          error: {
            code: "8006:AUTH_FORBIDDEN",
            message: "Access denied",
            details: {
              membership_status: "none",
            },
          },
        },
      },
    });
    apiPostMock.mockResolvedValue({
      data: {
        id: "membership-1",
        status: "pending",
        role: "member",
        source: "request",
      },
    });

    await renderProjectViewAt("/projects/p1", { waitFor: "none" });

    fireEvent.click(
      await screen.findByRole("button", { name: /request access/i })
    );

    expect(apiPostMock).toHaveBeenCalledWith("/projects/p1/access-requests");
    expect(
      await screen.findByRole("heading", { name: /access request pending/i })
    ).toBeInTheDocument();
  });

  it("shows the denied state when the backend reports a denied membership", async () => {
    projectStoreState.currentProject = null;
    fetchProjectApiMock.mockRejectedValue({
      response: {
        status: 403,
        data: {
          error: {
            code: "8006:AUTH_FORBIDDEN",
            message: "Access denied",
            details: {
              membership_status: "denied",
            },
          },
        },
      },
    });

    await renderProjectViewAt("/projects/p1", { waitFor: "none" });

    expect(
      await screen.findByRole("heading", { name: /access request denied/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /request access/i })
    ).not.toBeInTheDocument();
  });

  it("defaults to collapsed when no stored state", async () => {
    await renderProjectViewAt();

    const latestSidebarProps = sidebarMock.mock.calls.at(-1)?.[0];
    const latestGraphProps = attackGraphMock.mock.calls.at(-1)?.[0];
    expect(latestSidebarProps?.collapsed).toBe(true);
    expect(latestGraphProps?.isCollapsed).toBe(true);
  });

  it("opens the attack graph focused on a graph node query parameter", async () => {
    await renderProjectViewAt("/projects/p1?graphNodeId=node-2");

    await waitFor(() => {
      const latestGraphProps = attackGraphMock.mock.calls.at(-1)?.[0];
      expect(latestGraphProps?.isCollapsed).toBe(false);
      expect(latestGraphProps?.selectedGraphNodeId).toBe("node-2");
    });
  });

  it("opens the attack graph focused on a graph edge query parameter", async () => {
    await renderProjectViewAt("/projects/p1?graphEdgeId=edge-2");

    await waitFor(() => {
      const latestGraphProps = attackGraphMock.mock.calls.at(-1)?.[0];
      expect(latestGraphProps?.isCollapsed).toBe(false);
      expect(latestGraphProps?.selectedGraphEdgeId).toBe("edge-2");
    });
  });

  it("passes report bundle comparison query parameters to the attack graph", async () => {
    await renderProjectViewAt(
      "/projects/p1?graphComparison=report-bundle&graphBaseRevision=1&graphTargetRevision=2&graphAddedNodeIds=node-2&graphRemovedNodeIds=node-old&graphAddedEdgeIds=edge-2&graphRemovedEdgeIds=edge-old",
    );

    await waitFor(() => {
      const latestGraphProps = attackGraphMock.mock.calls.at(-1)?.[0];
      expect(latestGraphProps?.isCollapsed).toBe(false);
      expect(latestGraphProps?.comparisonOverlay).toEqual({
        source: "report-bundle",
        baseRevision: 1,
        targetRevision: 2,
        addedNodeIds: ["node-2"],
        removedNodeIds: ["node-old"],
        addedEdgeIds: ["edge-2"],
        removedEdgeIds: ["edge-old"],
      });
    });
  });

  it("loads report bundle comparison snapshots from artifact query parameters", async () => {
    await renderProjectViewAt(
      "/projects/p1?graphComparison=report-bundle&graphBaseArtifactId=artifact-1&graphTargetArtifactId=artifact-2",
    );

    await waitFor(() =>
      expect(compareReportBundleArtifactsMock).toHaveBeenCalledWith(
        "p1",
        "artifact-1",
        "artifact-2",
      ),
    );
    await waitFor(() => {
      const latestGraphProps = attackGraphMock.mock.calls.at(-1)?.[0];
      expect(latestGraphProps?.isCollapsed).toBe(false);
      expect(latestGraphProps?.comparisonOverlay).toEqual(
        expect.objectContaining({
          source: "report-bundle",
          baseRevision: 1,
          targetRevision: 2,
          addedNodeIds: ["node-2"],
          removedNodeIds: ["node-old"],
          addedEdgeIds: ["edge-2"],
          removedEdgeIds: ["edge-old"],
          removedNodes: [
            expect.objectContaining({
              id: "node-old",
              label: "Removed host",
            }),
          ],
          removedEdges: [
            expect.objectContaining({
              id: "edge-old",
              sourceId: "node-old",
              targetId: "node-2",
            }),
          ],
        }),
      );
    });
  });

  it("passes engagement data to sidebar and attack graph", async () => {
    await renderProjectViewAt();

    const latestSidebarProps = sidebarMock.mock.calls.at(-1)?.[0];
    const latestGraphProps = attackGraphMock.mock.calls.at(-1)?.[0];

    expect(Array.isArray(latestSidebarProps?.sections)).toBe(true);
    expect(typeof latestSidebarProps?.progress).toBe("number");
    expect(Array.isArray(latestGraphProps?.nodes)).toBe(true);
    expect(Array.isArray(latestGraphProps?.edges)).toBe(true);
    expect(latestGraphProps?.projectType).toBe("custom");
    expect(typeof latestGraphProps?.onLoadDemoScenario).toBe("function");
  });

  it("opens linked methodology evidence from a history command", async () => {
    engagementHookState.state = createEngagementState({
      sections: [
        {
          id: "exploitation",
          label: "Exploitation",
          isOpen: true,
          items: [
            {
              id: "exploit-remote-login",
              label: "Remote Login / Foothold",
              status: "done",
            },
          ],
        },
      ],
      graph: {
        nodes: [
          {
            id: "command-1",
            type: "success",
            status: "success",
            title: "ssh nathan@10.129.34.191",
            subtitle: "Exit 0",
            icon: "terminal",
            position: { x: "40%", y: "50%" },
            sectionId: "exploitation",
            itemId: "exploit-remote-login",
          },
        ],
        edges: [],
      },
    });

    await renderProjectViewAt("/projects/p1/timeline");

    expect(timelinePanelMock.mock.calls.at(-1)?.[0]?.evidenceCommandIds).toContain(
      "command-1"
    );

    fireEvent.click(screen.getByTestId("timeline-reveal-evidence"));

    await waitFor(() => {
      const latestSidebarProps = sidebarMock.mock.calls.at(-1)?.[0];
      const latestGraphProps = attackGraphMock.mock.calls.at(-1)?.[0];

      expect(latestSidebarProps?.collapsed).toBe(false);
      expect(latestSidebarProps?.selectedEvidenceItem).toEqual({
        sectionId: "exploitation",
        itemId: "exploit-remote-login",
      });
      expect(latestGraphProps?.isCollapsed).toBe(false);
      expect(latestGraphProps?.selectedGraphNodeId).toBe("command-1");
    });
  });

  it("hides history evidence actions when the graph node has no matching checklist item", async () => {
    engagementHookState.state = createEngagementState({
      sections: [
        {
          id: "exploitation",
          label: "Exploitation",
          isOpen: true,
          items: [
            {
              id: "exploit-remote-login",
              label: "Remote Login / Foothold",
              status: "done",
            },
          ],
        },
      ],
      graph: {
        nodes: [
          {
            id: "command-1",
            type: "success",
            status: "success",
            title: "ssh nathan@10.129.34.191",
            subtitle: "Exit 0",
            icon: "terminal",
            position: { x: "40%", y: "50%" },
            sectionId: "exploitation",
            itemId: "exploit-remote-login",
          },
          {
            id: "command-orphan",
            type: "success",
            status: "success",
            title: "legacy graph action",
            subtitle: "Exit 0",
            icon: "terminal",
            position: { x: "50%", y: "50%" },
            sectionId: "exploitation",
            itemId: "missing-checklist-item",
          },
        ],
        edges: [],
      },
    });

    await renderProjectViewAt("/projects/p1/timeline");

    expect(timelinePanelMock.mock.calls.at(-1)?.[0]?.evidenceCommandIds).toEqual([
      "command-1",
    ]);
  });

  it("can request loading the visual map demo scenario", async () => {
    await renderProjectViewAt();

    const latestGraphProps = attackGraphMock.mock.calls.at(-1)?.[0];
    await act(async () => {
      await latestGraphProps?.onLoadDemoScenario?.("ad");
    });

    expect(engagementHookState.replaceState).toHaveBeenCalledTimes(1);
    expect(
      engagementHookState.replaceState.mock.calls[0]?.[0]?.graph?.nodes?.length
    ).toBeGreaterThan(0);
    expect(engagementHookState.replaceState.mock.calls[0]?.[0]?.sections?.[0]?.id).toBe(
      "recon"
    );
    expect(
      engagementHookState.replaceState.mock.calls[0]?.[0]?.graph?.nodes?.some?.(
        (node: { title?: string }) => /bloodhound|netexec|winpeas/i.test(node.title ?? "")
      )
    ).toBe(true);
  });

  it("wires graph edit callbacks into the engagement hook", async () => {
    await renderProjectViewAt();

    const latestGraphProps = attackGraphMock.mock.calls.at(-1)?.[0];

    await act(async () => {
      await latestGraphProps?.onUpdateNode?.("demo-node", {
        title: "Edited step",
      });
      await latestGraphProps?.onAddNode?.("demo-node");
      await latestGraphProps?.onDeleteNode?.("demo-node");
      await latestGraphProps?.onMoveNode?.("demo-node", {
        x: "72%",
        y: "44%",
      });
    });

    expect(engagementHookState.updateGraphNode).toHaveBeenCalledWith(
      "demo-node",
      expect.objectContaining({ title: "Edited step" })
    );
    expect(engagementHookState.addGraphNode).toHaveBeenCalledWith("demo-node");
    expect(engagementHookState.deleteGraphNode).toHaveBeenCalledWith("demo-node");
    expect(engagementHookState.moveGraphNode).toHaveBeenCalledWith("demo-node", {
      x: "72%",
      y: "44%",
    });
  });

  it("forwards engagement loading state to sidebar and attack graph", async () => {
    engagementHookState.isLoading = true;

    await renderProjectViewAt();

    const latestSidebarProps = sidebarMock.mock.calls.at(-1)?.[0];
    const latestGraphProps = attackGraphMock.mock.calls.at(-1)?.[0];
    expect(latestSidebarProps?.isLoading).toBe(true);
    expect(latestGraphProps?.isLoading).toBe(true);
  });

  it("forwards engagement error state to sidebar and attack graph", async () => {
    engagementHookState.error = "Failed to load project engagement state";

    await renderProjectViewAt();

    const latestSidebarProps = sidebarMock.mock.calls.at(-1)?.[0];
    const latestGraphProps = attackGraphMock.mock.calls.at(-1)?.[0];
    expect(latestSidebarProps?.errorMessage).toBe(
      "Failed to load project engagement state"
    );
    expect(latestGraphProps?.errorMessage).toBe(
      "Failed to load project engagement state"
    );
  });

  it("uses stored sidebar state but keeps the graph collapsed on load", async () => {
    localStorage.setItem("pwnpilot:project:p1:sidebarCollapsed", "false");
    localStorage.setItem("pwnpilot:project:p1:graphCollapsed", "false");

    await renderProjectViewAt();

    const latestSidebarProps = sidebarMock.mock.calls.at(-1)?.[0];
    const latestGraphProps = attackGraphMock.mock.calls.at(-1)?.[0];
    expect(latestSidebarProps?.collapsed).toBe(false);
    expect(latestGraphProps?.isCollapsed).toBe(true);
  });

  it("opens project settings", async () => {
    await renderProjectViewAt();

    fireEvent.click(
      screen.getByRole("button", { name: /Project Settings/i })
    );

    expect(mockNavigate).toHaveBeenCalledWith("/projects/p1/settings");
  });

  it("uses global surface tokens in project view header", async () => {
    await renderProjectViewAt();

    const header = screen.getByRole("tablist").parentElement;
    expect(header?.className).toContain("bg-surface-dark");
  });

  it("queues a run command and navigates to terminal", async () => {
    await renderProjectViewAt("/projects/p1/commands");

    fireEvent.click(screen.getByTestId("run-command"));

    expect(queuedCommandMock).toHaveBeenCalledWith("whoami");
    expect(mockNavigate).toHaveBeenCalledWith("/projects/p1");
  });

  it("connects the platform vpn from the project header", async () => {
    const vpnProject = {
      ...project,
      type: "htb" as const,
      variables: {},
    };
    projectStoreState.currentProject = vpnProject;
    fetchProjectApiMock.mockResolvedValue(vpnProject);

    await renderProjectViewAt();

    await openVpnActionsMenu(/HTB VPN actions/i);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Connect HTB VPN/i })
    );

    expect(queuedCommandMock).toHaveBeenCalledWith(
      "sudo openvpn /vpn/htb.ovpn"
    );
    expect(mockNavigate).toHaveBeenCalledWith("/projects/p1");
  });

  it("connects the selected managed vpn platform from the project header", async () => {
    const vpnProject = {
      ...project,
      type: "custom" as const,
      variables: {
        vpn_platform: "academy",
      },
    };
    projectStoreState.currentProject = vpnProject;
    fetchProjectApiMock.mockResolvedValue(vpnProject);
    fetchProjectVpnStatusMock.mockResolvedValue({
      platform_id: "academy",
      platform_label: "HTB Academy",
      button_label: "Connect HTB Academy VPN",
      state: "disconnected",
      command: "sudo openvpn /vpn/academy.ovpn",
      disconnect_command: null,
      config_path: "/vpn/academy.ovpn",
      source_label: "HTB Academy default",
      reason: null,
      connected_process_pid: null,
      connected_process_name: null,
      connected_process_command: null,
    });

    await renderProjectViewAt();

    await openVpnActionsMenu(/HTB Academy VPN actions/i);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Connect HTB Academy VPN/i })
    );

    expect(queuedCommandMock).toHaveBeenCalledWith(
      "sudo openvpn /vpn/academy.ovpn"
    );
    expect(mockNavigate).toHaveBeenCalledWith("/projects/p1");
  });

  it("shows the project vpn status in the header", async () => {
    fetchProjectVpnStatusMock.mockResolvedValue({
      platform_id: "htb",
      platform_label: "Hack The Box",
      button_label: "Connect HTB VPN",
      state: "connected",
      command: "sudo openvpn /vpn/htb.ovpn",
      disconnect_command: "sudo kill 4242",
      config_path: "/vpn/htb.ovpn",
      source_label: "Hack The Box default",
      reason: null,
      connected_process_pid: 4242,
      connected_process_name: "openvpn",
      connected_process_command: "openvpn /vpn/htb.ovpn",
    });

    await renderProjectViewAt();

    const vpnActions = await screen.findByRole("button", {
      name: /HTB VPN actions/i,
    });
    expect(within(vpnActions).getByText(/Hack The Box/i)).toBeInTheDocument();
    expect(within(vpnActions).getByText(/VPN connected/i)).toBeInTheDocument();

    await openVpnActionsMenu(/HTB VPN actions/i);

    expect(
      await screen.findByRole("menuitem", { name: /Reconnect HTB VPN/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Disconnect HTB VPN/i })
    ).toBeInTheDocument();
  });

  it("disconnects the platform vpn from the project header", async () => {
    fetchProjectVpnStatusMock.mockResolvedValue({
      platform_id: "htb",
      platform_label: "Hack The Box",
      button_label: "Connect HTB VPN",
      state: "connected",
      command: "sudo openvpn /vpn/htb.ovpn",
      disconnect_command: "sudo kill 4242",
      config_path: "/vpn/htb.ovpn",
      source_label: "Hack The Box default",
      reason: null,
      connected_process_pid: 4242,
      connected_process_name: "openvpn",
      connected_process_command: "openvpn /vpn/htb.ovpn",
    });

    await renderProjectViewAt();

    await openVpnActionsMenu(/HTB VPN actions/i);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Disconnect HTB VPN/i })
    );

    expect(queuedCommandMock).toHaveBeenCalledWith("sudo kill 4242");
    expect(mockNavigate).toHaveBeenCalledWith("/projects/p1");
  });

  it("shows a missing vpn configuration state without a connect action", async () => {
    fetchProjectVpnStatusMock.mockResolvedValue({
      platform_id: "htb",
      platform_label: "Hack The Box",
      button_label: "Connect HTB VPN",
      state: "missing",
      command: null,
      disconnect_command: null,
      config_path: "",
      source_label: "missing",
      reason: "Configure a VPN path or upload a VPN file for Hack The Box.",
      connected_process_pid: null,
      connected_process_name: null,
      connected_process_command: null,
    });

    const vpnProject = {
      ...project,
      type: "htb" as const,
      variables: {},
    };
    projectStoreState.currentProject = vpnProject;
    fetchProjectApiMock.mockResolvedValue(vpnProject);

    await renderProjectViewAt();

    expect(await screen.findByText(/VPN not configured/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /HTB VPN actions/i })
    ).not.toBeInTheDocument();
  });

  it("routes command library AI handoff into the project AI tab", async () => {
    await renderProjectViewAt("/projects/p1/commands");

    fireEvent.click(screen.getByTestId("ask-ai-command"));

    expect(seedPromptMock).toHaveBeenCalledWith(
      "Find the best command for smb enumeration",
      "commands"
    );
    expect(mockNavigate).toHaveBeenCalledWith("/projects/p1/ai");
  });

  it("routes timeline handoff into the project AI tab", async () => {
    await renderProjectViewAt("/projects/p1/timeline");

    fireEvent.click(screen.getByTestId("timeline-send-to-ai"));

    expect(seedPromptMock).toHaveBeenCalledWith(
      "Command: `nmap -sV target`",
      "timeline"
    );
    expect(mockNavigate).toHaveBeenCalledWith("/projects/p1/ai");
  });

  it("routes terminal handoff into the project AI tab", async () => {
    await renderProjectViewAt();

    fireEvent.click(screen.getByTestId("terminal-send-to-ai"));

    expect(seedPromptMock).toHaveBeenCalledWith(
      "Terminal session: Terminal 1\n\nTranscript:\nwhoami",
      "terminal"
    );
    expect(mockNavigate).toHaveBeenCalledWith("/projects/p1/ai");
  });

  it("routes attack graph evidence handoff into the project AI tab", async () => {
    await renderProjectViewAt();

    const latestGraphProps = attackGraphMock.mock.calls.at(-1)?.[0];
    latestGraphProps?.onSendEvidenceToAI?.(
      "Attack graph evidence\nNode: WEB01 (host)"
    );

    expect(seedPromptMock).toHaveBeenCalledWith(
      "Attack graph evidence\nNode: WEB01 (host)",
      "graph"
    );
    expect(mockNavigate).toHaveBeenCalledWith("/projects/p1/ai");
  });

  it("creates a report proposal from attack graph evidence", async () => {
    await renderProjectViewAt();

    const payload = {
      sectionHint: "enumeration",
      contentMd: "### WEB01 evidence",
      summary: "Add WEB01 evidence from nmap",
      triggerType: "graph_evidence",
      evidence: [{ sourceType: "command_history", sourceId: "cmd-nmap" }],
    };
    const latestGraphProps = attackGraphMock.mock.calls.at(-1)?.[0];

    await latestGraphProps?.onAddEvidenceToReport?.(payload);

    expect(createReportProposalMock).toHaveBeenCalledWith("p1", payload);
  });

  it("shows backend details when attack graph evidence cannot be added to a report", async () => {
    createReportProposalMock.mockRejectedValueOnce({
      response: {
        data: {
          detail: "Report proposal queue is unavailable.",
        },
      },
    });
    await renderProjectViewAt();

    const payload = {
      sectionHint: "enumeration",
      contentMd: "### WEB01 evidence",
      summary: "Add WEB01 evidence from nmap",
      triggerType: "graph_evidence",
      evidence: [{ sourceType: "command_history", sourceId: "cmd-nmap" }],
    };
    const latestGraphProps = attackGraphMock.mock.calls.at(-1)?.[0];

    await act(async () => {
      await latestGraphProps?.onAddEvidenceToReport?.(payload).catch(() => undefined);
    });

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Failed to add evidence to report", {
        description: "Report proposal queue is unavailable.",
      }),
    );
  });

  it("renders notes tab content when route is /projects/:id/notes", async () => {
    await renderProjectViewAt("/projects/p1/notes");

    expect(screen.getByTestId("project-notes")).toBeInTheDocument();
  });

  it("renders reports tab content when route is /projects/:id/reports", async () => {
    await renderProjectViewAt("/projects/p1/reports");

    expect(screen.getByTestId("project-reports")).toBeInTheDocument();
  });

  it("renders context tab content when route is /projects/:id/context", async () => {
    await renderProjectViewAt("/projects/p1/context");

    expect(screen.getByTestId("project-context")).toBeInTheDocument();
  });

  it("uses a tabbed split view for the secondary project pane", async () => {
    await renderProjectViewAt();

    fireEvent.click(
      screen.getByRole("button", { name: /Toggle parallel view/i })
    );

    expect(
      screen.queryByRole("combobox", { name: /Parallel tab/i })
    ).not.toBeInTheDocument();

    const parallelPane = screen.getByTestId("parallel-pane");
    const aiTabInParallelPane = within(parallelPane).getByRole("tab", {
      name: /AI Assistant/i,
    });
    expect(aiTabInParallelPane).toBeInTheDocument();

    fireEvent.mouseDown(aiTabInParallelPane, { button: 0 });
    expect(localStorage.getItem("pwnpilot:project:p1:parallelTab")).toBe("ai");
    expect(
      within(parallelPane).getByRole("tab", { name: /AI Assistant/i })
    ).toHaveAttribute("data-state", "active");

    expect(await screen.findByTestId("ai")).toBeInTheDocument();
  });

  it("starts split panels at equivalent width", async () => {
    await renderProjectViewAt();

    fireEvent.click(
      screen.getByRole("button", { name: /Toggle parallel view/i })
    );

    await screen.findByTestId("project-notes");

    expect(screen.getByTestId("panel-terminal-panel-main")).toHaveAttribute(
      "data-default-size",
      "50"
    );
    expect(screen.getByTestId("panel-terminal-panel-side")).toHaveAttribute(
      "data-default-size",
      "50"
    );
  });

  it("opens split view from tab context menu", async () => {
    await renderProjectViewAt();

    fireEvent.contextMenu(screen.getByRole("tab", { name: /AI Assistant/i }));
    fireEvent.click(screen.getByRole("button", { name: /Split view/i }));

    await screen.findByTestId("ai");

    expect(screen.getByTestId("parallel-pane")).toBeInTheDocument();
    expect(localStorage.getItem("pwnpilot:project:p1:parallelViewEnabled")).toBe(
      "true"
    );
    expect(localStorage.getItem("pwnpilot:project:p1:parallelTab")).toBe("ai");
  });

  it("supports drag and drop to open split view", async () => {
    await renderProjectViewAt();

    const notesTab = screen.getByRole("tab", { name: /Notes/i });
    const dataTransfer = makeDataTransfer();
    fireEvent.dragStart(notesTab, { dataTransfer });

    const dropZone = screen.getByTestId("project-split-dropzone");
    fireEvent.dragOver(dropZone, { dataTransfer });
    fireEvent.drop(dropZone, { dataTransfer });

    await screen.findByTestId("project-notes");

    expect(screen.getByTestId("parallel-pane")).toBeInTheDocument();
    expect(localStorage.getItem("pwnpilot:project:p1:parallelViewEnabled")).toBe(
      "true"
    );
    expect(localStorage.getItem("pwnpilot:project:p1:parallelTab")).toBe(
      "notes"
    );
  });

  it("supports dragging tabs to reorder the project navbar", async () => {
    await renderProjectViewAt();

    const tablist = screen.getByRole("tablist");

    const readTabLabels = () =>
      within(tablist)
        .getAllByRole("tab")
        .map((tab) => tab.textContent?.trim());

    expect(readTabLabels()).toEqual([
      "Terminal",
      "Commands",
      "Context",
      "AI Assistant",
      "Notes",
      "Reports",
      "History",
      "Team",
    ]);

    const dataTransfer = makeDataTransfer();
    const notesTab = within(tablist).getByRole("tab", { name: /Notes/i });
    const terminalTab = within(tablist).getByRole("tab", { name: /Terminal/i });

    fireEvent.dragStart(notesTab, { dataTransfer });

    // jsdom doesn't implement layout; stub bounding box so "before/after" can be computed deterministically.
    terminalTab.getBoundingClientRect = () =>
      ({
        left: 0,
        width: 100,
        top: 0,
        height: 20,
        right: 100,
        bottom: 20,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    fireEvent.dragOver(terminalTab, { dataTransfer, clientX: 10 });
    expect(terminalTab).toHaveAttribute("data-reorder", "before");
    fireEvent.drop(terminalTab, { dataTransfer, clientX: 10 });

    expect(readTabLabels()).toEqual([
      "Notes",
      "Terminal",
      "Commands",
      "Context",
      "AI Assistant",
      "Reports",
      "History",
      "Team",
    ]);

    expect(localStorage.getItem("pwnpilot:project:p1:tabOrder")).toBe(
      JSON.stringify([
        "notes",
        "terminal",
        "commands",
        "context",
        "ai",
        "reports",
        "timeline",
        "team",
      ])
    );
  });
});
