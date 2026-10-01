import type { ComponentProps, ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "@/lib/queryClient";

import { AttackGraphPanel } from "../AttackGraphPanel";

const {
  useProjectGraphMock,
  acceptProposalMock,
  seedDemoCtfMock,
  setNodesMock,
  reactFlowMock,
  layoutAttackGraphMock,
} = vi.hoisted(() => ({
  useProjectGraphMock: vi.fn(),
  acceptProposalMock: vi.fn(),
  seedDemoCtfMock: vi.fn(),
  setNodesMock: vi.fn(),
  reactFlowMock: vi.fn(),
  layoutAttackGraphMock: vi.fn().mockResolvedValue({}),
}));

vi.mock("../useProjectGraph", () => ({
  useProjectGraph: (...args: unknown[]) => useProjectGraphMock(...args),
}));

vi.mock("@xyflow/react", () => ({
  Background: () => null,
  Controls: () => null,
  MarkerType: {
    ArrowClosed: "arrowclosed",
  },
  ReactFlow: (props: { children?: ReactNode; edges?: unknown[] }) => {
    reactFlowMock(props);
    return <div data-testid="react-flow">{props.children}</div>;
  },
  ReactFlowProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useReactFlow: () => ({
    fitView: vi.fn(),
    setCenter: vi.fn(),
    setNodes: setNodesMock,
  }),
}));

vi.mock("../layout", () => ({
  ATTACK_GRAPH_NODE_WIDTH: 280,
  ATTACK_GRAPH_NODE_HEIGHT: 120,
  layoutAttackGraph: layoutAttackGraphMock,
}));

vi.mock("../TypedGraphNode", () => ({
  TypedGraphNode: () => null,
}));

vi.mock("../GraphSearchPalette", () => ({
  GraphSearchPalette: () => null,
}));

function renderAttackGraphPanel(
  props: Partial<ComponentProps<typeof AttackGraphPanel>> = {},
) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <AttackGraphPanel projectId="proj-1" {...props} />
    </QueryClientProvider>,
  );
}

