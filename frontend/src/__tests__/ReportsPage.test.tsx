import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "@/lib/queryClient";
import { ReportsPage } from "@/pages/Reports";

const { layoutAttackGraphMock } = vi.hoisted(() => ({
  layoutAttackGraphMock: vi.fn(async () => ({
    "graph-node-1": { x: 0, y: 0 },
    "graph-node-2": { x: 320, y: 0 },
  })),
}));

const projectStoreState = vi.hoisted(() => ({
  currentProject: {
    id: "project-1",
    name: "Cap",
    variables: {},
  },
  fetchProject: vi.fn(),
}));

const reportApiMocks = vi.hoisted(() => ({
  reportQueryKeys: {
    detail: (projectId: string) => ["report", projectId] as const,
    proposals: (projectId: string) => ["report", projectId, "proposals"] as const,
    artifacts: (projectId: string) => ["report", projectId, "artifacts"] as const,
    notesSyncStatus: (projectId: string) =>
      ["report", projectId, "notes-sync-status"] as const,
    notesSyncDiff: (projectId: string) =>
      ["report", projectId, "notes-sync-diff"] as const,
    artifactGraphPreview: (projectId: string, artifactId: string) =>
      ["report", projectId, "artifact-graph-preview", artifactId] as const,
    evaluationTask: (projectId: string, taskId: string) =>
      ["report", projectId, "evaluation-task", taskId] as const,
  },
  fetchProjectReport: vi.fn(),
  fetchReportProposals: vi.fn(),
  fetchReportBundleArtifacts: vi.fn(),
  fetchReportBundleArtifactGraphSvg: vi.fn(),
  downloadReportBundleArtifactGraphPng: vi.fn(),
  compareReportBundleArtifacts: vi.fn(),
  evaluateProjectReport: vi.fn(),
  evaluateReportSection: vi.fn(),
  fetchReportEvaluationTask: vi.fn(),
  seedMockReportDemoCtf: vi.fn(),
  downloadReportBundle: vi.fn(),
  downloadReportBundleArtifact: vi.fn(),
  exportReportFolder: vi.fn(),
  syncReportToNotes: vi.fn(),
  fetchReportNotesSyncStatus: vi.fn(),
  fetchReportNotesSyncDiff: vi.fn(),
  acceptReportProposal: vi.fn(),
  rejectReportProposal: vi.fn(),
}));
const aiApiMocks = vi.hoisted(() => ({
  aiApi: {
    listProviders: vi.fn(),
  },
}));

vi.mock("@/stores/projectStore", () => ({
  useProjectStore: (selector?: (state: typeof projectStoreState) => unknown) =>
    selector ? selector(projectStoreState) : projectStoreState,
}));

vi.mock("@/api/report", () => reportApiMocks);
vi.mock("@/api/ai", () => aiApiMocks);
vi.mock("@/components/AI/AIQuickSettings", () => ({
  AIQuickSettings: ({ label }: { label?: string }) => <button type="button">{label ?? "AI Settings"}</button>,
}));
vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<typeof import("@xyflow/react")>(
    "@xyflow/react",
  );

  return {
    ...actual,
    ReactFlow: ({
      children,
      nodes,
    }: {
      children?: ReactNode;
      nodes?: Array<{ id: string }>;
    }) => (
      <div
        data-testid="report-attack-graph-flow"
        data-node-count={String(nodes?.length ?? 0)}
      >
        {children}
      </div>
    ),
    ReactFlowProvider: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Background: () => null,
    Controls: () => null,
    Handle: () => null,
    Position: {
      Left: "left",
      Right: "right",
      Top: "top",
      Bottom: "bottom",
    },
    MarkerType: {
      ArrowClosed: "arrowclosed",
    },
  };
});
vi.mock("@/features/attack-graph/useProjectGraph", () => ({
  useProjectGraph: () => ({
    graph: {
      projectId: "project-1",
      source: "stored" as const,
      nodes: [
        {
          id: "graph-node-1",
          projectId: "project-1",
          type: "host" as const,
          label: "10.129.34.191",
          createdAt: "2026-04-23T00:00:00Z",
          updatedAt: "2026-04-23T00:00:00Z",
          createdBy: "rule" as const,
          confidence: 1,
          sourceStepIds: [],
          tags: [],
          notes: null,
          position: null,
          meta: { ip: "10.129.34.191" },
        },
        {
          id: "graph-node-2",
          projectId: "project-1",
          type: "session" as const,
          label: "SSH session: nathan@10.129.34.191",
          createdAt: "2026-04-23T00:00:00Z",
          updatedAt: "2026-04-23T00:00:00Z",
          createdBy: "rule" as const,
          confidence: 1,
          sourceStepIds: [],
          tags: [],
          notes: null,
          position: null,
          meta: { user: "nathan", shell_type: "ssh" },
        },
      ],
      edges: [
        {
          id: "graph-edge-1",
          projectId: "project-1",
          sourceId: "graph-node-1",
          targetId: "graph-node-2",
          kind: "opens_session_on" as const,
          sourceStepId: null,
          command: null,
          tool: null,
          createdAt: "2026-04-23T00:00:00Z",
          confidence: 1,
          label: "opens session",
          meta: {},
        },
      ],
      scenarios: [],
      activeScenarioId: null,
    },
    isLoading: false,
    error: null,
    proposals: [],
    isProposalsLoading: false,
    isSeeding: false,
    seedDemoCtf: vi.fn(),
    isPathLoading: false,
    pathResult: null,
    loadShortestPath: vi.fn(),
    acceptingProposalId: null,
    acceptProposal: vi.fn(),
    updateNodePosition: vi.fn(),
  }),
}));
vi.mock("@/features/attack-graph/layout", () => ({
  ATTACK_GRAPH_NODE_WIDTH: 280,
  ATTACK_GRAPH_NODE_HEIGHT: 104,
  layoutAttackGraph: layoutAttackGraphMock,
}));

