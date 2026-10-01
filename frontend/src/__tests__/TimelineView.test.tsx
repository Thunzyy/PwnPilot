import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { clearTimelinePerfSamples } from "../lib/perf/timelinePerf";
import { createQueryClient } from "../lib/queryClient";

const {
  apiMock,
  listProjectCommandsMock,
  listProjectProposalsMock,
  createHistoryProposalMock,
  scrollIntoViewMock,
} = vi.hoisted(() => ({
  apiMock: {
    get: vi.fn(),
  },
  listProjectCommandsMock: vi.fn(),
  listProjectProposalsMock: vi.fn(),
  createHistoryProposalMock: vi.fn(),
  scrollIntoViewMock: vi.fn(),
}));

vi.mock("../api/client", () => ({
  api: apiMock,
}));

vi.mock("../api/ai", () => ({
  aiApi: {
    listProjectCommands: listProjectCommandsMock,
  },
}));

vi.mock("../features/attack-graph/api/graphClient", () => ({
  graphClient: {
    listProjectProposals: listProjectProposalsMock,
    createHistoryProposal: createHistoryProposalMock,
  },
}));

vi.mock("../components/Timeline/TimelineEntry", () => ({
  TimelineEntry: (props: {
    content: string;
    output?: string;
    onSendToAI?: () => void;
  }) => (
    <div data-testid="timeline-entry">
      <span>{props.content}</span>
      {props.output ? <span>{props.output}</span> : null}
      {props.onSendToAI ? (
        <button onClick={props.onSendToAI}>Send to AI</button>
      ) : null}
    </div>
  ),
}));

vi.mock("../components/Timeline/CommandEntry", () => ({
  CommandEntry: (props: {
    command: {
      id?: string;
      command: string;
      output_preview?: string | null;
      output?: string | null;
    };
    onSendToAI?: () => void;
    onInferGraph?: () => void;
    onRevealEvidence?: () => void;
    canRevealEvidence?: boolean;
    graphProposalStatus?: string | null;
  }) => (
    <div data-testid="command-entry">
      <span>{props.command.command}</span>
      {props.command.output_preview ? (
        <span>{props.command.output_preview}</span>
      ) : null}
      {props.command.output ? <span>{props.command.output}</span> : null}
      {props.onSendToAI ? (
        <button onClick={props.onSendToAI}>Send command to AI</button>
      ) : null}
      {props.onInferGraph ? (
        <button onClick={props.onInferGraph}>Infer graph</button>
      ) : null}
      {props.canRevealEvidence && props.onRevealEvidence ? (
        <button onClick={props.onRevealEvidence}>Show evidence</button>
      ) : null}
      {props.graphProposalStatus ? <span>{props.graphProposalStatus}</span> : null}
    </div>
  ),
}));

import { TimelineView } from "../components/Timeline/TimelineView";

