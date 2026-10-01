import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TimelineView } from "@/components/Timeline/TimelineView";
import { createQueryClient } from "@/lib/queryClient";
import { AttackGraphPanel } from "../AttackGraphPanel";

const {
  apiGetMock,
  listProjectCommandsMock,
  deleteCommandMock,
  graphState,
} = vi.hoisted(() => ({
  apiGetMock: vi.fn(),
  listProjectCommandsMock: vi.fn(),
  deleteCommandMock: vi.fn(),
  graphState: {
    proposalStatus: null as "pending" | "accepted" | null,
    graph: {
      projectId: "proj-1",
      source: "stored" as const,
      nodes: [] as Array<Record<string, unknown>>,
      edges: [] as Array<Record<string, unknown>>,
      scenarios: [] as Array<Record<string, unknown>>,
      activeScenarioId: null as string | null,
    },
  },
}));

vi.mock("@/api/client", () => ({
  api: {
    get: apiGetMock,
  },
}));

vi.mock("@/api/ai", () => ({
  aiApi: {
    listProjectCommands: listProjectCommandsMock,
    deleteCommand: deleteCommandMock,
  },
}));

vi.mock("@xyflow/react", () => ({
  Background: () => null,
  Controls: () => null,
  MarkerType: {
    ArrowClosed: "arrowclosed",
  },
  ReactFlow: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="react-flow">{children}</div>
  ),
  ReactFlowProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  useReactFlow: () => ({
    fitView: vi.fn(),
    setCenter: vi.fn(),
    setNodes: vi.fn(),
  }),
}));

vi.mock("../layout", () => ({
  ATTACK_GRAPH_NODE_WIDTH: 280,
  ATTACK_GRAPH_NODE_HEIGHT: 120,
  layoutAttackGraph: vi.fn().mockResolvedValue({}),
}));

vi.mock("../TypedGraphNode", () => ({
  TypedGraphNode: () => null,
}));

vi.mock("../GraphSearchPalette", () => ({
  GraphSearchPalette: () => null,
}));

vi.mock("../api/graphClient", () => ({
  graphClient: {
    getProjectGraph: vi.fn(async () => graphState.graph),
    seedDemoCtf: vi.fn(),
    getShortestPath: vi.fn(async () => []),
    listProjectProposals: vi.fn(async () => ({
      items:
        graphState.proposalStatus === null
          ? []
          : [
              {
                id: "proposal-1",
                projectId: "proj-1",
                sourceType: "command_history" as const,
                sourceId: "command-1",
                proposedBy: "rule" as const,
                status: graphState.proposalStatus,
                title: "Graph inference for nmap -sV 10.10.10.10",
                summary: "Nmap command inferred 1 host and 2 service nodes.",
                payload: {
                  sourceStepId: "command-1",
                  nodes: [{ type: "host" }, { type: "service" }, { type: "service" }],
                  edges: [{ kind: "runs_on" }, { kind: "runs_on" }],
                },
                createdAt: "2026-04-19T13:49:50.989890Z",
                resolvedAt:
                  graphState.proposalStatus === "accepted"
                    ? "2026-04-19T13:50:23.609004Z"
                    : null,
              },
            ],
      total: graphState.proposalStatus === null ? 0 : 1,
    })),
    createHistoryProposal: vi.fn(async () => {
      graphState.proposalStatus = "pending";
      return {
        items: [
          {
            id: "proposal-1",
            projectId: "proj-1",
            sourceType: "command_history" as const,
            sourceId: "command-1",
            proposedBy: "rule" as const,
            status: "pending" as const,
            title: "Graph inference for nmap -sV 10.10.10.10",
            summary: "Nmap command inferred 1 host and 2 service nodes.",
            payload: {
              sourceStepId: "command-1",
              nodes: [{ type: "host" }, { type: "service" }, { type: "service" }],
              edges: [{ kind: "runs_on" }, { kind: "runs_on" }],
            },
            createdAt: "2026-04-19T13:49:50.989890Z",
            resolvedAt: null,
          },
        ],
        total: 1,
      };
    }),
    acceptProposal: vi.fn(async () => {
      graphState.proposalStatus = "accepted";
      graphState.graph = {
        projectId: "proj-1",
        source: "stored",
        nodes: [
          {
            id: "host-1",
            projectId: "proj-1",
            type: "host",
            label: "10.10.10.10",
            createdAt: "2026-04-19T13:50:23.609004Z",
            updatedAt: "2026-04-19T13:50:23.609004Z",
            createdBy: "rule",
            confidence: 0.92,
            sourceStepIds: ["command-1"],
            tags: ["history", "nmap"],
            notes: null,
            position: { x: 120, y: 120 },
            meta: { ip: "10.10.10.10" },
          },
          {
            id: "service-1",
            projectId: "proj-1",
            type: "service",
            label: "http :80",
            createdAt: "2026-04-19T13:50:23.609004Z",
            updatedAt: "2026-04-19T13:50:23.609004Z",
            createdBy: "rule",
            confidence: 0.88,
            sourceStepIds: ["command-1"],
            tags: ["history", "nmap"],
            notes: null,
            position: { x: 360, y: 120 },
            meta: { port: 80, service_name: "http" },
          },
          {
            id: "service-2",
            projectId: "proj-1",
            type: "service",
            label: "microsoft-ds :445",
            createdAt: "2026-04-19T13:50:23.609004Z",
            updatedAt: "2026-04-19T13:50:23.609004Z",
            createdBy: "rule",
            confidence: 0.88,
            sourceStepIds: ["command-1"],
            tags: ["history", "nmap"],
            notes: null,
            position: { x: 360, y: 240 },
            meta: { port: 445, service_name: "microsoft-ds" },
          },
        ],
        edges: [
          {
            id: "edge-1",
            projectId: "proj-1",
            sourceId: "service-1",
            targetId: "host-1",
            kind: "runs_on",
            sourceStepId: "command-1",
            command: "nmap -sV 10.10.10.10",
            tool: "nmap",
            createdAt: "2026-04-19T13:50:23.609004Z",
            confidence: 0.88,
            label: "http on 10.10.10.10",
            meta: { port: 80 },
          },
          {
            id: "edge-2",
            projectId: "proj-1",
            sourceId: "service-2",
            targetId: "host-1",
            kind: "runs_on",
            sourceStepId: "command-1",
            command: "nmap -sV 10.10.10.10",
            tool: "nmap",
            createdAt: "2026-04-19T13:50:23.609004Z",
            confidence: 0.88,
            label: "microsoft-ds on 10.10.10.10",
            meta: { port: 445 },
          },
        ],
        scenarios: [],
        activeScenarioId: null,
      };

      return {
        proposal: {
          id: "proposal-1",
          projectId: "proj-1",
          sourceType: "command_history" as const,
          sourceId: "command-1",
          proposedBy: "rule" as const,
          status: "accepted" as const,
          title: "Graph inference for nmap -sV 10.10.10.10",
          summary: "Nmap command inferred 1 host and 2 service nodes.",
          payload: {
            sourceStepId: "command-1",
            nodes: [{ type: "host" }, { type: "service" }, { type: "service" }],
            edges: [{ kind: "runs_on" }, { kind: "runs_on" }],
          },
          createdAt: "2026-04-19T13:49:50.989890Z",
          resolvedAt: "2026-04-19T13:50:23.609004Z",
        },
        graphBatch: {
          createdNodeIds: ["host-1", "service-1", "service-2"],
          createdEdgeIds: ["edge-1", "edge-2"],
        },
      };
    }),
    updateNodePosition: vi.fn(),
  },
}));