function buildReportResponse({
  profile = "htb_writeup",
  currentRevision = 1,
  reconContent = "Existing recon section",
  privilegeEscalationContent = "",
}: {
  profile?: string;
  currentRevision?: number;
  reconContent?: string;
  privilegeEscalationContent?: string;
} = {}) {
  return {
    id: "report-1",
    projectId: "project-1",
    title: "Cap",
    profile,
    markdownPath: "/tmp/project-1/report.md",
    currentRevision,
    lastEvaluatedAt: null,
    lastAcceptedAt: null,
    createdAt: "2026-04-21T20:00:00Z",
    updatedAt: "2026-04-21T20:00:00Z",
    sections: [
      {
        id: "section-1",
        key: "recon",
        title: "Recon",
        contentMd: reconContent,
        position: 0,
        updatedAt: "2026-04-21T20:00:00Z",
      },
      {
        id: "section-2",
        key: "privilege_escalation",
        title: "Privilege Escalation",
        contentMd: privilegeEscalationContent,
        position: 1,
        updatedAt: "2026-04-21T20:00:00Z",
      },
    ],
  };
}

function buildProposalListResponse(count = 1) {
  return {
    items:
      count > 0
        ? [
            {
              id: "proposal-1",
              reportId: "report-1",
              triggerType: "event",
              status: "pending",
              summary: "Add privilege escalation details",
              createdAt: "2026-04-21T20:05:00Z",
              updatedAt: "2026-04-21T20:05:00Z",
              resolvedAt: null,
              evidenceLinks: [
                {
                  id: "evidence-1",
                  patchId: "patch-1",
                  sourceType: "command_history",
                  sourceId: "cmd-1",
                  label: "Command",
                  preview: "getcap -r / 2>/dev/null",
                  href: "/projects/project-1/timeline?commandId=cmd-1",
                  createdAt: "2026-04-21T20:05:00Z",
                },
              ],
              sectionPatches: [
                {
                  id: "patch-1",
                  sectionKey: "privilege_escalation",
                  sectionTitle: "Privilege Escalation",
                  summary: "Document capability abuse",
                  currentContentMd: "",
                  contentMd: "Escalated to root via python capability abuse.",
                  diffText:
                    "--- privilege_escalation:current\n+++ privilege_escalation:proposed\n@@ -0,0 +1 @@\n+Escalated to root via python capability abuse.",
                  createdAt: "2026-04-21T20:05:00Z",
                  evidenceLinks: [
                    {
                      id: "evidence-1",
                      patchId: "patch-1",
                      sourceType: "command_history",
                      sourceId: "cmd-1",
                      label: "Command",
                      preview: "getcap -r / 2>/dev/null",
                      href: "/projects/project-1/timeline?commandId=cmd-1",
                      createdAt: "2026-04-21T20:05:00Z",
                    },
                  ],
                },
              ],
            },
          ]
        : [],
    total: count,
  };
}