describe("AttackGraphPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    layoutAttackGraphMock.mockResolvedValue({});
    acceptProposalMock.mockResolvedValue({
      proposal: {
        id: "proposal-1",
      },
    });
    seedDemoCtfMock.mockResolvedValue(undefined);
    useProjectGraphMock.mockReturnValue({
      graph: {
        projectId: "proj-1",
        source: "stored",
        nodes: [],
        edges: [],
        scenarios: [],
        activeScenarioId: null,
      },
      isLoading: false,
      error: null,
      proposals: [
        {
          id: "proposal-1",
          projectId: "proj-1",
          sourceType: "command_history",
          sourceId: "command-1",
          proposedBy: "rule",
          status: "pending",
          title: "Graph inference for nmap -sV 10.10.10.10",
          summary: "Nmap command inferred 1 host and 1 service nodes.",
          payload: {
            sourceStepId: "command-1",
            nodes: [{ type: "host" }, { type: "service" }],
            edges: [{ kind: "runs_on" }],
          },
          createdAt: "2026-04-19T12:00:00Z",
          resolvedAt: null,
        },
      ],
      isProposalsLoading: false,
      seedDemoCtf: seedDemoCtfMock,
      isSeeding: false,
      loadShortestPath: vi.fn(),
      isPathLoading: false,
      pathResult: null,
      acceptingProposalId: null,
      acceptProposal: acceptProposalMock,
      updateNodePosition: vi.fn(),
    });
  });

  it("accepts a pending history proposal when the graph is still empty", async () => {
    renderAttackGraphPanel();

    expect(
      screen.getByText(/review pending history proposals/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/nmap command inferred 1 host and 1 service nodes\./i)
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: /accept proposal graph inference for nmap -sV 10\.10\.10\.10/i,
        })
      );
    });

    expect(acceptProposalMock).toHaveBeenCalledWith("proposal-1");
  });

  it("adds visible phase header nodes for a Cap-like graph timeline", async () => {
    layoutAttackGraphMock.mockResolvedValue({
      "node-enum": { x: 80, y: 160 },
      "node-host": { x: 80, y: 340 },
      "node-cred": { x: 580, y: 300 },
      "node-session": { x: 1080, y: 220 },
      "node-privesc": { x: 1580, y: 260 },
      "node-loot": { x: 2080, y: 240 },
    });

    useProjectGraphMock.mockReturnValue({
      graph: {
        projectId: "proj-1",
        source: "stored",
        activeScenarioId: null,
        scenarios: [],
        nodes: [
          {
            id: "node-enum",
            projectId: "proj-1",
            type: "action",
            label: "Extract FTP credentials",
            createdAt: "2026-04-26T12:00:00Z",
            updatedAt: "2026-04-26T12:00:00Z",
            createdBy: "rule",
            confidence: 1,
            sourceStepIds: [],
            tags: [],
            notes: null,
            position: null,
            meta: { command: "tshark -r 0.pcap" },
          },
          {
            id: "node-host",
            projectId: "proj-1",
            type: "host",
            label: "10.129.34.191",
            createdAt: "2026-04-26T12:00:00Z",
            updatedAt: "2026-04-26T12:00:00Z",
            createdBy: "rule",
            confidence: 1,
            sourceStepIds: [],
            tags: [],
            notes: null,
            position: null,
            meta: { ip: "10.129.34.191" },
          },
          {
            id: "node-cred",
            projectId: "proj-1",
            type: "credential",
            label: "Credential: nathan",
            createdAt: "2026-04-26T12:00:00Z",
            updatedAt: "2026-04-26T12:00:00Z",
            createdBy: "rule",
            confidence: 1,
            sourceStepIds: [],
            tags: [],
            notes: null,
            position: null,
            meta: { username: "nathan" },
          },
          {
            id: "node-session",
            projectId: "proj-1",
            type: "session",
            label: "SSH session: nathan@10.129.34.191",
            createdAt: "2026-04-26T12:00:00Z",
            updatedAt: "2026-04-26T12:00:00Z",
            createdBy: "rule",
            confidence: 1,
            sourceStepIds: [],
            tags: [],
            notes: null,
            position: null,
            meta: { user: "nathan", privilege: "user" },
          },
          {
            id: "node-privesc",
            projectId: "proj-1",
            type: "finding",
            label: "python3.8 cap_setuid",
            createdAt: "2026-04-26T12:00:00Z",
            updatedAt: "2026-04-26T12:00:00Z",
            createdBy: "rule",
            confidence: 1,
            sourceStepIds: [],
            tags: [],
            notes: null,
            position: null,
            meta: { title: "python3.8 cap_setuid" },
          },
          {
            id: "node-loot",
            projectId: "proj-1",
            type: "loot",
            label: "root.txt",
            createdAt: "2026-04-26T12:00:00Z",
            updatedAt: "2026-04-26T12:00:00Z",
            createdBy: "rule",
            confidence: 1,
            sourceStepIds: [],
            tags: [],
            notes: null,
            position: null,
            meta: { path: "/root/root.txt" },
          },
        ],
        edges: [],
      },
      isLoading: false,
      error: null,
      proposals: [],
      isProposalsLoading: false,
      seedDemoCtf: seedDemoCtfMock,
      isSeeding: false,
      loadShortestPath: vi.fn(),
      isPathLoading: false,
      pathResult: null,
      acceptingProposalId: null,
      acceptProposal: acceptProposalMock,
      updateNodePosition: vi.fn(),
    });

    await act(async () => {
      renderAttackGraphPanel();
      await Promise.resolve();
      await Promise.resolve();
    });

    const updater = setNodesMock.mock.calls.at(-1)?.[0];
    expect(typeof updater).toBe("function");

    const renderedNodes = updater([]);
    const phaseHeaderNodes = renderedNodes.filter(
      (node: { type?: string }) => node.type === "phaseHeader",
    );
    const labels = phaseHeaderNodes.map(
      (node: { data?: { label?: string } }) => node.data?.label,
    );

    expect(labels).toEqual(
      expect.arrayContaining([
        "Enumeration",
        "Credential Access",
        "Foothold",
        "Privilege Escalation",
        "Loot / Objectives",
      ]),
    );
  });

  it("prioritizes foothold and privesc headers over loot keywords inside mixed columns", async () => {
    layoutAttackGraphMock.mockResolvedValue({
      "node-cred": { x: 80, y: 180 },
      "node-session": { x: 580, y: 140 },
      "node-read-user": { x: 580, y: 320 },
      "node-privesc": { x: 1080, y: 180 },
      "node-user-loot": { x: 1080, y: 320 },
      "node-root-loot": { x: 1580, y: 220 },
    });

    useProjectGraphMock.mockReturnValue({
      graph: {
        projectId: "proj-1",
        source: "stored",
        activeScenarioId: null,
        scenarios: [],
        nodes: [
          {
            id: "node-cred",
            projectId: "proj-1",
            type: "credential",
            label: "Credential: nathan",
            createdAt: "2026-04-26T12:00:00Z",
            updatedAt: "2026-04-26T12:00:00Z",
            createdBy: "rule",
            confidence: 1,
            sourceStepIds: [],
            tags: [],
            notes: null,
            position: null,
            meta: { username: "nathan" },
          },
          {
            id: "node-session",
            projectId: "proj-1",
            type: "session",
            label: "SSH session: nathan@10.129.34.191",
            createdAt: "2026-04-26T12:00:00Z",
            updatedAt: "2026-04-26T12:00:00Z",
            createdBy: "rule",
            confidence: 1,
            sourceStepIds: [],
            tags: [],
            notes: null,
            position: null,
            meta: { user: "nathan", privilege: "user" },
          },
          {
            id: "node-read-user",
            projectId: "proj-1",
            type: "action",
            label: "Read user.txt",
            createdAt: "2026-04-26T12:00:00Z",
            updatedAt: "2026-04-26T12:00:00Z",
            createdBy: "rule",
            confidence: 1,
            sourceStepIds: [],
            tags: [],
            notes: null,
            position: null,
            meta: { command: "cat user.txt" },
          },
          {
            id: "node-privesc",
            projectId: "proj-1",
            type: "finding",
            label: "python3.8 cap_setuid",
            createdAt: "2026-04-26T12:00:00Z",
            updatedAt: "2026-04-26T12:00:00Z",
            createdBy: "rule",
            confidence: 1,
            sourceStepIds: [],
            tags: [],
            notes: null,
            position: null,
            meta: { title: "python3.8 cap_setuid" },
          },
          {
            id: "node-user-loot",
            projectId: "proj-1",
            type: "loot",
            label: "user.txt",
            createdAt: "2026-04-26T12:00:00Z",
            updatedAt: "2026-04-26T12:00:00Z",
            createdBy: "rule",
            confidence: 1,
            sourceStepIds: [],
            tags: [],
            notes: null,
            position: null,
            meta: { path: "/home/nathan/user.txt" },
          },
          {
            id: "node-root-loot",
            projectId: "proj-1",
            type: "loot",
            label: "root.txt",
            createdAt: "2026-04-26T12:00:00Z",
            updatedAt: "2026-04-26T12:00:00Z",
            createdBy: "rule",
            confidence: 1,
            sourceStepIds: [],
            tags: [],
            notes: null,
            position: null,
            meta: { path: "/root/root.txt" },
          },
        ],
        edges: [],
      },
      isLoading: false,
      error: null,
      proposals: [],
      isProposalsLoading: false,
      seedDemoCtf: seedDemoCtfMock,
      isSeeding: false,
      loadShortestPath: vi.fn(),
      isPathLoading: false,
      pathResult: null,
      acceptingProposalId: null,
      acceptProposal: acceptProposalMock,
      updateNodePosition: vi.fn(),
    });

    await act(async () => {
      renderAttackGraphPanel();
      await Promise.resolve();
      await Promise.resolve();
    });

    const updater = setNodesMock.mock.calls.at(-1)?.[0];
    expect(typeof updater).toBe("function");

    const renderedNodes = updater([]);
    const labels = renderedNodes
      .filter((node: { type?: string }) => node.type === "phaseHeader")
      .map((node: { data?: { label?: string } }) => node.data?.label);

    expect(labels).toEqual(
      expect.arrayContaining([
        "Credential Access",
        "Foothold",
        "Privilege Escalation",
        "Loot / Objectives",
      ]),
    );
  });

  it("marks report bundle comparison deltas and filters to changed graph elements", async () => {
    layoutAttackGraphMock.mockResolvedValue({
      "node-1": { x: 80, y: 160 },
      "node-2": { x: 580, y: 160 },
      "node-3": { x: 1080, y: 160 },
    });
    useProjectGraphMock.mockReturnValue({
      graph: {
        projectId: "proj-1",
        source: "stored",
        activeScenarioId: null,
        scenarios: [],
        nodes: [
          {
            id: "node-1",
            projectId: "proj-1",
            type: "host",
            label: "10.10.10.10",
            createdAt: "2026-04-26T12:00:00Z",
            updatedAt: "2026-04-26T12:00:00Z",
            createdBy: "rule",
            confidence: 1,
            sourceStepIds: [],
            tags: [],
            notes: null,
            position: null,
            meta: { ip: "10.10.10.10" },
          },
          {
            id: "node-2",
            projectId: "proj-1",
            type: "finding",
            label: "New capability finding",
            createdAt: "2026-04-26T12:01:00Z",
            updatedAt: "2026-04-26T12:01:00Z",
            createdBy: "rule",
            confidence: 1,
            sourceStepIds: [],
            tags: [],
            notes: null,
            position: null,
            meta: { title: "New capability finding" },
          },
          {
            id: "node-3",
            projectId: "proj-1",
            type: "session",
            label: "Root session",
            createdAt: "2026-04-26T12:02:00Z",
            updatedAt: "2026-04-26T12:02:00Z",
            createdBy: "rule",
            confidence: 1,
            sourceStepIds: [],
            tags: [],
            notes: null,
            position: null,
            meta: { user: "root", privilege: "root" },
          },
        ],
        edges: [
          {
            id: "edge-1",
            projectId: "proj-1",
            sourceId: "node-1",
            targetId: "node-3",
            kind: "related_to",
            sourceStepId: null,
            command: null,
            tool: null,
            createdAt: "2026-04-26T12:00:00Z",
            confidence: 1,
            label: null,
            meta: {},
          },
          {
            id: "edge-2",
            projectId: "proj-1",
            sourceId: "node-2",
            targetId: "node-3",
            kind: "escalated_to",
            sourceStepId: null,
            command: null,
            tool: null,
            createdAt: "2026-04-26T12:01:00Z",
            confidence: 1,
            label: null,
            meta: {},
          },
        ],
      },
      isLoading: false,
      error: null,
      proposals: [],
      isProposalsLoading: false,
      seedDemoCtf: seedDemoCtfMock,
      isSeeding: false,
      loadShortestPath: vi.fn(),
      isPathLoading: false,
      pathResult: null,
      acceptingProposalId: null,
      acceptProposal: acceptProposalMock,
      updateNodePosition: vi.fn(),
    });

    await act(async () => {
      renderAttackGraphPanel({
        comparisonOverlay: {
          source: "report-bundle",
          baseRevision: 1,
          targetRevision: 2,
          addedNodeIds: ["node-2"],
          removedNodeIds: ["node-old"],
          addedEdgeIds: ["edge-2"],
          removedEdgeIds: ["edge-old"],
          addedNodes: [],
          removedNodes: [
            {
              id: "node-old",
              projectId: "proj-1",
              type: "host",
              label: "Removed host",
              createdAt: "2026-04-26T11:59:00Z",
              updatedAt: "2026-04-26T11:59:00Z",
              createdBy: "import",
              confidence: 1,
              sourceStepIds: [],
              tags: ["old"],
              notes: null,
              position: null,
              meta: { ip: "10.10.10.9" },
            },
          ],
          addedEdges: [],
          removedEdges: [
            {
              id: "edge-old",
              projectId: "proj-1",
              sourceId: "node-old",
              targetId: "node-3",
              kind: "related_to",
              sourceStepId: null,
              command: null,
              tool: null,
              createdAt: "2026-04-26T11:59:00Z",
              confidence: 1,
              label: null,
              meta: {},
            },
          ],
        },
      } as Partial<ComponentProps<typeof AttackGraphPanel>>);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("Report Bundle Comparison")).toBeInTheDocument();
    expect(screen.getByText("Revision 1 -> 2")).toBeInTheDocument();
    expect(screen.getByText("1 added")).toBeInTheDocument();

    const initialUpdater = setNodesMock.mock.calls.at(-1)?.[0];
    expect(typeof initialUpdater).toBe("function");
    const initialTypedNodes = initialUpdater([]).filter(
      (node: { type?: string }) => node.type === "typed",
    );
    expect(
      initialTypedNodes.find((node: { id: string }) => node.id === "node-2")
        ?.data.comparisonState,
    ).toBe("added");
    expect(
      initialTypedNodes.find((node: { id: string }) => node.id === "node-1")
        ?.data.comparisonState,
    ).toBeUndefined();
    expect(
      initialTypedNodes.find((node: { id: string }) => node.id === "node-old")
        ?.data.comparisonState,
    ).toBe("removed");
    expect(reactFlowMock.mock.calls.at(-1)?.[0].edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "edge-2",
          label: "added · escalated to",
        }),
        expect.objectContaining({
          id: "edge-old",
          label: "removed · related",
        }),
      ]),
    );

    fireEvent.click(
      screen.getByRole("button", { name: /show only changed graph elements/i }),
    );

    await waitFor(() => {
      const changedUpdater = setNodesMock.mock.calls.at(-1)?.[0];
      const changedTypedNodes = changedUpdater([]).filter(
        (node: { type?: string }) => node.type === "typed",
      );
      expect(changedTypedNodes.map((node: { id: string }) => node.id)).toEqual([
        "node-2",
        "node-3",
        "node-old",
      ]);
      expect(reactFlowMock.mock.calls.at(-1)?.[0].edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "edge-2" }),
          expect.objectContaining({ id: "edge-old" }),
        ]),
      );
    });
  });
});