describe("History graph proposal sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    graphState.proposalStatus = null;
    graphState.graph = {
      projectId: "proj-1",
      source: "stored",
      nodes: [],
      edges: [],
      scenarios: [],
      activeScenarioId: null,
    };

    apiGetMock.mockResolvedValue({ data: [] });
    listProjectCommandsMock.mockResolvedValue({
      items: [
        {
          id: "command-1",
          project_id: "proj-1",
          session_id: "session-1",
          session_name: "Recon Shell",
          command: "nmap -sV 10.10.10.10",
          output_preview: "80/tcp open http",
          output: "80/tcp open http\n445/tcp open microsoft-ds",
          exit_code: 0,
          cwd: "/tmp",
          duration_ms: 1532,
          executed_by: "user-1",
          source: "user",
          timeline_id: null,
          created_at: "2026-04-19T13:48:35.335016Z",
        },
      ],
      total: 1,
      limit: 100,
      offset: 0,
    });
    deleteCommandMock.mockResolvedValue(undefined);
  });

  it("updates history command status after accepting a graph proposal from the graph panel", async () => {
    graphState.proposalStatus = "pending";
    const queryClient = createQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <div>
            <TimelineView projectId="proj-1" />
            <AttackGraphPanel projectId="proj-1" />
          </div>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await screen.findByRole("button", { name: /graph proposed/i });

    fireEvent.click(
      await screen.findByRole("button", {
        name: /accept proposal graph inference for nmap -sV 10\.10\.10\.10/i,
      })
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /graph accepted/i })).toBeInTheDocument();
    });
  });

  it("keeps history in sync across create then accept without a page reload", async () => {
    const queryClient = createQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <div>
            <TimelineView projectId="proj-1" />
            <AttackGraphPanel projectId="proj-1" />
          </div>
        </MemoryRouter>
      </QueryClientProvider>
    );

    fireEvent.click(await screen.findByRole("button", { name: /infer graph/i }));

    await screen.findByRole("button", { name: /graph proposed/i });

    fireEvent.click(
      await screen.findByRole("button", {
        name: /accept proposal graph inference for nmap -sV 10\.10\.10\.10/i,
      })
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /graph accepted/i })).toBeInTheDocument();
    });
  });
});