function renderPage(initialPath = "/reports") {
  const queryClient = createQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <ReportsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ReportsPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    projectStoreState.currentProject = {
      id: "project-1",
      name: "Cap",
      variables: {},
    };
    projectStoreState.fetchProject.mockReset();
    projectStoreState.fetchProject.mockResolvedValue(projectStoreState.currentProject);
    reportApiMocks.fetchProjectReport.mockReset();
    reportApiMocks.fetchReportProposals.mockReset();
    reportApiMocks.fetchReportBundleArtifacts.mockReset();
    reportApiMocks.fetchReportBundleArtifactGraphSvg.mockReset();
    reportApiMocks.downloadReportBundleArtifactGraphPng.mockReset();
    reportApiMocks.compareReportBundleArtifacts.mockReset();
    reportApiMocks.evaluateProjectReport.mockReset();
    reportApiMocks.evaluateReportSection.mockReset();
    reportApiMocks.fetchReportEvaluationTask.mockReset();
    reportApiMocks.seedMockReportDemoCtf.mockReset();
    reportApiMocks.downloadReportBundle.mockReset();
    reportApiMocks.downloadReportBundleArtifact.mockReset();
    reportApiMocks.exportReportFolder.mockReset();
    reportApiMocks.syncReportToNotes.mockReset();
    reportApiMocks.fetchReportNotesSyncStatus.mockReset();
    reportApiMocks.fetchReportNotesSyncDiff.mockReset();
    reportApiMocks.acceptReportProposal.mockReset();
    reportApiMocks.rejectReportProposal.mockReset();

    reportApiMocks.fetchProjectReport.mockResolvedValue(buildReportResponse());
    reportApiMocks.fetchReportProposals.mockResolvedValue(buildProposalListResponse());
    reportApiMocks.fetchReportBundleArtifacts.mockResolvedValue({ items: [], total: 0 });
    reportApiMocks.fetchReportBundleArtifactGraphSvg.mockResolvedValue(
      '<svg role="img"><text>10.129.34.191</text></svg>',
    );
    reportApiMocks.downloadReportBundleArtifactGraphPng.mockResolvedValue(
      new Blob(["png"], { type: "image/png" }),
    );
    reportApiMocks.compareReportBundleArtifacts.mockResolvedValue({
      base: {
        id: "artifact-1",
        projectId: "project-1",
        reportId: "report-1",
        filename: "cap-report-bundle-r1.zip",
        contentType: "application/zip",
        sizeBytes: 2048,
        sha256: "a".repeat(64),
        reportRevision: 1,
        graphNodeCount: 2,
        graphEdgeCount: 1,
        acceptedCommandCount: 1,
        acceptedCommandIds: ["cmd-1"],
        createdAt: "2026-04-21T20:08:00Z",
      },
      target: {
        id: "artifact-2",
        projectId: "project-1",
        reportId: "report-1",
        filename: "cap-report-bundle-r2.zip",
        contentType: "application/zip",
        sizeBytes: 4096,
        sha256: "b".repeat(64),
        reportRevision: 2,
        graphNodeCount: 3,
        graphEdgeCount: 2,
        acceptedCommandCount: 2,
        acceptedCommandIds: ["cmd-1", "cmd-2"],
        createdAt: "2026-04-21T20:12:00Z",
      },
      reportDiff: {
        changed: true,
        diffText:
          "--- cap-report-bundle-r1.zip:report.md\n+++ cap-report-bundle-r2.zip:report.md\n@@ -1 +1,2 @@\n Existing recon section\n+Privilege escalated through python capability abuse.",
      },
      commands: {
        addedIds: ["cmd-2"],
        removedIds: [],
        unchangedIds: ["cmd-1"],
      },
      graph: {
        addedNodeIds: ["node-2"],
        removedNodeIds: [],
        addedEdgeIds: ["edge-2"],
        removedEdgeIds: [],
      },
      summary: {
        addedCommands: 1,
        removedCommands: 0,
        addedNodes: 1,
        removedNodes: 0,
        addedEdges: 1,
        removedEdges: 0,
        reportChanged: true,
      },
    });
    reportApiMocks.acceptReportProposal.mockResolvedValue({});
    reportApiMocks.rejectReportProposal.mockResolvedValue({});
    reportApiMocks.evaluateProjectReport.mockResolvedValue({
      taskId: "task-1",
      projectId: "project-1",
      triggerType: "manual",
      targetSectionKeys: null,
      status: "queued",
      proposalId: null,
      error: null,
      createdAt: "2026-04-21T20:05:00Z",
      startedAt: null,
      completedAt: null,
    });
    reportApiMocks.evaluateReportSection.mockResolvedValue({
      taskId: "task-section-1",
      projectId: "project-1",
      triggerType: "manual",
      targetSectionKeys: ["privilege_escalation"],
      status: "queued",
      proposalId: null,
      error: null,
      createdAt: "2026-04-21T20:05:00Z",
      startedAt: null,
      completedAt: null,
    });
    reportApiMocks.fetchReportEvaluationTask.mockResolvedValue({
      taskId: "task-1",
      projectId: "project-1",
      triggerType: "manual",
      targetSectionKeys: null,
      status: "completed",
      proposalId: "proposal-1",
      error: null,
      createdAt: "2026-04-21T20:05:00Z",
      startedAt: "2026-04-21T20:05:01Z",
      completedAt: "2026-04-21T20:05:02Z",
    });
    reportApiMocks.seedMockReportDemoCtf.mockResolvedValue({
      projectId: "project-1",
      scenario: "demo-ctf",
      acceptedRevisionCount: 1,
      report: buildReportResponse(),
      pendingProposals: buildProposalListResponse().items,
    });
    reportApiMocks.downloadReportBundle.mockResolvedValue(
      new Blob(["bundle"], { type: "application/zip" }),
    );
    reportApiMocks.downloadReportBundleArtifact.mockResolvedValue(
      new Blob(["stored bundle"], { type: "application/zip" }),
    );
    reportApiMocks.exportReportFolder.mockResolvedValue({
      path: "/tmp/project-1/writeup-export",
      files: {
        reportMd: "/tmp/project-1/writeup-export/report.md",
        attackGraphPng: "/tmp/project-1/writeup-export/attack-graph.png",
        attackGraphSvg: "/tmp/project-1/writeup-export/attack-graph.svg",
      },
      fileCount: 7,
      manifest: {},
    });
    reportApiMocks.syncReportToNotes.mockResolvedValue({
      sourceId: "source-writeup",
      sourceName: "Report Write-up",
      sourcePath: "/tmp/project-1/writeup-notes",
      docId: "doc-writeup",
      docPath: "Write-up.md",
      reportRevision: 1,
      generatedAt: "2026-04-21T20:05:00Z",
      files: {
        reportMd: "/tmp/project-1/writeup-notes/Write-up.md",
        attackGraphPng: "/tmp/project-1/writeup-notes/attack-graph.png",
        attackGraphSvg: "/tmp/project-1/writeup-notes/attack-graph.svg",
      },
      fileCount: 7,
      stats: { added: 2, updated: 0, deleted: 0, errors: [] },
    });
    reportApiMocks.fetchReportNotesSyncStatus.mockResolvedValue(null);
    reportApiMocks.fetchReportNotesSyncDiff.mockResolvedValue({
      changed: true,
      syncedReportRevision: 1,
      currentReportRevision: 2,
      diffText: [
        "--- notes:Write-up.md",
        "+++ report:revision-2",
        "@@ -1,4 +1,5 @@",
        " # HTB Cap",
        " ## Recon",
        "+Fresh report details",
        " Existing context",
        "@@ -8,3 +9,2 @@",
        " ## Privilege Escalation",
        "-Old root note",
        " Existing root context",
      ].join("\n"),
    });
    aiApiMocks.aiApi.listProviders.mockReset();
    aiApiMocks.aiApi.listProviders.mockResolvedValue([
      {
        id: 1,
        user_id: "user-1",
        provider_type: "cli",
        name: "Codex",
        is_enabled: true,
        base_url: null,
        has_api_key: false,
        custom_headers: null,
        timeout_seconds: 30,
        default_model: "gpt-5.4",
        temperature: 0.7,
        max_tokens: 2048,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
        last_health_check: null,
        health_status: "healthy",
        cli_command: "codex",
        cli_args_template: null,
        cli_interactive_args: null,
        cli_env: null,
        working_directory: null,
        parse_mode: "json",
        supports_streaming: true,
        supports_resume: false,
        session_flag: null,
        detected_version: null,
        detected_models: null,
        created_at: "2026-04-21T20:00:00Z",
        updated_at: "2026-04-21T20:00:00Z",
      },
    ]);
  });

  it("renders the current project report and pending proposal review UI", async () => {
    renderPage();

    expect((await screen.findAllByText("Cap")).length).toBeGreaterThan(0);
    expect(screen.getByText("HTB Write-Up")).toBeInTheDocument();
    expect(screen.getByText("Review pending updates")).toBeInTheDocument();
    expect(screen.getByText("1 update waiting for review.")).toBeInTheDocument();
    expect(screen.getByText("Write-up Preview")).toBeInTheDocument();
    expect(screen.getByText("Workflow & Review")).toBeInTheDocument();
    expect(screen.getByText("Previewing selected update")).toBeInTheDocument();
    expect((await screen.findAllByText("Add privilege escalation details")).length).toBeGreaterThan(0);
    const previewPanel = screen.getByTestId("report-preview-panel");
    expect(within(previewPanel).getByText("Existing recon section")).toBeInTheDocument();
    expect(within(previewPanel).getByText("Privilege Escalation")).toBeInTheDocument();
    expect(screen.getByText("Markdown Preview")).toBeInTheDocument();
    expect(screen.getByText("Markdown Source")).toBeInTheDocument();
    expect(
      screen.getAllByText("Escalated to root via python capability abuse.").length,
    ).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/privilege_escalation:proposed/i)).toBeInTheDocument();
    expect(screen.getByText("Command")).toBeInTheDocument();
    expect(screen.getByText("getcap -r / 2>/dev/null")).toBeInTheDocument();
    expect(screen.queryByText("command_history:cmd-1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Accept update/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reject update/i })).toBeInTheDocument();
  });

  it("can switch the main preview between the selected proposal and the current markdown", async () => {
    renderPage();

    const previewPanel = await screen.findByTestId("report-preview-panel");
    expect(
      within(previewPanel).getByText("Escalated to root via python capability abuse."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Current Markdown/i }));

    await waitFor(() =>
      expect(
        within(previewPanel).queryByText("Escalated to root via python capability abuse."),
      ).not.toBeInTheDocument(),
    );
    expect(within(previewPanel).getByText("Existing recon section")).toBeInTheDocument();
  });

  it("includes the attack graph visual in the rendered report markdown preview", async () => {
    renderPage();

    const previewPanel = await screen.findByTestId("report-preview-panel");
    expect(
      await within(previewPanel).findByTestId("report-attack-graph-embed"),
    ).toBeInTheDocument();
    expect(within(previewPanel).getByTestId("report-attack-graph-flow")).toHaveAttribute(
      "data-node-count",
      "4",
    );
  });

  it("does not append a duplicate graph visual when the report already has an attack path embed", async () => {
    reportApiMocks.fetchProjectReport.mockResolvedValue(
      buildReportResponse({
        privilegeEscalationContent: "## Attack Path\n\n1. SSH foothold led to root.",
      }),
    );
    reportApiMocks.fetchReportProposals.mockResolvedValue(buildProposalListResponse(0));

    renderPage();

    const previewPanel = await screen.findByTestId("report-preview-panel");
    await waitFor(() =>
      expect(
        within(previewPanel).getAllByTestId("report-attack-graph-embed"),
      ).toHaveLength(1),
    );
  });

  it("renders clickable evidence links with stable project-local targets", async () => {
    renderPage();

    const evidenceLink = await screen.findByRole("link", {
      name: /Command: getcap -r \/ 2>\/dev\/null/i,
    });

    expect(evidenceLink).toHaveAttribute(
      "href",
      "/projects/project-1/timeline?commandId=cmd-1",
    );
  });

  it("downloads the report bundle from the preview toolbar", async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const createObjectURL = vi.fn(() => "blob:report-bundle");
    const revokeObjectURL = vi.fn();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    try {
      renderPage();

      fireEvent.click(await screen.findByRole("button", { name: /Export Bundle/i }));

      await waitFor(() =>
        expect(reportApiMocks.downloadReportBundle).toHaveBeenCalledWith("project-1"),
      );
      expect(createObjectURL).toHaveBeenCalled();
      expect(anchorClick).toHaveBeenCalled();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:report-bundle");
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
      anchorClick.mockRestore();
    }
  });

  it("shows backend details when bundle export fails", async () => {
    reportApiMocks.downloadReportBundle.mockRejectedValueOnce({
      response: {
        data: {
          detail: "Bundle writer could not include attack-graph.png.",
        },
      },
    });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Export Bundle/i }));

    await waitFor(() =>
      expect(reportApiMocks.downloadReportBundle).toHaveBeenCalledWith("project-1"),
    );
    expect(await screen.findByText("Bundle export failed.")).toBeInTheDocument();
    expect(screen.getByText("Bundle writer could not include attack-graph.png.")).toBeInTheDocument();
  });

  it("exports the current report assets to a workspace write-up folder", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Export Folder/i }));

    await waitFor(() =>
      expect(reportApiMocks.exportReportFolder).toHaveBeenCalledWith("project-1"),
    );
    expect(await screen.findByText("Write-up folder exported.")).toBeInTheDocument();
    expect(screen.getByText("/tmp/project-1/writeup-export")).toBeInTheDocument();
  });

  it("shows backend details when folder export fails", async () => {
    reportApiMocks.exportReportFolder.mockRejectedValueOnce({
      response: {
        data: {
          error: {
            message: "Workspace write-up folder is not writable.",
          },
        },
      },
    });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Export Folder/i }));

    await waitFor(() =>
      expect(reportApiMocks.exportReportFolder).toHaveBeenCalledWith("project-1"),
    );
    expect(await screen.findByText("Folder export failed.")).toBeInTheDocument();
    expect(screen.getByText("Workspace write-up folder is not writable.")).toBeInTheDocument();
  });

  it("syncs the current report write-up into project notes", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Sync to Notes/i }));

    await waitFor(() =>
      expect(reportApiMocks.syncReportToNotes).toHaveBeenCalledWith("project-1"),
    );
    expect(await screen.findByText("Write-up synced to Notes.")).toBeInTheDocument();
    expect(screen.getByText("Notes synced: revision 1")).toBeInTheDocument();
    expect(screen.getByText("Report Write-up / Write-up.md")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Notes/i })).toHaveAttribute(
      "href",
      "/projects/project-1/notes?docId=doc-writeup",
    );
  });

  it("shows backend details when notes sync fails", async () => {
    reportApiMocks.syncReportToNotes.mockRejectedValueOnce({
      response: {
        data: {
          message: "Notes vault source cannot be refreshed.",
        },
      },
    });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Sync to Notes/i }));

    await waitFor(() =>
      expect(reportApiMocks.syncReportToNotes).toHaveBeenCalledWith("project-1"),
    );
    expect(await screen.findByText("Notes sync failed.")).toBeInTheDocument();
    expect(screen.getByText("Notes vault source cannot be refreshed.")).toBeInTheDocument();
  });

  it("restores the existing notes sync link after reloading the reports page", async () => {
    reportApiMocks.fetchReportNotesSyncStatus.mockResolvedValue({
      sourceId: "source-writeup",
      sourceName: "Report Write-up",
      sourcePath: "/tmp/project-1/writeup-notes",
      docId: "doc-writeup",
      docPath: "Write-up.md",
      reportRevision: 1,
      generatedAt: "2026-04-21T20:05:00Z",
      files: {
        reportMd: "/tmp/project-1/writeup-notes/Write-up.md",
        attackGraphPng: "/tmp/project-1/writeup-notes/attack-graph.png",
      },
      fileCount: 7,
      stats: { cached: true, errors: [] },
    });

    renderPage();

    await waitFor(() =>
      expect(reportApiMocks.fetchReportNotesSyncStatus).toHaveBeenCalledWith("project-1"),
    );
    expect(await screen.findByText("Write-up synced to Notes.")).toBeInTheDocument();
    expect(screen.getByText("Notes synced: revision 1")).toBeInTheDocument();
    expect(screen.getByText("Report Write-up / Write-up.md")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Notes/i })).toHaveAttribute(
      "href",
      "/projects/project-1/notes?docId=doc-writeup",
    );
  });

  it("marks the restored notes sync as stale when the report revision moved ahead", async () => {
    const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    reportApiMocks.fetchProjectReport.mockResolvedValue(
      buildReportResponse({ currentRevision: 3 }),
    );
    reportApiMocks.fetchReportNotesSyncStatus.mockResolvedValue({
      sourceId: "source-writeup",
      sourceName: "Report Write-up",
      sourcePath: "/tmp/project-1/writeup-notes",
      docId: "doc-writeup",
      docPath: "Write-up.md",
      reportRevision: 1,
      generatedAt: "2026-04-21T20:05:00Z",
      files: {
        reportMd: "/tmp/project-1/writeup-notes/Write-up.md",
        attackGraphPng: "/tmp/project-1/writeup-notes/attack-graph.png",
      },
      fileCount: 7,
      stats: { cached: true, errors: [] },
    });

    renderPage();

    expect(
      await screen.findByText("Notes stale: revision 1 synced, report is revision 3"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Open diff/i }));

    await waitFor(() =>
      expect(reportApiMocks.fetchReportNotesSyncDiff).toHaveBeenCalledWith("project-1"),
    );
    try {
      expect(await screen.findByText("Notes sync diff")).toBeInTheDocument();
      expect(screen.getByText("Diff summary")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /All \(2\)/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Added \(1\)/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Removed \(1\)/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Sections \(2\)/i })).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Jump to diff hunk: Recon/i }),
      ).toBeInTheDocument();
      expect(screen.getByText("Section: Recon")).toBeInTheDocument();
      expect(screen.getByText("Added")).toBeInTheDocument();
      expect(screen.getByText("Removed")).toBeInTheDocument();
      expect(screen.getByText(/Fresh report details/)).toBeInTheDocument();
      expect(screen.getByText(/Old root note/)).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /Added \(1\)/i }));
      expect(screen.getByText(/Fresh report details/)).toBeInTheDocument();
      expect(screen.queryByText(/Old root note/)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /Removed \(1\)/i }));
      expect(screen.queryByText(/Fresh report details/)).not.toBeInTheDocument();
      expect(screen.getByText(/Old root note/)).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /All \(2\)/i }));

      const previewHeading = within(screen.getByTestId("report-preview-panel")).getByRole(
        "heading",
        { level: 2, name: "Recon" },
      );
      vi.useFakeTimers();
      fireEvent.click(
        screen.getByRole("button", { name: /Jump to preview section: Recon/i }),
      );
      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "start",
      });
      expect(previewHeading).toHaveClass("report-preview-section-highlight");

      vi.advanceTimersByTime(1800);
      expect(previewHeading).not.toHaveClass("report-preview-section-highlight");
      vi.useRealTimers();

      fireEvent.click(screen.getByRole("button", { name: /Update Notes/i }));

      await waitFor(() =>
        expect(reportApiMocks.syncReportToNotes).toHaveBeenCalledWith("project-1"),
      );
    } finally {
      vi.useRealTimers();
      Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
        configurable: true,
        value: originalScrollIntoView,
      });
    }
  });

  it("copies the exported write-up folder path from the preview toolbar", async () => {
    const originalClipboard = navigator.clipboard;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    try {
      renderPage();

      fireEvent.click(await screen.findByRole("button", { name: /Export Folder/i }));
      await screen.findByText("Write-up folder exported.");

      fireEvent.click(screen.getByRole("button", { name: /Copy folder path/i }));

      await waitFor(() =>
        expect(writeText).toHaveBeenCalledWith("/tmp/project-1/writeup-export"),
      );
      expect(await screen.findByText("Folder path copied.")).toBeInTheDocument();
    } finally {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: originalClipboard,
      });
    }
  });

  it("shows report artifact history and downloads previous bundles", async () => {
    reportApiMocks.fetchReportBundleArtifacts.mockResolvedValue({
      items: [
        {
          id: "artifact-1",
          projectId: "project-1",
          reportId: "report-1",
          filename: "cap-report-bundle.zip",
          contentType: "application/zip",
          sizeBytes: 2048,
          sha256: "a".repeat(64),
          reportRevision: 1,
          graphNodeCount: 2,
          graphEdgeCount: 1,
          acceptedCommandCount: 1,
          acceptedCommandIds: ["cmd-1"],
          createdAt: "2026-04-21T20:08:00Z",
        },
      ],
      total: 1,
    });
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const createObjectURL = vi.fn(() => "blob:stored-report-bundle");
    const revokeObjectURL = vi.fn();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    try {
      renderPage();

      expect(await screen.findByText("Export History")).toBeInTheDocument();
      expect(reportApiMocks.fetchReportBundleArtifacts).toHaveBeenCalledWith("project-1");
      const artifactHistory = screen.getByTestId("report-artifact-history");
      expect(within(artifactHistory).getByText("Revision 1")).toBeInTheDocument();
      expect(within(artifactHistory).getByText("cap-report-bundle.zip")).toBeInTheDocument();
      expect(within(artifactHistory).getByText("1 command · 2 nodes · 1 edge")).toBeInTheDocument();

      fireEvent.click(within(artifactHistory).getByRole("button", { name: /Download artifact/i }));

      await waitFor(() =>
        expect(reportApiMocks.downloadReportBundleArtifact).toHaveBeenCalledWith(
          "project-1",
          "artifact-1",
        ),
      );
      expect(createObjectURL).toHaveBeenCalled();
      expect(anchorClick).toHaveBeenCalled();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:stored-report-bundle");
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
      anchorClick.mockRestore();
    }
  });

  it("previews an exported bundle attack graph from artifact history", async () => {
    reportApiMocks.fetchReportBundleArtifacts.mockResolvedValue({
      items: [
        {
          id: "artifact-1",
          projectId: "project-1",
          reportId: "report-1",
          filename: "cap-report-bundle.zip",
          contentType: "application/zip",
          sizeBytes: 2048,
          sha256: "a".repeat(64),
          reportRevision: 1,
          graphNodeCount: 2,
          graphEdgeCount: 1,
          acceptedCommandCount: 1,
          acceptedCommandIds: ["cmd-1"],
          createdAt: "2026-04-21T20:08:00Z",
        },
      ],
      total: 1,
    });

    renderPage();

    const artifactHistory = await screen.findByTestId("report-artifact-history");
    fireEvent.click(
      within(artifactHistory).getByRole("button", { name: /Preview graph/i }),
    );

    await waitFor(() =>
      expect(reportApiMocks.fetchReportBundleArtifactGraphSvg).toHaveBeenCalledWith(
        "project-1",
        "artifact-1",
      ),
    );
    const preview = await within(artifactHistory).findByTestId("artifact-graph-preview");
    expect(preview.innerHTML).toContain("<svg");
    expect(preview.innerHTML).toContain("10.129.34.191");
  });

  it("downloads an exported bundle attack graph PNG from artifact history", async () => {
    reportApiMocks.fetchReportBundleArtifacts.mockResolvedValue({
      items: [
        {
          id: "artifact-1",
          projectId: "project-1",
          reportId: "report-1",
          filename: "cap-report-bundle.zip",
          contentType: "application/zip",
          sizeBytes: 2048,
          sha256: "a".repeat(64),
          reportRevision: 1,
          graphNodeCount: 2,
          graphEdgeCount: 1,
          acceptedCommandCount: 1,
          acceptedCommandIds: ["cmd-1"],
          createdAt: "2026-04-21T20:08:00Z",
        },
      ],
      total: 1,
    });
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const createObjectURL = vi.fn(() => "blob:graph-png");
    const revokeObjectURL = vi.fn();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    try {
      renderPage();

      const artifactHistory = await screen.findByTestId("report-artifact-history");
      fireEvent.click(
        within(artifactHistory).getByRole("button", { name: /Download graph PNG/i }),
      );

      await waitFor(() =>
        expect(reportApiMocks.downloadReportBundleArtifactGraphPng).toHaveBeenCalledWith(
          "project-1",
          "artifact-1",
        ),
      );
      expect(createObjectURL).toHaveBeenCalled();
      expect(anchorClick).toHaveBeenCalled();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:graph-png");
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
      anchorClick.mockRestore();
    }
  });

  it("compares an exported report bundle with the previous artifact", async () => {
    reportApiMocks.fetchReportBundleArtifacts.mockResolvedValue({
      items: [
        {
          id: "artifact-2",
          projectId: "project-1",
          reportId: "report-1",
          filename: "cap-report-bundle-r2.zip",
          contentType: "application/zip",
          sizeBytes: 4096,
          sha256: "b".repeat(64),
          reportRevision: 2,
          graphNodeCount: 3,
          graphEdgeCount: 2,
          acceptedCommandCount: 2,
          acceptedCommandIds: ["cmd-1", "cmd-2"],
          createdAt: "2026-04-21T20:12:00Z",
        },
        {
          id: "artifact-1",
          projectId: "project-1",
          reportId: "report-1",
          filename: "cap-report-bundle-r1.zip",
          contentType: "application/zip",
          sizeBytes: 2048,
          sha256: "a".repeat(64),
          reportRevision: 1,
          graphNodeCount: 2,
          graphEdgeCount: 1,
          acceptedCommandCount: 1,
          acceptedCommandIds: ["cmd-1"],
          createdAt: "2026-04-21T20:08:00Z",
        },
      ],
      total: 2,
    });

    renderPage();

    const artifactHistory = await screen.findByTestId("report-artifact-history");
    fireEvent.click(
      within(artifactHistory).getByRole("button", { name: /Compare with previous/i }),
    );

    await waitFor(() =>
      expect(reportApiMocks.compareReportBundleArtifacts).toHaveBeenCalledWith(
        "project-1",
        "artifact-1",
        "artifact-2",
      ),
    );
    expect(await screen.findByText("Export Comparison")).toBeInTheDocument();
    expect(screen.getByText("Revision 1 -> Revision 2")).toBeInTheDocument();
    expect(screen.getByText("+1 command · +1 node · +1 edge")).toBeInTheDocument();
    expect(
      screen.getByText(/Privilege escalated through python capability abuse/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Open added command cmd-2 in history/i }),
    ).toHaveAttribute("href", "/projects/project-1/timeline?commandId=cmd-2");
    const graphOverlayLink = screen.getByRole("link", {
      name: /Open comparison in Attack Graph/i,
    });
    expect(graphOverlayLink).toHaveAttribute(
      "href",
      "/projects/project-1?graphComparison=report-bundle&graphBaseArtifactId=artifact-1&graphTargetArtifactId=artifact-2&graphBaseRevision=1&graphTargetRevision=2&graphAddedNodeIds=node-2&graphAddedEdgeIds=edge-2",
    );
    expect(
      screen.getByRole("link", { name: /Open added graph node node-2/i }),
    ).toHaveAttribute(
      "href",
      "/projects/project-1?graphComparison=report-bundle&graphBaseArtifactId=artifact-1&graphTargetArtifactId=artifact-2&graphBaseRevision=1&graphTargetRevision=2&graphAddedNodeIds=node-2&graphAddedEdgeIds=edge-2&graphNodeId=node-2",
    );
    expect(
      screen.getByRole("link", { name: /Open added graph edge edge-2/i }),
    ).toHaveAttribute(
      "href",
      "/projects/project-1?graphComparison=report-bundle&graphBaseArtifactId=artifact-1&graphTargetArtifactId=artifact-2&graphBaseRevision=1&graphTargetRevision=2&graphAddedNodeIds=node-2&graphAddedEdgeIds=edge-2&graphEdgeId=edge-2",
    );
  });

  it("selects a pending proposal from the proposal query parameter", async () => {
    const [baseProposal] = buildProposalListResponse().items;
    reportApiMocks.fetchReportProposals.mockResolvedValue({
      items: [
        baseProposal,
        {
          ...baseProposal,
          id: "proposal-2",
          summary: "Add foothold details",
          sectionPatches: [
            {
              ...baseProposal.sectionPatches[0],
              id: "patch-2",
              sectionKey: "recon",
              sectionTitle: "Recon",
              summary: "Document initial foothold",
              contentMd: "Added web foothold notes.",
              diffText:
                "--- recon:current\n+++ recon:proposed\n@@ -1 +1 @@\n+Added web foothold notes.",
            },
          ],
        },
      ],
      total: 2,
    });

    renderPage("/reports?proposal=proposal-2");

    const previewPanel = await screen.findByTestId("report-preview-panel");
    await waitFor(() =>
      expect(
        within(previewPanel).getByText("Added web foothold notes."),
      ).toBeInTheDocument(),
    );
    expect(
      within(previewPanel).queryByText(
        "Escalated to root via python capability abuse.",
      ),
    ).not.toBeInTheDocument();
  });

  it("renders a start-state flow when the report has no accepted revision yet", async () => {
    reportApiMocks.fetchProjectReport.mockResolvedValue(
      buildReportResponse({
        profile: "htb_writeup",
        currentRevision: 0,
        reconContent: "",
      }),
    );
    reportApiMocks.fetchReportProposals.mockResolvedValue(buildProposalListResponse(0));

    renderPage();

    expect(await screen.findByText("Start the write-up")).toBeInTheDocument();
    expect(
      screen.getByText("Generate the first draft from project evidence or load a demo flow."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generate First Draft/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Load Demo Flow/i })).toBeInTheDocument();
  });

  it("shows an AI provider onboarding state when report generation is unavailable", async () => {
    reportApiMocks.fetchProjectReport.mockResolvedValue(
      buildReportResponse({
        profile: "htb_writeup",
        currentRevision: 0,
        reconContent: "",
      }),
    );
    reportApiMocks.fetchReportProposals.mockResolvedValue(buildProposalListResponse(0));
    aiApiMocks.aiApi.listProviders.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText("Start the write-up")).toBeInTheDocument();
    expect(
      screen.getByText("No AI provider configured for this account. Add one before generating or updating the write-up."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open AI Settings/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generate First Draft/i })).toBeDisabled();
    for (const button of screen.getAllByRole("button", { name: /Generate update/i })) {
      expect(button).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: /Load Demo Flow/i })).toBeEnabled();
  });

  it("restores the last active project on reports reload", async () => {
    projectStoreState.currentProject = null;
    projectStoreState.fetchProject.mockImplementation(async (projectId: string) => {
      projectStoreState.currentProject = {
        id: projectId,
        name: "Cap",
        variables: {},
      };
      return projectStoreState.currentProject;
    });
    window.localStorage.setItem("pwnpilot:reports:last-project-id", "project-1");

    renderPage();

    await waitFor(() =>
      expect(projectStoreState.fetchProject).toHaveBeenCalledWith("project-1"),
    );
  });

  it("calls accept and reject mutations from the proposal cards", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Accept update/i }));
    await waitFor(() =>
      expect(reportApiMocks.acceptReportProposal).toHaveBeenCalledWith("project-1", "proposal-1"),
    );

    fireEvent.click(await screen.findByRole("button", { name: /Reject update/i }));
    await waitFor(() =>
      expect(reportApiMocks.rejectReportProposal).toHaveBeenCalledWith("project-1", "proposal-1"),
    );
  });

  it("refreshes the report and clears pending proposals after accepting an update", async () => {
    reportApiMocks.fetchProjectReport.mockReset();
    reportApiMocks.fetchReportProposals.mockReset();
    reportApiMocks.fetchProjectReport
      .mockResolvedValueOnce(buildReportResponse())
      .mockResolvedValue(
        buildReportResponse({
          currentRevision: 2,
          privilegeEscalationContent: "Escalated to root via python capability abuse.",
        }),
      );
    reportApiMocks.fetchReportProposals
      .mockResolvedValueOnce(buildProposalListResponse())
      .mockResolvedValue(buildProposalListResponse(0));

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Accept update/i }));

    await waitFor(() =>
      expect(reportApiMocks.acceptReportProposal).toHaveBeenCalledWith("project-1", "proposal-1"),
    );
    await waitFor(() => expect(reportApiMocks.fetchProjectReport.mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() =>
      expect(reportApiMocks.fetchReportProposals.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    expect(await screen.findByText("Revision 2")).toBeInTheDocument();
    expect(screen.getByText("No report proposals pending.")).toBeInTheDocument();
    expect(screen.queryByText("Add privilege escalation details")).not.toBeInTheDocument();
    expect(screen.queryByText(/privilege_escalation:proposed/i)).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("report-preview-panel")).getByText(
        "Escalated to root via python capability abuse.",
      ),
    ).toBeInTheDocument();
  });

  it("auto-syncs accepted report updates to notes when enabled", async () => {
    renderPage();

    const autoSyncToggle = await screen.findByRole("checkbox", {
      name: /Auto-sync Notes/i,
    });
    expect(autoSyncToggle).not.toBeChecked();

    fireEvent.click(autoSyncToggle);
    expect(autoSyncToggle).toBeChecked();
    expect(window.localStorage.getItem("pwnpilot:reports:auto-sync-notes")).toBe(
      "enabled",
    );

    fireEvent.click(await screen.findByRole("button", { name: /Accept update/i }));

    await waitFor(() =>
      expect(reportApiMocks.acceptReportProposal).toHaveBeenCalledWith(
        "project-1",
        "proposal-1",
      ),
    );
    expect(reportApiMocks.syncReportToNotes).not.toHaveBeenCalled();

    await waitFor(
      () => expect(reportApiMocks.syncReportToNotes).toHaveBeenCalledWith("project-1"),
      { timeout: 2000 },
    );
    expect(await screen.findByText("Auto-sync completed.")).toBeInTheDocument();
  });

  it("starts async evaluation, polls task status, and refreshes report data on completion", async () => {
    reportApiMocks.fetchProjectReport.mockReset();
    reportApiMocks.fetchReportProposals.mockReset();
    reportApiMocks.fetchProjectReport
      .mockResolvedValueOnce(buildReportResponse({ currentRevision: 1 }))
      .mockResolvedValue(
        buildReportResponse({
          currentRevision: 1,
          privilegeEscalationContent: "Escalated to root via python capability abuse.",
        }),
      );
    reportApiMocks.fetchReportProposals
      .mockResolvedValueOnce(buildProposalListResponse(0))
      .mockResolvedValue(buildProposalListResponse(1));
    reportApiMocks.fetchReportEvaluationTask
      .mockResolvedValueOnce({
        taskId: "task-1",
        projectId: "project-1",
        triggerType: "manual",
        targetSectionKeys: null,
        status: "running",
        proposalId: null,
        error: null,
        createdAt: "2026-04-21T20:05:00Z",
        startedAt: "2026-04-21T20:05:01Z",
        completedAt: null,
      })
      .mockResolvedValueOnce({
        taskId: "task-1",
        projectId: "project-1",
        triggerType: "manual",
        targetSectionKeys: null,
        status: "completed",
        proposalId: "proposal-1",
        error: null,
        createdAt: "2026-04-21T20:05:00Z",
        startedAt: "2026-04-21T20:05:01Z",
        completedAt: "2026-04-21T20:05:03Z",
      });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Evaluate Now/i }));

    await waitFor(() =>
      expect(reportApiMocks.evaluateProjectReport).toHaveBeenCalledWith("project-1"),
    );
    expect(await screen.findByText("Evaluation queued...")).toBeInTheDocument();
    await waitFor(() =>
      expect(reportApiMocks.fetchReportEvaluationTask).toHaveBeenCalledWith("project-1", "task-1"),
    );
    expect(await screen.findByText("Evaluation complete. Review the new proposal below.")).toBeInTheDocument();
    await waitFor(() =>
      expect(reportApiMocks.fetchProjectReport.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    await waitFor(() =>
      expect(reportApiMocks.fetchReportProposals.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    expect((await screen.findAllByText("Add privilege escalation details")).length).toBeGreaterThan(0);
  });

  it("shows an actionable report evaluation failure message", async () => {
    reportApiMocks.fetchReportProposals.mockResolvedValue(buildProposalListResponse(0));
    reportApiMocks.fetchReportEvaluationTask.mockResolvedValueOnce({
      taskId: "task-1",
      projectId: "project-1",
      triggerType: "manual",
      targetSectionKeys: null,
      status: "failed",
      proposalId: null,
      error: "Gemini provider returned an empty response",
      createdAt: "2026-04-21T20:05:00Z",
      startedAt: "2026-04-21T20:05:01Z",
      completedAt: "2026-04-21T20:05:03Z",
    });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Evaluate Now/i }));

    expect(await screen.findByText("Report evaluation failed")).toBeInTheDocument();
    expect(
      screen.getByText("Gemini provider returned an empty response"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Check the report AI routing and provider health/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Evaluation failed:/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Open AI Settings/i }),
    ).toBeInTheDocument();
  });

  it("auto-syncs completed report evaluations to notes when enabled", async () => {
    reportApiMocks.fetchReportProposals
      .mockResolvedValueOnce(buildProposalListResponse(0))
      .mockResolvedValue(buildProposalListResponse(1));
    reportApiMocks.fetchReportEvaluationTask
      .mockResolvedValueOnce({
        taskId: "task-1",
        projectId: "project-1",
        triggerType: "manual",
        targetSectionKeys: null,
        status: "running",
        proposalId: null,
        error: null,
        createdAt: "2026-04-21T20:05:00Z",
        startedAt: "2026-04-21T20:05:01Z",
        completedAt: null,
      })
      .mockResolvedValueOnce({
        taskId: "task-1",
        projectId: "project-1",
        triggerType: "manual",
        targetSectionKeys: null,
        status: "completed",
        proposalId: "proposal-1",
        error: null,
        createdAt: "2026-04-21T20:05:00Z",
        startedAt: "2026-04-21T20:05:01Z",
        completedAt: "2026-04-21T20:05:03Z",
      });

    renderPage();

    fireEvent.click(
      await screen.findByRole("checkbox", { name: /Auto-sync Notes/i }),
    );
    fireEvent.click(await screen.findByRole("button", { name: /Evaluate Now/i }));

    expect(await screen.findByText("Evaluation complete. Review the new proposal below.")).toBeInTheDocument();
    await waitFor(
      () => expect(reportApiMocks.syncReportToNotes).toHaveBeenCalledWith("project-1"),
      { timeout: 2000 },
    );
    expect(await screen.findByText("Auto-sync completed.")).toBeInTheDocument();
  });

  it("offers section-level generation controls and targets the clicked section", async () => {
    renderPage();

    const sectionsPanel = await screen.findByTestId("report-sections-panel");
    const sectionCards = Array.from(sectionsPanel.querySelectorAll("article"));
    const reconSection = sectionCards.find((article) =>
      within(article).queryByText("Recon"),
    );
    const privescSection = sectionCards.find((article) =>
      within(article).queryByText("Privilege Escalation"),
    );

    expect(reconSection).toBeTruthy();
    expect(privescSection).toBeTruthy();

    expect(
      within(reconSection as HTMLElement).getByRole("button", { name: /Regenerate section/i }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(privescSection as HTMLElement).getByRole("button", { name: /Generate update/i }),
    );

    await waitFor(() =>
      expect(reportApiMocks.evaluateReportSection).toHaveBeenCalledWith(
        "project-1",
        "privilege_escalation",
      ),
    );
  });

  it("can seed a deterministic demo report from the page", async () => {
    reportApiMocks.fetchProjectReport.mockReset();
    reportApiMocks.fetchReportProposals.mockReset();
    reportApiMocks.fetchProjectReport
      .mockResolvedValueOnce(
        buildReportResponse({
          profile: "htb_writeup",
          currentRevision: 0,
          reconContent: "",
        }),
      )
      .mockResolvedValue(
        buildReportResponse({
          profile: "htb_writeup",
          currentRevision: 1,
          privilegeEscalationContent: "Seeded privesc section",
        }),
      );
    reportApiMocks.fetchReportProposals
      .mockResolvedValueOnce(buildProposalListResponse(0))
      .mockResolvedValue(buildProposalListResponse(1));

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Load Demo Flow/i }));

    await waitFor(() =>
      expect(reportApiMocks.seedMockReportDemoCtf).toHaveBeenCalledWith("project-1"),
    );
    await waitFor(() =>
      expect(reportApiMocks.fetchProjectReport.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    await waitFor(() =>
      expect(reportApiMocks.fetchReportProposals.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    expect(await screen.findByText("Revision 1")).toBeInTheDocument();
    expect(screen.getByText("Seeded privesc section")).toBeInTheDocument();
    expect(screen.getAllByText("Add privilege escalation details").length).toBeGreaterThan(0);
  });
});
