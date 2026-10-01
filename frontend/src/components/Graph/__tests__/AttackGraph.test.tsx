import type { ComponentProps, ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "@/lib/queryClient";
import { AttackGraph } from "../AttackGraph";

type MockGraphNode = {
  id: string;
  position?: { x: number; y: number } | null;
  meta: Record<string, unknown>;
  [key: string]: unknown;
};

type MockRenderedNode = {
  id: string;
  type?: string;
  position?: { x: number; y: number };
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

function getTypedRenderedNodes(): MockRenderedNode[] {
  return graphHookState.renderedNodes.filter((node) => node.type === "typed");
}

function renderWithQueryClient(ui: ReactNode) {
  const queryClient = createQueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );

  return {
    ...view,
    rerender: (nextUi: ReactNode) =>
      view.rerender(
        <QueryClientProvider client={queryClient}>{nextUi}</QueryClientProvider>
      ),
  };
}

const {
  graphHookState,
  seedDemoMock,
  loadPathMock,
  fitViewMock,
  setCenterMock,
  getCommandMock,
  fetchReportEvidenceUsageMock,
  updatePositionMock,
  layoutAttackGraphMock,
  setNodesMock,
} = vi.hoisted(() => {
  const state = {
    graph: {
      projectId: "p1",
      source: "stored" as const,
      nodes: [] as MockGraphNode[],
      edges: [] as Array<Record<string, unknown>>,
      scenarios: [] as Array<Record<string, unknown>>,
      activeScenarioId: null as string | null,
    },
    proposals: [] as Array<Record<string, unknown>>,
    isLoading: false,
    isProposalsLoading: false,
    error: null as string | null,
    pathResult: null as null | { nodeIds: string[]; edgeIds: string[] },
    isSeeding: false,
    isPathLoading: false,
    acceptingProposalId: null as string | null,
    onNodeDragStopMock: vi.fn(),
    onNodeClickMock: vi.fn(),
    renderedNodes: [] as MockRenderedNode[],
    renderedEdges: [] as Array<Record<string, unknown>>,
    miniMapProps: null as null | Record<string, unknown>,
    controlsProps: null as null | Record<string, unknown>,
    reactFlowProps: null as null | Record<string, unknown>,
  };

  const setNodesMockFn = vi.fn(
    (nodesOrUpdater: MockRenderedNode[] | ((prev: MockRenderedNode[]) => MockRenderedNode[])) => {
      if (typeof nodesOrUpdater === "function") {
        state.renderedNodes = nodesOrUpdater(state.renderedNodes);
      } else {
        state.renderedNodes = nodesOrUpdater;
      }
    }
  );

  return {
    graphHookState: state,
    seedDemoMock: vi.fn(),
    loadPathMock: vi.fn(),
    fitViewMock: vi.fn(),
    setCenterMock: vi.fn(),
    getCommandMock: vi.fn(),
    fetchReportEvidenceUsageMock: vi.fn(),
    updatePositionMock: vi.fn(),
    layoutAttackGraphMock: vi.fn(
      async (
        nodes: Array<{
          id: string;
          position?: { x: number; y: number } | null;
          meta?: Record<string, unknown>;
        }>
      ) =>
        Object.fromEntries(
          nodes.map((node, index) => [
            node.id,
            node.meta?.position_pinned === true && node.position
              ? node.position
              : { x: index * 320, y: 0 },
          ])
        )
    ),
    setNodesMock: setNodesMockFn,
  };
});

vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<typeof import("@xyflow/react")>(
    "@xyflow/react"
  );
  return {
    ...actual,
    ReactFlow: ({
      children,
      edges,
      onNodeDragStop,
      onNodeClick,
      ...props
    }: {
      children?: ReactNode;
      edges?: Array<Record<string, unknown>>;
      onNodeDragStop?: (...args: unknown[]) => void;
      onNodeClick?: (...args: unknown[]) => void;
      [key: string]: unknown;
    }) => {
      graphHookState.onNodeDragStopMock = onNodeDragStop ?? vi.fn();
      graphHookState.onNodeClickMock = onNodeClick ?? vi.fn();
      graphHookState.renderedEdges = edges ?? [];
      graphHookState.reactFlowProps = props;
      return <div>{children}</div>;
    },
    ReactFlowProvider: ({ children }: { children?: ReactNode }) => (
      <div>{children}</div>
    ),
    Background: () => null,
    Controls: (props: Record<string, unknown>) => {
      graphHookState.controlsProps = props;
      return null;
    },
    MiniMap: (props: Record<string, unknown>) => {
      graphHookState.miniMapProps = props;
      return (
        <div
          data-testid="attack-graph-minimap"
          data-bg-color={String(props.bgColor ?? "")}
          data-mask-color={String(props.maskColor ?? "")}
        />
      );
    },
    useReactFlow: () => ({
      fitView: fitViewMock,
      setCenter: setCenterMock,
      setNodes: setNodesMock,
    }),
  };
});

vi.mock("@/features/attack-graph/useProjectGraph", () => ({
  useProjectGraph: () => ({
    graph: graphHookState.graph,
    proposals: graphHookState.proposals,
    isProposalsLoading: graphHookState.isProposalsLoading,
    isLoading: graphHookState.isLoading,
    error: graphHookState.error,
    pathResult: graphHookState.pathResult,
    isSeeding: graphHookState.isSeeding,
    isPathLoading: graphHookState.isPathLoading,
    acceptingProposalId: graphHookState.acceptingProposalId,
    seedDemoCtf: seedDemoMock,
    loadShortestPath: loadPathMock,
    acceptProposal: vi.fn(),
    updateNodePosition: updatePositionMock,
  }),
}));