beforeEach(() => {
  vi.clearAllMocks();
  clearTimelinePerfSamples();
  apiMock.get.mockResolvedValue({ data: [] });
  listProjectCommandsMock.mockResolvedValue({
    items: [],
    total: 0,
    limit: 100,
    offset: 0,
  });
  listProjectProposalsMock.mockResolvedValue({
    items: [],
    total: 0,
  });
  createHistoryProposalMock.mockResolvedValue({
    items: [],
    total: 0,
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TimelineView", () => {
  const renderTimeline = (initialPath = "/projects/proj-1/timeline") =>
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={[initialPath]}>
          <TimelineView projectId="proj-1" />
        </MemoryRouter>
      </QueryClientProvider>
    );

  it("forwards normal timeline entries to project ai", async () => {
    const onSendToAI = vi.fn();
    apiMock.get.mockResolvedValueOnce({
      data: [
        {
          id: "timeline-1",
          project_id: "proj-1",
          type: "note",
          content: "Captured exposed Grafana login page",
          output: "HTTP 200 on /login",
          metadata: {},
          created_at: "2026-04-11T10:00:00Z",
        },
      ],
    });

    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter>
          <TimelineView projectId="proj-1" onSendToAI={onSendToAI} />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const sendToAiButton = await screen.findByRole("button", {
      name: /send to ai/i,
    });
    fireEvent.click(sendToAiButton);

    expect(onSendToAI).toHaveBeenCalledWith(
      [
        "Timeline entry (note)",
        "Content: Captured exposed Grafana login page",
        "Output:",
        "```",
        "HTTP 200 on /login",
        "```",
      ].join("\n")
    );
  });

  it("renders without constraining the timeline width", async () => {
    const { container } = renderTimeline();

    await screen.findByText(/No audit data yet/i);

    expect(container.querySelector(".max-w-5xl")).toBeNull();
  });

  it("stretches to fill the tab panel width", async () => {
    const { container } = renderTimeline();

    const autoScrollLabel = await screen.findByText(/Auto-Scroll/i);
    const header = autoScrollLabel.closest("header");
    if (!header || !header.parentElement) {
      throw new Error("Timeline header not found");
    }

    const root = header.parentElement;
    expect(root).toBe(container.firstChild);
    expect(root.className).toContain("flex-1");
    expect(root.className).toContain("w-full");
  });

  it("filters and searches across mixed timeline and command activity", async () => {
    const timelineContent = "Captured exposed Grafana login page";
    const commandText = "nmap -sV 10.10.10.10";
    const commandOutputPreview = "445/tcp open microsoft-ds";
    const searchInputValue = "kerberos";

    apiMock.get.mockResolvedValueOnce({
      data: [
        {
          id: "timeline-1",
          project_id: "proj-1",
          type: "note",
          content: timelineContent,
          output: "HTTP 200 on /login",
          metadata: {},
          created_at: "2026-04-11T10:00:00Z",
        },
      ],
    });
    listProjectCommandsMock.mockResolvedValueOnce({
      items: [
        {
          id: "command-1",
          project_id: "proj-1",
          session_id: "session-1",
          session_name: "Recon Shell",
          command: commandText,
          output_preview: commandOutputPreview,
          output: "445/tcp open microsoft-ds\nService Info: Windows Server",
          exit_code: 0,
          cwd: "/tmp",
          duration_ms: 1200,
          executed_by: "user-1",
          source: "user",
          timeline_id: null,
          created_at: "2026-04-11T10:01:00Z",
        },
      ],
      total: 1,
      limit: 100,
      offset: 0,
    });

    renderTimeline();

    await screen.findByText(timelineContent);
    expect(screen.getByText(commandText)).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText(/search audit logs/i);

    fireEvent.change(searchInput, { target: { value: "microsoft-ds" } });
    await waitFor(() => {
      expect(screen.getByText(commandText)).toBeInTheDocument();
      expect(screen.queryByText(timelineContent)).toBeNull();
    });

    fireEvent.change(searchInput, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /^notes$/i }));
    await waitFor(() => {
      expect(screen.getByText(timelineContent)).toBeInTheDocument();
      expect(screen.queryByText(commandText)).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: /^commands$/i }));
    await waitFor(() => {
      expect(screen.getByText(commandText)).toBeInTheDocument();
      expect(screen.queryByText(timelineContent)).toBeNull();
    });

    fireEvent.change(searchInput, { target: { value: searchInputValue } });
    expect(
      await screen.findByText(/no activity matches current search\/filter\./i)
    ).toBeInTheDocument();
  });

  it("records timeline diagnostics samples for load and filter work", async () => {
    apiMock.get.mockResolvedValueOnce({
      data: Array.from({ length: 6 }, (_, index) => ({
        id: `timeline-${index}`,
        project_id: "proj-1",
        type: "note",
        content: `Timeline item ${index}`,
        output: index % 2 === 0 ? `Output ${index}` : null,
        metadata: {},
        created_at: `2026-04-11T10:0${index}:00Z`,
      })),
    });
    listProjectCommandsMock.mockResolvedValueOnce({
      items: Array.from({ length: 6 }, (_, index) => ({
        id: `command-${index}`,
        project_id: "proj-1",
        session_id: `session-${index}`,
        session_name: `Recon ${index}`,
        command: `nmap -Pn 10.10.10.${index}`,
        output_preview: `open port ${index}`,
        output: `open port ${index}`,
        exit_code: 0,
        cwd: "/tmp",
        duration_ms: 1000 + index,
        executed_by: "user-1",
        source: "user",
        timeline_id: null,
        created_at: `2026-04-11T11:0${index}:00Z`,
      })),
      total: 6,
      limit: 100,
      offset: 0,
    });

    renderTimeline();

    await screen.findByText("Timeline item 0");
    const searchInput = screen.getByPlaceholderText(/search audit logs/i);
    fireEvent.change(searchInput, { target: { value: "open port 3" } });

    expect(
      await screen.findByTestId("timeline-performance-panel")
    ).toBeInTheDocument();
    expect(screen.getByText("timeline.load")).toBeInTheDocument();
    expect(screen.getByText("timeline.filter")).toBeInTheDocument();
  });

  it("focuses a command history entry from the commandId query parameter", async () => {
    Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoViewMock,
    });
    listProjectCommandsMock.mockResolvedValueOnce({
      items: [
        {
          id: "command-1",
          project_id: "proj-1",
          session_id: "session-1",
          session_name: "Recon Shell",
          command: "nmap -sV 10.10.10.10",
          output_preview: "80/tcp open http",
          output: "80/tcp open http",
          exit_code: 0,
          cwd: "/tmp",
          duration_ms: 1200,
          executed_by: "user-1",
          source: "user",
          timeline_id: null,
          created_at: "2026-04-11T10:01:00Z",
        },
        {
          id: "command-2",
          project_id: "proj-1",
          session_id: "session-1",
          session_name: "Recon Shell",
          command: "whoami",
          output_preview: "root",
          output: "root",
          exit_code: 0,
          cwd: "/tmp",
          duration_ms: 300,
          executed_by: "user-1",
          source: "user",
          timeline_id: null,
          created_at: "2026-04-11T10:02:00Z",
        },
      ],
      total: 2,
      limit: 100,
      offset: 0,
    });

    renderTimeline("/projects/proj-1/timeline?commandId=command-1");

    const focusedCommand = await screen.findByTestId("history-command-command-1");
    expect(focusedCommand).toHaveAttribute("data-evidence-focus", "true");
    expect(screen.getByText(/evidence focus/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(scrollIntoViewMock).toHaveBeenCalled();
    });
  });

  it("reveals linked methodology evidence from a command history entry", async () => {
    const onRevealCommandEvidence = vi.fn();
    listProjectCommandsMock.mockResolvedValueOnce({
      items: [
        {
          id: "command-1",
          project_id: "proj-1",
          session_id: "session-1",
          session_name: "Recon Shell",
          command: "ssh nathan@10.129.34.191",
          output_preview: "Last login: Thu Apr 30",
          output: "Last login: Thu Apr 30",
          exit_code: 0,
          cwd: "/tmp",
          duration_ms: 1200,
          executed_by: "user-1",
          source: "user",
          timeline_id: null,
          created_at: "2026-04-11T10:01:00Z",
        },
      ],
      total: 1,
      limit: 100,
      offset: 0,
    });

    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter>
          <TimelineView
            projectId="proj-1"
            evidenceCommandIds={["command-1"]}
            onRevealCommandEvidence={onRevealCommandEvidence}
          />
        </MemoryRouter>
      </QueryClientProvider>
    );

    fireEvent.click(
      await screen.findByRole("button", { name: /show evidence/i })
    );

    expect(onRevealCommandEvidence).toHaveBeenCalledWith("command-1");
  });

  it("creates a graph proposal from a command history entry", async () => {
    listProjectCommandsMock.mockResolvedValueOnce({
      items: [
        {
          id: "command-1",
          project_id: "proj-1",
          session_id: "session-1",
          session_name: "Recon Shell",
          command: "nmap -sV 10.10.10.10",
          output_preview: "80/tcp open http",
          output: "80/tcp open http",
          exit_code: 0,
          cwd: "/tmp",
          duration_ms: 1200,
          executed_by: "user-1",
          source: "user",
          timeline_id: null,
          created_at: "2026-04-11T10:01:00Z",
        },
      ],
      total: 1,
      limit: 100,
      offset: 0,
    });
    listProjectProposalsMock
      .mockResolvedValueOnce({
        items: [],
        total: 0,
      })
      .mockResolvedValue({
        items: [
          {
            id: "proposal-1",
            projectId: "proj-1",
            sourceType: "command_history",
            sourceId: "command-1",
            proposedBy: "rule",
            status: "pending",
            payload: {
              sourceStepId: "command-1",
              nodes: [],
              edges: [],
            },
            title: "Graph inference for nmap -sV 10.10.10.10",
            summary: "Nmap command inferred 1 host and 1 service nodes.",
            createdAt: "2026-04-11T10:02:00Z",
            resolvedAt: null,
          },
        ],
        total: 1,
      });
    createHistoryProposalMock.mockResolvedValueOnce({
      items: [
        {
          id: "proposal-1",
          projectId: "proj-1",
          sourceType: "command_history",
          sourceId: "command-1",
          proposedBy: "rule",
          status: "pending",
          payload: {
            sourceStepId: "command-1",
            nodes: [],
            edges: [],
          },
          title: "Graph inference for nmap -sV 10.10.10.10",
          summary: "Nmap command inferred 1 host and 1 service nodes.",
          createdAt: "2026-04-11T10:02:00Z",
          resolvedAt: null,
        },
      ],
      total: 1,
    });

    renderTimeline();

    const inferGraphButton = await screen.findByRole("button", {
      name: /infer graph/i,
    });
    fireEvent.click(inferGraphButton);

    await waitFor(() => {
      expect(createHistoryProposalMock).toHaveBeenCalledWith("proj-1", "command-1");
      expect(screen.getByText("pending")).toBeInTheDocument();
    });
  });
});
