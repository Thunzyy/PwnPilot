import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AttackGraph } from "../AttackGraph";

const graphHookState = vi.hoisted(() => ({
  graph: {
    nodes: [{ id: "canonical-1" }, { id: "canonical-2" }],
  },
}));

const attackGraphPanelMock = vi.fn(
  ({
    projectId,
    isCollapsed,
    selectedGraphNodeId,
    fallbackGraph,
    onSendEvidenceToAI,
    onAddEvidenceToReport,
  }: {
    projectId?: string;
    isCollapsed?: boolean;
    selectedGraphNodeId?: string | null;
    fallbackGraph?: { nodes: Array<{ id: string; label: string }> } | null;
    onSendEvidenceToAI?: (text: string) => void;
    onAddEvidenceToReport?: (payload: unknown) => Promise<unknown>;
  }) => (
    <div data-testid="attack-graph-panel">
      panel:{projectId ?? "none"}:{String(isCollapsed)}:
      {selectedGraphNodeId ?? "none"}:{fallbackGraph?.nodes[0]?.label ?? "none"}:
      {typeof onSendEvidenceToAI}:{typeof onAddEvidenceToReport}
    </div>
  )
);

vi.mock("@/features/attack-graph/AttackGraphPanel", () => ({
  AttackGraphPanel: (props: {
    projectId?: string;
    isCollapsed?: boolean;
    selectedGraphNodeId?: string | null;
    fallbackGraph?: { nodes: Array<{ id: string; label: string }> } | null;
    onSendEvidenceToAI?: (text: string) => void;
    onAddEvidenceToReport?: (payload: unknown) => Promise<unknown>;
  }) =>
    attackGraphPanelMock(props),
}));

vi.mock("@/features/attack-graph/useProjectGraph", () => ({
  useProjectGraph: () => ({
    graph: graphHookState.graph,
  }),
}));

describe("AttackGraph wrapper", () => {
  beforeEach(() => {
    attackGraphPanelMock.mockClear();
    graphHookState.graph = {
      nodes: [{ id: "canonical-1" }, { id: "canonical-2" }],
    };
  });

  it("keeps the collapsed state lightweight and does not render the full panel", () => {
    render(
      <AttackGraph
        projectId="project-1"
        isCollapsed
        nodes={[{ id: "n1" }, { id: "n2" }]}
      />
    );

    expect(screen.getByRole("button", { name: /expand attack graph/i })).toHaveTextContent(
      "2 Nodes"
    );
    expect(screen.queryByTestId("attack-graph-panel")).not.toBeInTheDocument();
    expect(attackGraphPanelMock).not.toHaveBeenCalled();
  });

  it("forwards to the full panel once expanded", async () => {
    const onToggle = vi.fn();

    const { rerender } = render(
      <AttackGraph projectId="project-1" isCollapsed onToggle={onToggle} />
    );

    fireEvent.click(screen.getByRole("button", { name: /expand attack graph/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerender(
        <AttackGraph projectId="project-1" isCollapsed={false} onToggle={onToggle} />
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId("attack-graph-panel")).toHaveTextContent(
        "panel:project-1:false"
      );
      expect(attackGraphPanelMock).toHaveBeenCalledTimes(1);
    });
  });

  it("forwards externally selected graph node id to the full panel", async () => {
    await act(async () => {
      render(
        <AttackGraph
          projectId="project-1"
          selectedGraphNodeId="node-ssh-session"
        />
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(attackGraphPanelMock).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-1",
          selectedGraphNodeId: "node-ssh-session",
        })
      );
    });
  });

  it("falls back to derived engagement nodes when the canonical graph is empty", async () => {
    graphHookState.graph = { nodes: [] };

    await act(async () => {
      render(
        <AttackGraph
          projectId="project-1"
          nodes={[
            {
              id: "timeline-1",
              type: "success",
              status: "success",
              title: "SeImpersonatePrivilege identified",
              subtitle: "Timeline finding",
              icon: "flag",
              position: { x: "15%", y: "50%" },
              sectionId: "privesc",
              itemId: "windows-privesc",
            },
          ]}
        />
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(attackGraphPanelMock).toHaveBeenCalledWith(
        expect.objectContaining({
          fallbackGraph: expect.objectContaining({
            nodes: [
              expect.objectContaining({
                id: "timeline-1",
                label: "SeImpersonatePrivilege identified",
                type: "finding",
              }),
            ],
          }),
        })
      );
    });
  });

  it("forwards graph evidence AI handoff to the full panel", async () => {
    const onSendEvidenceToAI = vi.fn();

    await act(async () => {
      render(
        <AttackGraph
          projectId="project-1"
          onSendEvidenceToAI={onSendEvidenceToAI}
        />
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(attackGraphPanelMock).toHaveBeenCalledWith(
        expect.objectContaining({
          onSendEvidenceToAI,
        })
      );
    });
  });

  it("forwards graph evidence report handoff to the full panel", async () => {
    const onAddEvidenceToReport = vi.fn();

    await act(async () => {
      render(
        <AttackGraph
          projectId="project-1"
          onAddEvidenceToReport={onAddEvidenceToReport}
        />
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(attackGraphPanelMock).toHaveBeenCalledWith(
        expect.objectContaining({
          onAddEvidenceToReport,
        })
      );
    });
  });
});