vi.mock("@/api/ai", () => ({
  aiApi: {
    getCommand: getCommandMock,
  },
}));

vi.mock("@/api/report", () => ({
  fetchReportEvidenceUsage: fetchReportEvidenceUsageMock,
  reportQueryKeys: {
    detail: (projectId: string) => ["report", projectId] as const,
    proposals: (projectId: string) => ["report", projectId, "proposals"] as const,
    evidence: (projectId: string) => ["report", projectId, "evidence"] as const,
  },
}));

vi.mock("@/features/attack-graph/layout", () => ({
  ATTACK_GRAPH_NODE_WIDTH: 280,
  ATTACK_GRAPH_NODE_HEIGHT: 104,
  layoutAttackGraph: layoutAttackGraphMock,
}));

vi.mock("@/features/attack-graph/GraphSearchPalette", () => ({
  GraphSearchPalette: () => null,
}));

async function flushAttackGraphEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderAttackGraph(
  projectId = "p1",
  props: Partial<ComponentProps<typeof AttackGraph>> = {}
) {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = renderWithQueryClient(<AttackGraph projectId={projectId} {...props} />);
    await Promise.resolve();
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(screen.queryByText(/loading attack graph/i)).not.toBeInTheDocument();
  }, { timeout: 5000 });
  return view;
}

describe("AttackGraph", () => {
  beforeEach(() => {
    graphHookState.graph = {
      projectId: "p1",
      source: "stored",
      nodes: [],
      edges: [],
      scenarios: [],
      activeScenarioId: null,
    };
    graphHookState.proposals = [];
    graphHookState.isLoading = false;
    graphHookState.isProposalsLoading = false;
    graphHookState.error = null;
    graphHookState.pathResult = null;
    graphHookState.isSeeding = false;
    graphHookState.isPathLoading = false;
    graphHookState.acceptingProposalId = null;
    graphHookState.onNodeDragStopMock = vi.fn();
    graphHookState.onNodeClickMock = vi.fn();
    graphHookState.renderedNodes = [];
    graphHookState.renderedEdges = [];
    graphHookState.miniMapProps = null;
    graphHookState.controlsProps = null;
    graphHookState.reactFlowProps = null;
    seedDemoMock.mockReset();
    loadPathMock.mockReset();
    fitViewMock.mockReset();
    setCenterMock.mockReset();
    getCommandMock.mockReset();
    fetchReportEvidenceUsageMock.mockReset();
    fetchReportEvidenceUsageMock.mockResolvedValue({
      items: [],
      total: 0,
    });
    getCommandMock.mockImplementation(async (projectId: string, commandId: string) => ({
      id: commandId,
      project_id: projectId,
      session_id: "session-1",
      session_name: "Terminal 1",
      command:
        commandId === "cmd-nmap"
          ? "nmap -sV 10.10.110.10"
          : commandId,
      output_preview: null,
      output: null,
      exit_code: 0,
      cwd: "/home/operator",
      duration_ms: 0,
      executed_by: "lucas",
      source: "user",
      timeline_id: null,
      created_at: "2026-04-13T12:00:00Z",
    }));
    updatePositionMock.mockReset();
    layoutAttackGraphMock.mockClear();
    setNodesMock.mockClear();
    window.localStorage.clear();
  });

  it("offers a realistic ctf workspace seed when the graph is empty", async () => {
    await renderAttackGraph();

    expect(
      await screen.findByText(/seed a realistic ctf workspace/i)
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /seed realistic ctf workspace/i })
    );

    expect(seedDemoMock).toHaveBeenCalledTimes(1);
  });

  it("uses the derived engagement fallback for the collapsed node count when the canonical graph is empty", () => {
    graphHookState.graph = {
      projectId: "p1",
      source: "stored",
      nodes: [],
      edges: [],
      scenarios: [],
      activeScenarioId: null,
    };

    render(
      <AttackGraph
        projectId="p1"
        isCollapsed
        nodes={[
          {
            id: "derived-1",
            type: "success",
            status: "success",
            title: "Timeline finding",
            subtitle: "Derived from history",
            icon: "flag",
            position: { x: "10%", y: "50%" },
          },
          {
            id: "derived-2",
            type: "success",
            status: "success",
            title: "AI memory",
            subtitle: "Derived from context",
            icon: "psychology",
            position: { x: "30%", y: "50%" },
          },
        ]}
      />
    );

    expect(screen.getByText("2 Nodes")).toBeInTheDocument();
    expect(screen.queryByText("0 Nodes")).not.toBeInTheDocument();
  });

  it("renders typed graph nodes and shows node details in the inspector", async () => {
    graphHookState.graph = {
      projectId: "p1",
      source: "stored",
      activeScenarioId: "scenario-full-chain",
      scenarios: [
        {
          id: "scenario-full-chain",
          name: "ACME Jenkins to Root",
          description: "Full chain",
          color: "#38bdf8",
          isActive: true,
          nodeIds: ["host-web01", "service-jenkins", "session-root"],
          edgeIds: ["edge-jenkins-runs-on-web01"],
        },
      ],
      nodes: [
        {
          id: "host-web01",
          projectId: "p1",
          type: "host",
          label: "WEB01",
          createdAt: "2026-04-13T12:00:00Z",
          updatedAt: "2026-04-13T12:00:00Z",
          createdBy: "import",
          confidence: 1,
          sourceStepIds: ["cmd-nmap"],
          tags: ["linux"],
          notes: "Ubuntu application host with exposed Jenkins.",
          position: { x: 0, y: 0 },
          meta: {
            ip: "10.10.110.10",
            hostname: "web01.acme.local",
            os: "Ubuntu 22.04",
            ports_open: [22, 80, 8080],
            is_compromised: true,
          },
        },
        {
          id: "service-jenkins",
          projectId: "p1",
          type: "service",
          label: "Jenkins :8080",
          createdAt: "2026-04-13T12:00:00Z",
          updatedAt: "2026-04-13T12:00:00Z",
          createdBy: "import",
          confidence: 1,
          sourceStepIds: ["cmd-ffuf"],
          tags: ["web", "jenkins"],
          notes: null,
          position: { x: 120, y: 0 },
          meta: {
            host_id: "host-web01",
            port: 8080,
            service_name: "jenkins",
            product: "Jenkins",
          },
        },
        {
          id: "session-root",
          projectId: "p1",
          type: "session",
          label: "root@WEB01",
          createdAt: "2026-04-13T12:00:00Z",
          updatedAt: "2026-04-13T12:00:00Z",
          createdBy: "import",
          confidence: 1,
          sourceStepIds: ["cmd-root-privesc"],
          tags: ["root"],
          notes: null,
          position: { x: 240, y: 0 },
          meta: {
            host_id: "host-web01",
            user: "root",
            privilege: "root",
            shell_type: "bash",
            is_active: true,
          },
        },
      ],
      edges: [
        {
          id: "edge-jenkins-runs-on-web01",
          projectId: "p1",
          sourceId: "service-jenkins",
          targetId: "host-web01",
          kind: "runs_on",
          createdAt: "2026-04-13T12:00:00Z",
          confidence: 1,
          label: null,
          meta: {},
        },
      ],
    };

    await renderAttackGraph();
    await waitFor(() => {
      expect(fitViewMock).toHaveBeenCalled();
    });

    expect(screen.getAllByText("WEB01").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ACME Jenkins to Root/i).length).toBeGreaterThan(0);

    expect(screen.getAllByText(/10\.10\.110\.10/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Ubuntu 22\.04/i)).toBeInTheDocument();
    expect(screen.getByText(/22, 80, 8080/i)).toBeInTheDocument();
  });

  it("links a selected graph node back to its source history commands", async () => {
    graphHookState.graph = {
      projectId: "p1",
      source: "stored",
      activeScenarioId: null,
      scenarios: [],
      nodes: [
        {
          id: "host-web01",
          projectId: "p1",
          type: "host",
          label: "WEB01",
          createdAt: "2026-04-13T12:00:00Z",
          updatedAt: "2026-04-13T12:00:00Z",
          createdBy: "import",
          confidence: 1,
          sourceStepIds: ["cmd-nmap", "cmd-ffuf"],
          tags: ["history"],
          notes: null,
          position: { x: 0, y: 0 },
          meta: {
            ip: "10.10.110.10",
          },
        },
        {
          id: "service-http",
          projectId: "p1",
          type: "service",
          label: "HTTP :80",
          createdAt: "2026-04-13T12:00:00Z",
          updatedAt: "2026-04-13T12:00:00Z",
          createdBy: "import",
          confidence: 1,
          sourceStepIds: ["cmd-nmap"],
          tags: ["history"],
          notes: null,
          position: { x: 120, y: 0 },
          meta: {},
        },
      ],
      edges: [
        {
          id: "edge-service-host",
          projectId: "p1",
          sourceId: "service-http",
          targetId: "host-web01",
          kind: "runs_on",
          sourceStepId: "cmd-nmap",
          command: "nmap -sV 10.10.110.10",
          tool: "nmap",
          createdAt: "2026-04-13T12:00:00Z",
          confidence: 1,
          label: null,
          meta: {},
        },
      ],
    };

    await renderAttackGraph();

    expect(await screen.findByText(/history evidence/i)).toBeInTheDocument();
    expect(screen.getByText(/nmap -sV 10\.10\.110\.10/i)).toBeInTheDocument();

    expect(
      screen.getByRole("link", { name: /open command cmd-nmap in history/i })
    ).toHaveAttribute("href", "/projects/p1/timeline?commandId=cmd-nmap");
    expect(
      screen.getByRole("link", { name: /open command cmd-ffuf in history/i })
    ).toHaveAttribute("href", "/projects/p1/timeline?commandId=cmd-ffuf");
  });

  it("shows command history previews and sends graph evidence to AI", async () => {
    const onSendEvidenceToAI = vi.fn();
    const onAddEvidenceToReport = vi.fn().mockResolvedValue({ duplicate: false });
    getCommandMock.mockImplementation(async (projectId: string, commandId: string) => ({
      id: commandId,
      project_id: projectId,
      session_id: "session-1",
      session_name: "Terminal 1",
      command: "nmap -sV 10.10.110.10",
      output_preview: "80/tcp open http\n22/tcp open ssh",
      output: "80/tcp open http\n22/tcp open ssh\nService Info: Linux",
      exit_code: 0,
      cwd: "/home/operator/PwnPilot/projects/cap",
      duration_ms: 1532,
      executed_by: "lucas",
      source: "user",
      timeline_id: null,
      created_at: "2026-04-13T12:00:00Z",
    }));

    graphHookState.graph = {
      projectId: "p1",
      source: "stored",
      activeScenarioId: null,
      scenarios: [],
      nodes: [
        {
          id: "host-web01",
          projectId: "p1",
          type: "host",
          label: "WEB01",
          createdAt: "2026-04-13T12:00:00Z",
          updatedAt: "2026-04-13T12:00:00Z",
          createdBy: "import",
          confidence: 1,
          sourceStepIds: ["cmd-nmap"],
          tags: ["history"],
          notes: null,
          position: { x: 0, y: 0 },
          meta: {
            ip: "10.10.110.10",
          },
        },
      ],
      edges: [],
    };

    await renderAttackGraph("p1", {
      onSendEvidenceToAI,
      onAddEvidenceToReport,
    });

    expect(await screen.findByText(/80\/tcp open http/i)).toBeInTheDocument();
    expect(screen.getByText(/exit 0/i)).toBeInTheDocument();
    expect(screen.getByText(/1\.5s/i)).toBeInTheDocument();
    expect(screen.getByText(/Terminal 1/i)).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: /send command cmd-nmap evidence to ai/i,
      })
    );

    expect(onSendEvidenceToAI).toHaveBeenCalledWith(
      expect.stringContaining("Attack graph evidence")
    );
    expect(onSendEvidenceToAI.mock.calls[0]?.[0]).toContain("Node: WEB01 (host)");
    expect(onSendEvidenceToAI.mock.calls[0]?.[0]).toContain(
      "Command: nmap -sV 10.10.110.10"
    );
    expect(onSendEvidenceToAI.mock.calls[0]?.[0]).toContain("80/tcp open http");

    fireEvent.click(
      screen.getByRole("button", {
        name: /add command cmd-nmap evidence to report/i,
      })
    );

    await waitFor(() =>
      expect(onAddEvidenceToReport).toHaveBeenCalledWith(
        expect.objectContaining({
          sectionHint: "enumeration",
          triggerType: "graph_evidence",
          evidence: [
            { sourceType: "command_history", sourceId: "cmd-nmap" },
            { sourceType: "graph_node", sourceId: "host-web01" },
          ],
        })
      )
    );
    const reportPayload = onAddEvidenceToReport.mock.calls[0]?.[0];
    expect(reportPayload.contentMd).toContain("### WEB01 evidence");
    expect(reportPayload.contentMd).toContain("`nmap -sV 10.10.110.10`");
    expect(reportPayload.contentMd).toContain("80/tcp open http");
    expect(
      screen.getByRole("button", {
        name: /add command cmd-nmap evidence to report/i,
      })
    ).toHaveTextContent("Added");
  });

  it("marks graph evidence as already reported when the report API deduplicates it", async () => {
    const onAddEvidenceToReport = vi.fn().mockResolvedValue({ duplicate: true });
    getCommandMock.mockImplementation(async (projectId: string, commandId: string) => ({
      id: commandId,
      project_id: projectId,
      session_id: "session-1",
      session_name: "Terminal 1",
      command: "nmap -sV 10.10.110.10",
      output_preview: "80/tcp open http",
      output: "80/tcp open http",
      exit_code: 0,
      cwd: "/home/operator/PwnPilot/projects/cap",
      duration_ms: 1532,
      executed_by: "lucas",
      source: "user",
      timeline_id: null,
      created_at: "2026-04-13T12:00:00Z",
    }));
    graphHookState.graph = {
      projectId: "p1",
      source: "stored",
      activeScenarioId: null,
      scenarios: [],
      nodes: [
        {
          id: "host-web01",
          projectId: "p1",
          type: "host",
          label: "WEB01",
          createdAt: "2026-04-13T12:00:00Z",
          updatedAt: "2026-04-13T12:00:00Z",
          createdBy: "import",
          confidence: 1,
          sourceStepIds: ["cmd-nmap"],
          tags: ["history"],
          notes: null,
          position: { x: 0, y: 0 },
          meta: { ip: "10.10.110.10" },
        },
      ],
      edges: [],
    };

    await renderAttackGraph("p1", { onAddEvidenceToReport });

    const reportButton = await screen.findByRole("button", {
      name: /add command cmd-nmap evidence to report/i,
    });
    fireEvent.click(reportButton);

    await waitFor(() => expect(reportButton).toHaveTextContent("Already"));
  });

  it("marks graph evidence as already reported when report usage is preloaded", async () => {
    const onAddEvidenceToReport = vi.fn().mockResolvedValue({ duplicate: false });
    const onOpenReportEvidence = vi.fn();
    fetchReportEvidenceUsageMock.mockResolvedValue({
      items: [
        {
          id: "evidence-1",
          proposalId: "proposal-1",
          proposalStatus: "pending",
          patchId: "patch-1",
          sourceType: "command_history",
          sourceId: "cmd-nmap",
          createdAt: "2026-04-13T12:10:00Z",
        },
      ],
      total: 1,
    });
    graphHookState.graph = {
      projectId: "p1",
      source: "stored",
      activeScenarioId: null,
      scenarios: [],
      nodes: [
        {
          id: "host-web01",
          projectId: "p1",
          type: "host",
          label: "WEB01",
          createdAt: "2026-04-13T12:00:00Z",
          updatedAt: "2026-04-13T12:00:00Z",
          createdBy: "import",
          confidence: 1,
          sourceStepIds: ["cmd-nmap"],
          tags: ["history"],
          notes: null,
          position: { x: 0, y: 0 },
          meta: { ip: "10.10.110.10" },
        },
      ],
      edges: [],
    };

    await renderAttackGraph("p1", {
      onAddEvidenceToReport,
      onOpenReportEvidence,
    });

    await waitFor(() =>
      expect(fetchReportEvidenceUsageMock).toHaveBeenCalledWith("p1")
    );
    const reportButton = await screen.findByRole("button", {
      name: /open report proposal proposal-1 for command cmd-nmap evidence/i,
    });
    await waitFor(() =>
      expect(reportButton).toHaveTextContent("Already")
    );
    expect(reportButton).toHaveAttribute(
      "title",
      "Already used by pending report proposal proposal-1"
    );
    fireEvent.click(reportButton);
    expect(onOpenReportEvidence).toHaveBeenCalledWith({
      projectId: "p1",
      commandId: "cmd-nmap",
      proposalId: "proposal-1",
      proposalStatus: "pending",
      patchId: "patch-1",
    });
    expect(onAddEvidenceToReport).not.toHaveBeenCalled();
  });

  it("runs a shortest path query from the toolbar", async () => {
    graphHookState.graph = {
      projectId: "p1",
      source: "stored",
      activeScenarioId: "scenario-full-chain",
      scenarios: [],
      nodes: [
        {
          id: "session-www",
          projectId: "p1",
          type: "session",
          label: "www-data@WEB01",
          createdAt: "2026-04-13T12:00:00Z",
          updatedAt: "2026-04-13T12:00:00Z",
          createdBy: "import",
          confidence: 1,
          sourceStepIds: [],
          tags: [],
          notes: null,
          position: { x: 0, y: 0 },
          meta: {},
        },
        {
          id: "loot-root",
          projectId: "p1",
          type: "loot",
          label: "root.txt",
          createdAt: "2026-04-13T12:00:00Z",
          updatedAt: "2026-04-13T12:00:00Z",
          createdBy: "import",
          confidence: 1,
          sourceStepIds: [],
          tags: [],
          notes: null,
          position: { x: 0, y: 0 },
          meta: {},
        },
      ],
      edges: [],
    };

    await renderAttackGraph();
    await waitFor(() => {
      expect(fitViewMock).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText(/path from/i), {
      target: { value: "session-www" },
    });
    fireEvent.change(screen.getByLabelText(/path to/i), {
      target: { value: "loot-root" },
    });
    fireEvent.click(screen.getByRole("button", { name: /highlight shortest path/i }));

    expect(loadPathMock).toHaveBeenCalledWith("session-www", "loot-root");
  });

  it("auto fits the graph when nodes load", async () => {
    const { rerender } = renderWithQueryClient(<AttackGraph projectId="p1" />);

    graphHookState.graph = {
      projectId: "p1",
      source: "stored",
      activeScenarioId: null,
      scenarios: [],
      nodes: [
        {
          id: "host-web01",
          projectId: "p1",
          type: "host",
          label: "WEB01",
          createdAt: "2026-04-13T12:00:00Z",
          updatedAt: "2026-04-13T12:00:00Z",
          createdBy: "import",
          confidence: 1,
          sourceStepIds: [],
          tags: [],
          notes: null,
          position: { x: 0, y: 0 },
          meta: {},
        },
      ],
      edges: [],
    };

    rerender(<AttackGraph projectId="p1" />);
    await flushAttackGraphEffects();

    await waitFor(() => {
      expect(fitViewMock).toHaveBeenCalled();
    });
  });

  it("selects and centers an externally focused graph node", async () => {
    graphHookState.graph = {
      projectId: "p1",
      source: "stored",
      activeScenarioId: null,
      scenarios: [],
      nodes: [
        {
          id: "node-host",
          projectId: "p1",
          type: "host",
          label: "10.129.34.191",
          createdAt: "2026-04-13T12:00:00Z",
          updatedAt: "2026-04-13T12:00:00Z",
          createdBy: "import",
          confidence: 1,
          sourceStepIds: [],
          tags: [],
          notes: null,
          position: { x: 0, y: 0 },
          meta: {},
        },
        {
          id: "node-session",
          projectId: "p1",
          type: "session",
          label: "SSH session: nathan",
          createdAt: "2026-04-13T12:00:00Z",
          updatedAt: "2026-04-13T12:00:00Z",
          createdBy: "import",
          confidence: 1,
          sourceStepIds: [],
          tags: [],
          notes: null,
          position: { x: 0, y: 0 },
          meta: {
            user: "nathan",
          },
        },
      ],
      edges: [],
    };

    await act(async () => {
      renderWithQueryClient(
        <AttackGraph projectId="p1" selectedGraphNodeId="node-session" />
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(setCenterMock).toHaveBeenCalledWith(460, 52, {
        zoom: 1.16,
        duration: 650,
      });
    });

    const focusedNode = getTypedRenderedNodes().find(
      (node) => node.id === "node-session"
    );
    expect(focusedNode).toMatchObject({
      selected: true,
      data: {
        highlighted: true,
      },
    });
    expect(screen.getAllByText(/SSH session: nathan/i).length).toBeGreaterThan(0);
  });

  it("removes the minimap and keeps readable edge label styles", async () => {
    graphHookState.graph = {
      projectId: "p1",
      source: "stored",
      activeScenarioId: null,
      scenarios: [],
      nodes: [
        {
          id: "host-web01",
          projectId: "p1",
          type: "host",
          label: "WEB01",
          createdAt: "2026-04-13T12:00:00Z",
          updatedAt: "2026-04-13T12:00:00Z",
          createdBy: "import",
          confidence: 1,
          sourceStepIds: [],
          tags: [],
          notes: null,
          position: { x: 0, y: 0 },
          meta: {},
        },
        {
          id: "service-http",
          projectId: "p1",
          type: "service",
          label: "HTTP :80",
          createdAt: "2026-04-13T12:00:00Z",
          updatedAt: "2026-04-13T12:00:00Z",
          createdBy: "import",
          confidence: 1,
          sourceStepIds: [],
          tags: [],
          notes: null,
          position: { x: 120, y: 0 },
          meta: {},
        },
      ],
      edges: [
        {
          id: "edge-service-host",
          projectId: "p1",
          sourceId: "service-http",
          targetId: "host-web01",
          kind: "runs_on",
          createdAt: "2026-04-13T12:00:00Z",
          confidence: 1,
          label: null,
          meta: {},
        },
      ],
    };

    await renderAttackGraph();
    await waitFor(() => {
      expect(getTypedRenderedNodes()).toHaveLength(2);
    });

    await waitFor(() => {
      expect(graphHookState.renderedEdges).toHaveLength(1);
    });

    expect(graphHookState.miniMapProps).toBeNull();
    expect(screen.queryByTestId("attack-graph-minimap")).not.toBeInTheDocument();
    expect(graphHookState.renderedEdges[0]).toMatchObject({
      labelStyle: {
        fill: "#dbeafe",
        fontSize: 11,
        fontWeight: 600,
      },
      labelBgStyle: {
        fill: "rgba(8, 17, 31, 0.92)",
        stroke: "rgba(14, 165, 233, 0.35)",
      },
    });
  });

  it("keeps only zoom controls and hides the React Flow attribution", async () => {
    graphHookState.graph = {
      projectId: "p1",
      source: "stored",
      activeScenarioId: null,
      scenarios: [],
      nodes: [
        {
          id: "host-web01",
          projectId: "p1",
          type: "host",
          label: "WEB01",
          createdAt: "2026-04-13T12:00:00Z",
          updatedAt: "2026-04-13T12:00:00Z",
          createdBy: "import",
          confidence: 1,
          sourceStepIds: [],
          tags: [],
          notes: null,
          position: { x: 0, y: 0 },
          meta: {},
        },
      ],
      edges: [],
    };

    await renderAttackGraph();

    await waitFor(() => {
      expect(graphHookState.controlsProps).not.toBeNull();
      expect(graphHookState.reactFlowProps).not.toBeNull();
    });

    expect(graphHookState.controlsProps).toMatchObject({
      showFitView: false,
      showInteractive: false,
      className: "attack-graph-controls",
    });
    expect(graphHookState.reactFlowProps).toMatchObject({
      proOptions: {
        hideAttribution: true,
      },
      autoPanOnNodeDrag: false,
    });
    expect(graphHookState.reactFlowProps?.fitView).toBeUndefined();
  });

  it("keeps pinned node coordinates and reflows overlapping unpinned nodes", async () => {
    graphHookState.graph = {
      projectId: "p1",
      source: "stored",
      activeScenarioId: null,
      scenarios: [],
      nodes: [
        {
          id: "manual-root",
          projectId: "p1",
          type: "host",
          label: "WEB01",
          createdAt: "2026-04-13T12:00:00Z",
          updatedAt: "2026-04-13T12:00:00Z",
          createdBy: "import",
          confidence: 1,
          sourceStepIds: [],
          tags: [],
          notes: null,
          position: { x: 400, y: 300 },
          meta: { position_pinned: true },
        },
        {
          id: "auto-service",
          projectId: "p1",
          type: "service",
          label: "Jenkins :8080",
          createdAt: "2026-04-13T12:00:00Z",
          updatedAt: "2026-04-13T12:00:00Z",
          createdBy: "import",
          confidence: 1,
          sourceStepIds: [],
          tags: [],
          notes: null,
          position: { x: 400, y: 300 },
          meta: { host_id: "manual-root" },
        },
        {
          id: "auto-session",
          projectId: "p1",
          type: "session",
          label: "www-data@WEB01",
          createdAt: "2026-04-13T12:00:00Z",
          updatedAt: "2026-04-13T12:00:00Z",
          createdBy: "import",
          confidence: 1,
          sourceStepIds: [],
          tags: [],
          notes: null,
          position: { x: 400, y: 300 },
          meta: { host_id: "manual-root", user: "www-data" },
        },
      ],
      edges: [
        {
          id: "edge-service-host",
          projectId: "p1",
          sourceId: "auto-service",
          targetId: "manual-root",
          kind: "runs_on",
          createdAt: "2026-04-13T12:00:00Z",
          confidence: 1,
          sourceStepId: null,
          command: null,
          tool: null,
          label: null,
          meta: {},
        },
        {
          id: "edge-host-session",
          projectId: "p1",
          sourceId: "manual-root",
          targetId: "auto-session",
          kind: "obtained",
          createdAt: "2026-04-13T12:00:00Z",
          confidence: 1,
          sourceStepId: null,
          command: null,
          tool: null,
          label: null,
          meta: {},
        },
      ],
    };

    await renderAttackGraph();

    await waitFor(() => {
      expect(getTypedRenderedNodes()).toHaveLength(3);
    });

    const typedNodes = getTypedRenderedNodes();
    const pinnedNode = typedNodes.find(
      (node) => node.id === "manual-root"
    );
    const autoService = typedNodes.find(
      (node) => node.id === "auto-service"
    );
    const autoSession = typedNodes.find(
      (node) => node.id === "auto-session"
    );

    expect(pinnedNode?.position).toEqual({ x: 400, y: 300 });
    expect(autoService?.position).not.toEqual({ x: 400, y: 300 });
    expect(autoSession?.position).not.toEqual({ x: 400, y: 300 });
  });

  it("falls back to auto layout when a persisted pinned position is far outside sane graph bounds", async () => {
    graphHookState.graph = {
      projectId: "p1",
      source: "stored",
      activeScenarioId: null,
      scenarios: [],
      nodes: [
        {
          id: "corrupted-root",
          projectId: "p1",
          type: "host",
          label: "WEB01",
          createdAt: "2026-04-13T12:00:00Z",
          updatedAt: "2026-04-13T12:00:00Z",
          createdBy: "import",
          confidence: 1,
          sourceStepIds: [],
          tags: [],
          notes: null,
          position: { x: 1500, y: -6095 },
          meta: { position_pinned: true },
        },
        {
          id: "auto-service",
          projectId: "p1",
          type: "service",
          label: "Jenkins :8080",
          createdAt: "2026-04-13T12:00:00Z",
          updatedAt: "2026-04-13T12:00:00Z",
          createdBy: "import",
          confidence: 1,
          sourceStepIds: [],
          tags: [],
          notes: null,
          position: { x: 400, y: 300 },
          meta: { host_id: "corrupted-root" },
        },
      ],
      edges: [
        {
          id: "edge-service-host",
          projectId: "p1",
          sourceId: "auto-service",
          targetId: "corrupted-root",
          kind: "runs_on",
          createdAt: "2026-04-13T12:00:00Z",
          confidence: 1,
          sourceStepId: null,
          command: null,
          tool: null,
          label: null,
          meta: {},
        },
      ],
    };

    await renderAttackGraph();

    await waitFor(() => {
      expect(getTypedRenderedNodes()).toHaveLength(2);
    });

    const recoveredNode = getTypedRenderedNodes().find(
      (node) => node.id === "corrupted-root"
    );

    expect(recoveredNode?.position).not.toEqual({ x: 1500, y: -6095 });
    expect(recoveredNode?.position).toEqual({ x: 0, y: 0 });
  });

  it("toggles fullscreen mode from the header", async () => {
    await renderAttackGraph();

    fireEvent.click(
      screen.getByRole("button", { name: /enter attack graph fullscreen/i })
    );

    expect(screen.getByTestId("attack-graph")).toHaveAttribute(
      "data-fullscreen",
      "true"
    );

    fireEvent.click(
      screen.getByRole("button", { name: /exit attack graph fullscreen/i })
    );

    expect(screen.getByTestId("attack-graph")).toHaveAttribute(
      "data-fullscreen",
      "false"
    );
  });

  it("supports vertical resizing from the graph header handle", async () => {
    graphHookState.graph = {
      projectId: "p1",
      source: "stored",
      activeScenarioId: null,
      scenarios: [],
      nodes: [
        {
          id: "node-1",
          projectId: "p1",
          type: "host",
          label: "WEB01",
          createdAt: "2026-04-13T12:00:00Z",
          updatedAt: "2026-04-13T12:00:00Z",
          createdBy: "import",
          confidence: 1,
          sourceStepIds: [],
          tags: [],
          notes: null,
          position: { x: 0, y: 0 },
          meta: {},
        },
      ],
      edges: [],
    };

    await renderAttackGraph();

    const panel = screen.getByTestId("attack-graph");
    expect(panel).toHaveStyle({ height: "512px" });

    fireEvent.mouseDown(screen.getByTestId("attack-graph-resize-handle"), {
      clientY: 400,
    });
    fireEvent.mouseMove(window, { clientY: 340 });
    fireEvent.mouseUp(window);

    expect(panel).toHaveStyle({ height: "572px" });
  });

  it("persists node position only when drag lock is unlocked", async () => {
    graphHookState.graph = {
      projectId: "p1",
      source: "stored",
      activeScenarioId: null,
      scenarios: [],
      nodes: [
        {
          id: "node-1",
          projectId: "p1",
          type: "host",
          label: "WEB01",
          createdAt: "2026-04-13T12:00:00Z",
          updatedAt: "2026-04-13T12:00:00Z",
          createdBy: "import",
          confidence: 1,
          sourceStepIds: [],
          tags: [],
          notes: null,
          position: { x: 0, y: 0 },
          meta: {},
        },
      ],
      edges: [],
    };

    await renderAttackGraph();

    fireEvent.click(
      screen.getByRole("button", { name: /unlock node dragging/i })
    );

    await act(async () => {
      graphHookState.onNodeDragStopMock(
        undefined,
        { id: "node-1", type: "typed", position: { x: 120, y: 80 } }
      );
    });

    await waitFor(() => {
      expect(updatePositionMock).toHaveBeenCalledWith("node-1", {
        x: 120,
        y: 80,
      });
    });
  });

  it("persists dragged position and triggers drop animation on drag stop", async () => {
    updatePositionMock.mockImplementation(() => new Promise(() => {}));

    graphHookState.graph = {
      projectId: "p1",
      source: "stored",
      activeScenarioId: null,
      scenarios: [],
      nodes: [
        {
          id: "node-1",
          projectId: "p1",
          type: "host",
          label: "WEB01",
          createdAt: "2026-04-13T12:00:00Z",
          updatedAt: "2026-04-13T12:00:00Z",
          createdBy: "import",
          confidence: 1,
          sourceStepIds: [],
          tags: [],
          notes: null,
          position: { x: 0, y: 0 },
          meta: {},
        },
      ],
      edges: [],
    };

    await renderAttackGraph();

    fireEvent.click(
      screen.getByRole("button", { name: /unlock node dragging/i })
    );

    // Simulate drag stop — React Flow handles the live drag internally
    // (via defaultNodes / hasDefaultNodes). Our component only persists
    // the final position and triggers the drop animation.
    await act(async () => {
      graphHookState.onNodeDragStopMock(undefined, {
        id: "node-1",
        type: "typed",
        position: { x: 220, y: 140 },
      });
    });

    await waitFor(() => {
      expect(updatePositionMock).toHaveBeenCalledWith("node-1", {
        x: 220,
        y: 140,
      });
    });

    // The sync effect re-pushes nodes via setRfNodes after drop animation
    // flag is set. Verify it marks the node as drop-animating.
    await waitFor(() => {
      expect(getTypedRenderedNodes()[0]).toMatchObject({
        id: "node-1",
        data: {
          isDropAnimating: true,
        },
      });
    });
  });

  it("keeps drag unlock state per project when switching projects", async () => {
    window.localStorage.setItem(
      "pwnpilot:project:project-b:graphDragUnlocked",
      "true"
    );
    window.localStorage.setItem(
      "pwnpilot:project:project-a:graphDragUnlocked",
      "false"
    );

    graphHookState.graph = {
      projectId: "project-a",
      source: "stored",
      activeScenarioId: null,
      scenarios: [],
      nodes: [
        {
          id: "node-1",
          projectId: "project-a",
          type: "host",
          label: "WEB01",
          createdAt: "2026-04-13T12:00:00Z",
          updatedAt: "2026-04-13T12:00:00Z",
          createdBy: "import",
          confidence: 1,
          sourceStepIds: [],
          tags: [],
          notes: null,
          position: { x: 0, y: 0 },
          meta: {},
        },
      ],
      edges: [],
    };

    const { rerender } = renderWithQueryClient(<AttackGraph projectId="project-a" />);

    rerender(<AttackGraph projectId="project-b" />);

    await waitFor(() => {
      expect(screen.getByText(/dragging unlocked/i)).toBeInTheDocument();
    });

    expect(
      window.localStorage.getItem(
        "pwnpilot:project:project-b:graphDragUnlocked"
      )
    ).toBe("true");
  });

  it("does not clobber drag unlock storage when switching to a new project", async () => {
    const keyA = "pwnpilot:project:project-a:graphDragUnlocked";
    const keyB = "pwnpilot:project:project-b:graphDragUnlocked";
    window.localStorage.setItem(keyB, "true");
    window.localStorage.setItem(keyA, "false");
    const setItemSpy = vi.spyOn(window.localStorage, "setItem");

    graphHookState.graph = {
      projectId: "project-a",
      source: "stored",
      activeScenarioId: null,
      scenarios: [],
      nodes: [
        {
          id: "node-1",
          projectId: "project-a",
          type: "host",
          label: "WEB01",
          createdAt: "2026-04-13T12:00:00Z",
          updatedAt: "2026-04-13T12:00:00Z",
          createdBy: "import",
          confidence: 1,
          sourceStepIds: [],
          tags: [],
          notes: null,
          position: { x: 0, y: 0 },
          meta: {},
        },
      ],
      edges: [],
    };

    const { rerender } = renderWithQueryClient(<AttackGraph projectId="project-a" />);

    rerender(<AttackGraph projectId="project-b" />);

    await waitFor(() => {
      expect(screen.getByText(/dragging unlocked/i)).toBeInTheDocument();
    });

    expect(window.localStorage.getItem(keyB)).toBe("true");
    expect(setItemSpy).not.toHaveBeenCalledWith(keyB, "false");
    setItemSpy.mockRestore();
  });

  it("does not rerun global layout when only a node position changes after drag persistence", async () => {
    graphHookState.graph = {
      projectId: "p1",
      source: "stored",
      activeScenarioId: null,
      scenarios: [],
      nodes: [
        {
          id: "node-1",
          projectId: "p1",
          type: "host",
          label: "WEB01",
          createdAt: "2026-04-13T12:00:00Z",
          updatedAt: "2026-04-13T12:00:00Z",
          createdBy: "import",
          confidence: 1,
          sourceStepIds: [],
          tags: [],
          notes: null,
          position: { x: 0, y: 0 },
          meta: {},
        },
        {
          id: "node-2",
          projectId: "p1",
          type: "service",
          label: "HTTP :80",
          createdAt: "2026-04-13T12:00:00Z",
          updatedAt: "2026-04-13T12:00:00Z",
          createdBy: "import",
          confidence: 1,
          sourceStepIds: [],
          tags: [],
          notes: null,
          position: { x: 320, y: 0 },
          meta: {},
        },
      ],
      edges: [
        {
          id: "edge-1",
          projectId: "p1",
          sourceId: "node-1",
          targetId: "node-2",
          kind: "runs_on",
          createdAt: "2026-04-13T12:00:00Z",
          confidence: 1,
          sourceStepId: null,
          command: null,
          tool: null,
          label: null,
          meta: {},
        },
      ],
    };

    const { rerender } = await renderAttackGraph();

    await waitFor(() => {
      expect(layoutAttackGraphMock).toHaveBeenCalledTimes(1);
    });

    graphHookState.graph = {
      ...graphHookState.graph,
      nodes: graphHookState.graph.nodes.map((node) =>
        node.id === "node-1"
          ? {
              ...node,
              updatedAt: "2026-04-13T12:01:00Z",
              position: { x: 480, y: 180 },
              meta: {
                ...node.meta,
                position_pinned: true,
              },
            }
          : node
      ),
    };

    rerender(<AttackGraph projectId="p1" />);

    await waitFor(() => {
      expect(getTypedRenderedNodes()).toHaveLength(2);
    });

    expect(
      getTypedRenderedNodes().find((node) => node.id === "node-1")?.position
    ).toEqual({ x: 480, y: 180 });
    expect(layoutAttackGraphMock).toHaveBeenCalledTimes(1);
  });

});
