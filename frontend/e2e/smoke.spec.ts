import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { seedProjectAIMemory } from "./utils/ai";
import {
  buildOperatorCredentials,
  loginAsOperator,
  loginOperatorViaApi,
  signupAsNewOperator,
  signupOperatorViaApi,
} from "./utils/auth";
import {
  approvePendingCollaborator,
  denyPendingCollaborator,
  expectProjectAccessDenied,
  expectProjectAccessRequest,
  inviteCollaborator,
  openProjectTeamSettings,
  requestProjectAccess,
} from "./utils/collaboration";
import {
  batchDeleteProjectCommands,
  createProjectCommand,
  deleteProjectCommand,
  expectSeededAIComposerPrompt,
  handoffCommandSearchToAI,
  openProjectCommandSettings,
  openProjectCommandsTab,
  runFirstProjectCommand,
  updateProjectCommand,
} from "./utils/commands";
import { addDocsVault, openArchitectureFromKnowledgeBase } from "./utils/kb";
import { createProjectFromDashboard } from "./utils/projects";
import {
  expectTerminalTabActive,
  expectTerminalTranscriptPrompt,
  handoffTerminalTranscriptToAI,
  waitForProjectTerminal,
} from "./utils/terminal";
import {
  expectTimelineLinkedKnowledge,
  handoffTimelineEntryToAI,
  linkTimelineEntryToKnowledge,
  seedDenseTimelineFeed,
  seedCommandHistoryEntry,
  seedTimelineEntry,
} from "./utils/timeline";
import {
  createPromptTemplate,
  deletePromptTemplate,
  enableProjectAIChat,
  insertPromptTemplate,
} from "./utils/prompts";
import { smokeBackendUrl, uniqueSmokeSuffix } from "./utils/runtime";

test("auth screen is visible on first load", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /sign in/i })
  ).toBeVisible();
});

test("signup and dashboard bootstrap stay authenticated after reload", async ({
  page,
}) => {
  await signupAsNewOperator(page);

  await expect(
    page.getByRole("heading", { name: /projects dashboard/i })
  ).toBeVisible();

  await page.reload();

  await expect(
    page.getByRole("heading", { name: /projects dashboard/i })
  ).toBeVisible();
});

test("create project navigates into the project workspace", async ({
  page,
}) => {
  await signupAsNewOperator(page);

  const projectName = await createProjectFromDashboard(page);

  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  await expect(page.getByRole("tab", { name: /terminal/i })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /project settings/i })
  ).toBeVisible();
  await expect(page.getByText(projectName)).toBeVisible();
});

test("project admin can invite another operator and share project access", async ({
  browser,
  page,
}) => {
  await signupAsNewOperator(page);

  const inviteeContext = await browser.newContext();
  const inviteePage = await inviteeContext.newPage();

  try {
    const invitee = await signupAsNewOperator(inviteePage);
    const projectName = await createProjectFromDashboard(page);

    await openProjectTeamSettings(page);
    await inviteCollaborator(page, invitee.username);
    await expect(
      page.getByText(invitee.username, { exact: true })
    ).toBeVisible();

    await inviteePage.reload();
    await expect(
      inviteePage.getByRole("heading", { name: /projects dashboard/i })
    ).toBeVisible();
    await expect(inviteePage.getByText(projectName)).toBeVisible();
  } finally {
    await inviteeContext.close();
  }
});

test("project outsider can request access and gain visibility after approval", async ({
  browser,
  page,
  request,
}) => {
  const admin = buildOperatorCredentials("admin");
  const outsider = buildOperatorCredentials("outsider");

  await signupOperatorViaApi(request, admin);
  await signupOperatorViaApi(request, outsider);
  const adminToken = await loginOperatorViaApi(request, admin);

  const createProject = await request.post(`${smokeBackendUrl}/api/v1/projects`, {
    data: {
      name: `Smoke Ops ${uniqueSmokeSuffix()}`,
      type: "htb",
    },
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  });
  expect(createProject.ok()).toBeTruthy();
  const project = await createProject.json();
  const projectUrl = `/projects/${project.id}`;

  const outsiderContext = await browser.newContext();
  const outsiderPage = await outsiderContext.newPage();

  try {
    await loginAsOperator(page, admin);
    await page.goto(projectUrl);
    await loginAsOperator(outsiderPage, outsider);

    await outsiderPage.goto(projectUrl);
    await expectProjectAccessRequest(outsiderPage);
    await requestProjectAccess(outsiderPage);

    await openProjectTeamSettings(page);
    await approvePendingCollaborator(page, outsider.username);

    await outsiderPage.reload();
    await expect(outsiderPage).toHaveURL(/\/projects\/[^/]+$/);
    await expect(outsiderPage.getByText(project.name)).toBeVisible();
    await expect(
      outsiderPage.getByRole("tab", { name: /terminal/i })
    ).toBeVisible();
  } finally {
    await outsiderContext.close();
  }
});

test("project outsider sees the denied state after an admin rejects the request", async ({
  browser,
  page,
  request,
}) => {
  const admin = buildOperatorCredentials("admin");
  const outsider = buildOperatorCredentials("outsider");

  await signupOperatorViaApi(request, admin);
  await signupOperatorViaApi(request, outsider);
  const adminToken = await loginOperatorViaApi(request, admin);

  const createProject = await request.post(`${smokeBackendUrl}/api/v1/projects`, {
    data: {
      name: `Smoke Ops ${uniqueSmokeSuffix()}`,
      type: "htb",
    },
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  });
  expect(createProject.ok()).toBeTruthy();
  const project = await createProject.json();
  const projectUrl = `/projects/${project.id}`;

  const outsiderContext = await browser.newContext();
  const outsiderPage = await outsiderContext.newPage();

  try {
    await loginAsOperator(page, admin);
    await page.goto(projectUrl);
    await loginAsOperator(outsiderPage, outsider);

    await outsiderPage.goto(projectUrl);
    await expectProjectAccessRequest(outsiderPage);
    await requestProjectAccess(outsiderPage);

    await openProjectTeamSettings(page);
    await denyPendingCollaborator(page, outsider.username);

    await outsiderPage.reload();
    await expectProjectAccessDenied(outsiderPage);
  } finally {
    await outsiderContext.close();
  }
});

test("knowledge base can ingest repo docs and open architecture note", async ({
  page,
}) => {
  await signupAsNewOperator(page);
  await createProjectFromDashboard(page);

  await addDocsVault(page);
  await openArchitectureFromKnowledgeBase(page);
});

test("attack graph v2 seeds a realistic ctf workspace and surfaces data across the project", async ({
  page,
}) => {
  await signupAsNewOperator(page);
  await createProjectFromDashboard(page);

  await page.getByRole("button", { name: /expand attack graph/i }).click();
  await expect(page.getByText(/seed a realistic ctf workspace/i)).toBeVisible();
  await page
    .getByRole("button", { name: /seed realistic ctf workspace/i })
    .click();

  await expect(
    page.getByRole("button", { name: /graph node web01/i })
  ).toBeVisible();
  await expect(
    page.getByText(/Full CTF path from recon to root on WEB01/i)
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^graph node svc_backup$/i })
  ).toBeVisible();

  const projectId =
    page.url().match(/\/projects\/([^/]+)$/)?.[1] ??
    (() => {
      throw new Error(`Unable to resolve project id from URL: ${page.url()}`);
    })();

  const timelineEntries = await page.evaluate(
    async ({ backendUrl, currentProjectId }) => {
      const token = window.localStorage.getItem("pwnpilot_access_token");
      if (!token) {
        throw new Error("Smoke auth token missing from localStorage");
      }

      const response = await fetch(
        `${backendUrl}/api/v1/projects/${currentProjectId}/timeline`,
        {
          method: "GET",
          credentials: "include",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(
          `Failed to fetch timeline: ${response.status} ${await response.text()}`
        );
      }

      return response.json();
    },
    { backendUrl: smokeBackendUrl, currentProjectId: projectId }
  );

  expect(
    timelineEntries.some((entry: { content?: string }) =>
      (entry.content ?? "").includes("Jenkins script console exposed on WEB01")
    )
  ).toBeTruthy();

  const commandEntries = await page.evaluate(
    async ({ backendUrl, currentProjectId }) => {
      const token = window.localStorage.getItem("pwnpilot_access_token");
      if (!token) {
        throw new Error("Smoke auth token missing from localStorage");
      }

      const response = await fetch(
        `${backendUrl}/api/v1/projects/${currentProjectId}/commands/history?limit=100&include_output=true`,
        {
          method: "GET",
          credentials: "include",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(
          `Failed to fetch command history: ${response.status} ${await response.text()}`
        );
      }

      return response.json();
    },
    { backendUrl: smokeBackendUrl, currentProjectId: projectId }
  );

  expect(
    (commandEntries.items ?? []).some((entry: { command?: string }) =>
      (entry.command ?? "").includes("nmap -sV -Pn 10.10.110.10")
    )
  ).toBeTruthy();

  await page.getByRole("tab", { name: /^notes$/i }).click();
  const searchbox = page.getByRole("searchbox", {
    name: /search knowledge base/i,
  });
  await expect(searchbox).toBeVisible();
  await searchbox.fill("Jenkins");
  await expect(page.getByText(/Jenkins script console RCE/i)).toBeVisible();
});

test("attack graph v2 path finder is available after seeding", async ({
  page,
}) => {
  await signupAsNewOperator(page);
  await createProjectFromDashboard(page);

  await page.getByRole("button", { name: /expand attack graph/i }).click();
  await page
    .getByRole("button", { name: /seed realistic ctf workspace/i })
    .click();

  await expect(
    page.getByRole("button", { name: /graph node root@WEB01/i })
  ).toBeVisible();

  await page.getByLabel("Path from").selectOption("www-data@WEB01");
  await page.getByLabel("Path to").selectOption("root.txt");
  await expect(
    page.getByRole("button", { name: /highlight shortest path/i })
  ).toBeEnabled();
  await page.getByRole("button", { name: /highlight shortest path/i }).click();
});

test("attack graph report evidence opens the linked report proposal", async ({
  page,
  request,
}) => {
  await signupAsNewOperator(page);
  await createProjectFromDashboard(page);

  await page.getByRole("button", { name: /expand attack graph/i }).click();
  await page
    .getByRole("button", { name: /seed realistic ctf workspace/i })
    .click();
  await expect(
    page.getByRole("button", { name: /graph node web01/i })
  ).toBeVisible();

  const projectId =
    page.url().match(/\/projects\/([^/]+)$/)?.[1] ??
    (() => {
      throw new Error(`Unable to resolve project id from URL: ${page.url()}`);
    })();
  const token = await page.evaluate(() =>
    window.localStorage.getItem("pwnpilot_access_token")
  );
  if (!token) {
    throw new Error("Smoke auth token missing from localStorage");
  }

  const graphResponse = await request.get(
    `${smokeBackendUrl}/api/v1/projects/${projectId}/graph`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  expect(graphResponse.ok()).toBeTruthy();
  const graph = await graphResponse.json();
  const webNode = (graph.nodes ?? []).find(
    (node: {
      id?: string;
      label?: string;
      source_step_ids?: string[];
      sourceStepIds?: string[];
    }) =>
      node.id?.endsWith("host-web01") || node.label === "WEB01"
  );
  const commandId = webNode?.source_step_ids?.[0] ?? webNode?.sourceStepIds?.[0];
  if (!commandId) {
    throw new Error("Seeded WEB01 node does not expose command evidence");
  }

  const proposalResponse = await request.post(
    `${smokeBackendUrl}/api/v1/projects/${projectId}/report/proposals`,
    {
      data: {
        section_key: "recon",
        content_md:
          "Smoke e2e: WEB01 nmap evidence is already linked from the attack graph.",
        summary: "Smoke linked graph evidence",
        trigger_type: "graph_evidence",
        evidence: [
          {
            source_type: "command_history",
            source_id: commandId,
          },
        ],
      },
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  expect(proposalResponse.ok()).toBeTruthy();
  const proposalBody = await proposalResponse.json();
  const proposalId = proposalBody.proposal?.id;
  if (!proposalId) {
    throw new Error("Report proposal creation did not return an id");
  }

  await page.reload();
  const expandAttackGraphButton = page.getByRole("button", {
    name: /expand attack graph/i,
  });
  await expect(expandAttackGraphButton).toBeVisible();
  await expandAttackGraphButton.click();
  await page
    .getByTestId("attack-graph")
    .getByRole("button", { name: /search/i })
    .click();
  await page.getByPlaceholder(/search nodes by label/i).fill("WEB01");
  await page.getByRole("option", { name: /WEB01/i }).first().click();

  const alreadyButton = page.getByRole("button", {
    name: new RegExp(
      `open report proposal ${proposalId} for command ${commandId} evidence`,
      "i"
    ),
  });
  await expect(alreadyButton).toHaveText(/already/i);
  await alreadyButton.click();

  await expect(page).toHaveURL(
    new RegExp(`/projects/${projectId}/reports\\?proposal=${proposalId}`)
  );
  await expect(
    page
      .getByTestId("report-preview-panel")
      .getByText(/Smoke e2e: WEB01 nmap evidence is already linked/i)
  ).toBeVisible();
});

test("report lifecycle accepts graph evidence into the final write-up", async ({
  page,
  request,
}) => {
  await signupAsNewOperator(page);
  await createProjectFromDashboard(page, { type: "htb" });

  await page.getByRole("button", { name: /expand attack graph/i }).click();
  await page
    .getByRole("button", { name: /seed realistic ctf workspace/i })
    .click();
  await expect(
    page.getByRole("button", { name: /graph node web01/i })
  ).toBeVisible();

  const projectId =
    page.url().match(/\/projects\/([^/]+)$/)?.[1] ??
    (() => {
      throw new Error(`Unable to resolve project id from URL: ${page.url()}`);
    })();
  const token = await page.evaluate(() =>
    window.localStorage.getItem("pwnpilot_access_token")
  );
  if (!token) {
    throw new Error("Smoke auth token missing from localStorage");
  }

  const graphResponse = await request.get(
    `${smokeBackendUrl}/api/v1/projects/${projectId}/graph`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  expect(graphResponse.ok()).toBeTruthy();
  const graph = await graphResponse.json();
  const webNode = (graph.nodes ?? []).find(
    (node: {
      id?: string;
      label?: string;
      source_step_ids?: string[];
      sourceStepIds?: string[];
    }) =>
      node.id?.endsWith("host-web01") || node.label === "WEB01"
  );
  const commandId = webNode?.source_step_ids?.[0] ?? webNode?.sourceStepIds?.[0];
  if (!commandId) {
    throw new Error("Seeded WEB01 node does not expose command evidence");
  }

  const commandResponse = await request.get(
    `${smokeBackendUrl}/api/v1/projects/${projectId}/commands/history/${commandId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  expect(commandResponse.ok()).toBeTruthy();
  const commandDetail = await commandResponse.json();
  const commandText = String(commandDetail.command ?? "");
  if (!commandText) {
    throw new Error(`Command ${commandId} did not return command text`);
  }

  const acceptedContent = [
    "Lifecycle accepted attack path: WEB01 is the anchor node for the report.",
    `Command history anchor: \`${commandText}\`.`,
    "The rendered write-up must keep this text, the visual attack graph, and the linked evidence together after acceptance.",
  ].join("\n\n");
  const proposalResponse = await request.post(
    `${smokeBackendUrl}/api/v1/projects/${projectId}/report/proposals`,
    {
      data: {
        section_key: "attack_path",
        content_md: acceptedContent,
        summary: "Accept graph-backed attack path",
        trigger_type: "graph_evidence",
        evidence: [
          {
            source_type: "command_history",
            source_id: commandId,
          },
        ],
      },
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  expect(proposalResponse.ok()).toBeTruthy();
  const proposalBody = await proposalResponse.json();
  const proposalId = proposalBody.proposal?.id;
  if (!proposalId) {
    throw new Error("Report proposal creation did not return an id");
  }

  await page.goto(`/projects/${projectId}/reports?proposal=${proposalId}`);
  const previewPanel = page.getByTestId("report-preview-panel");
  await expect(
    previewPanel.getByRole("heading", { name: /attack path/i, level: 2 })
  ).toBeVisible();
  await expect(
    previewPanel.getByText(/Lifecycle accepted attack path/i)
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Command: .*nmap/i })
  ).toBeVisible();
  await expect(
    previewPanel.getByTestId("report-attack-graph-embed")
  ).toBeVisible();

  await page.getByRole("button", { name: /accept update/i }).click();

  await expect(page.getByText(/No report proposals pending/i)).toBeVisible();
  await expect(page.getByText(/Revision 1/i)).toBeVisible();
  await expect(
    previewPanel.getByText(/Lifecycle accepted attack path/i)
  ).toBeVisible();
  await expect(
    previewPanel.getByText(commandText, { exact: false }).first()
  ).toBeVisible();
  const graphEmbed = previewPanel.getByTestId("report-attack-graph-embed");
  await expect(graphEmbed).toBeVisible();
  await expect(
    graphEmbed.getByText(/nodes, .*edges rendered from the live project graph/i)
  ).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /export bundle/i }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/report-bundle\.zip$/);
  const artifactHistory = page.getByTestId("report-artifact-history");
  await expect(artifactHistory.getByText(/1 bundle/i)).toBeVisible();
  await expect(
    artifactHistory.getByRole("button", { name: /download artifact/i })
  ).toBeVisible();

  const deltaSessionResponse = await request.post(
    `${smokeBackendUrl}/api/v1/terminal/sessions`,
    {
      data: {
        name: "Smoke Report Delta Session",
        project_id: projectId,
        cols: 120,
        rows: 30,
      },
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  expect(deltaSessionResponse.ok()).toBeTruthy();
  const deltaSession = await deltaSessionResponse.json();
  const deltaCommandResponse = await request.post(
    `${smokeBackendUrl}/api/v1/terminal/sessions/${deltaSession.id}/commands`,
    {
      data: {
        command: "printf report-export-delta",
        output: "report-export-delta",
        exit_code: 0,
        cwd: "/tmp",
        duration_ms: 250,
      },
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  expect(deltaCommandResponse.ok()).toBeTruthy();
  const deltaCommand = await deltaCommandResponse.json();
  const deltaCommandId = deltaCommand.id;
  if (!deltaCommandId) {
    throw new Error("Delta command creation did not return an id");
  }

  const deltaGraphResponse = await request.post(
    `${smokeBackendUrl}/api/v1/projects/${projectId}/graph/batch`,
    {
      data: {
        source_step_id: deltaCommandId,
        nodes: [
          {
            type: "action",
            label: "Report export delta action",
            created_by: "rule",
            source_step_ids: [deltaCommandId],
            tags: ["report", "delta"],
            meta: { command: "printf report-export-delta" },
          },
          {
            type: "finding",
            label: "Report export delta finding",
            created_by: "rule",
            source_step_ids: [deltaCommandId],
            tags: ["report", "delta"],
            meta: { title: "Report export delta finding" },
          },
        ],
        edges: [
          {
            source_ref: "$0",
            target_ref: "$1",
            kind: "related_to",
            source_step_id: deltaCommandId,
            command: "printf report-export-delta",
            tool: "smoke",
          },
        ],
      },
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  expect(deltaGraphResponse.ok()).toBeTruthy();
  const deltaGraph = await deltaGraphResponse.json();
  const deltaNodeId = deltaGraph.created_node_ids?.[0];
  if (!deltaNodeId) {
    throw new Error("Delta graph batch did not create a node");
  }

  const deltaProposalResponse = await request.post(
    `${smokeBackendUrl}/api/v1/projects/${projectId}/report/proposals`,
    {
      data: {
        section_key: "attack_path",
        content_md: [
          "Second export delta: the comparison panel must expose clickable command and graph evidence.",
          `Delta command anchor: \`${deltaCommand.command}\`.`,
        ].join("\n\n"),
        summary: "Add export comparison delta evidence",
        trigger_type: "graph_evidence",
        evidence: [
          {
            source_type: "command_history",
            source_id: deltaCommandId,
          },
          {
            source_type: "graph_node",
            source_id: deltaNodeId,
          },
        ],
      },
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  expect(deltaProposalResponse.ok()).toBeTruthy();
  const deltaProposal = await deltaProposalResponse.json();
  const deltaProposalId = deltaProposal.proposal?.id;
  if (!deltaProposalId) {
    throw new Error("Delta report proposal creation did not return an id");
  }

  const acceptDeltaResponse = await request.post(
    `${smokeBackendUrl}/api/v1/projects/${projectId}/report/proposals/${deltaProposalId}/accept`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  expect(acceptDeltaResponse.ok()).toBeTruthy();

  const secondDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /export bundle/i }).click();
  await secondDownloadPromise;
  await expect(artifactHistory.getByText(/2 bundles/i)).toBeVisible();
  await artifactHistory
    .getByRole("button", { name: /compare with previous/i })
    .first()
    .click();
  await expect(artifactHistory.getByText(/Export Comparison/i)).toBeVisible();
  await expect(artifactHistory.getByText(/Revision 1 -> Revision 2/i)).toBeVisible();
  await expect(
    artifactHistory.getByText(/\+1 command · \+2 nodes · \+1 edge/i)
  ).toBeVisible();
  await expect(
    artifactHistory.getByRole("link", { name: /open added command/i }).first()
  ).toHaveAttribute("href", new RegExp(`/projects/${projectId}/timeline\\?commandId=`));
  await artifactHistory
    .getByRole("link", { name: /open added graph node/i })
    .first()
    .click();
  await expect(page).toHaveURL(
    new RegExp(
      `/projects/${projectId}\\?graphComparison=report-bundle&.*graphNodeId=`
    )
  );
  await expect(page.getByTestId("attack-graph")).toBeVisible();
  await expect(page.getByText("Report Bundle Comparison")).toBeVisible();
});

test("report folder export and notes sync write the current write-up assets from the reports UI", async ({
  page,
  request,
}) => {
  await signupAsNewOperator(page);
  await createProjectFromDashboard(page, { type: "htb" });
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);

  const projectId =
    page.url().match(/\/projects\/([^/]+)$/)?.[1] ??
    (() => {
      throw new Error(`Unable to resolve project id from URL: ${page.url()}`);
    })();
  const token = await page.evaluate(() =>
    window.localStorage.getItem("pwnpilot_access_token")
  );
  if (!token) {
    throw new Error("Smoke auth token missing from localStorage");
  }
  const authHeaders = {
    Authorization: `Bearer ${token}`,
  };

  const sessionResponse = await request.post(
    `${smokeBackendUrl}/api/v1/terminal/sessions`,
    {
      data: {
        name: "Smoke Folder Export Session",
        project_id: projectId,
        cols: 120,
        rows: 30,
      },
      headers: authHeaders,
    }
  );
  expect(sessionResponse.ok()).toBeTruthy();
  const session = await sessionResponse.json();
  const commandText = "getcap -r / 2>/dev/null";
  const commandOutput = "/usr/bin/python3.8 = cap_setuid+ep";
  const commandResponse = await request.post(
    `${smokeBackendUrl}/api/v1/terminal/sessions/${session.id}/commands`,
    {
      data: {
        command: commandText,
        output: commandOutput,
        exit_code: 0,
        cwd: "/tmp",
        duration_ms: 210,
      },
      headers: authHeaders,
    }
  );
  expect(commandResponse.ok()).toBeTruthy();
  const command = await commandResponse.json();
  const commandId = command.id;
  if (!commandId) {
    throw new Error("Folder export command creation did not return an id");
  }

  const graphResponse = await request.post(
    `${smokeBackendUrl}/api/v1/projects/${projectId}/graph/batch`,
    {
      data: {
        source_step_id: commandId,
        nodes: [
          {
            type: "finding",
            label: "python3.8 cap_setuid",
            created_by: "rule",
            source_step_ids: [commandId],
            tags: ["report", "folder-export"],
            meta: { capability: "cap_setuid+ep" },
          },
        ],
        edges: [],
      },
      headers: authHeaders,
    }
  );
  expect(graphResponse.ok()).toBeTruthy();

  const acceptedContent = [
    "Folder export accepted path: python capability abuse reaches root.",
    `Folder export command anchor: \`${commandText}\`.`,
  ].join("\n\n");
  const proposalResponse = await request.post(
    `${smokeBackendUrl}/api/v1/projects/${projectId}/report/proposals`,
    {
      data: {
        section_key: "privilege_escalation",
        content_md: acceptedContent,
        summary: "Accept folder export evidence",
        trigger_type: "graph_evidence",
        evidence: [
          {
            source_type: "command_history",
            source_id: commandId,
          },
        ],
      },
      headers: authHeaders,
    }
  );
  expect(proposalResponse.ok()).toBeTruthy();
  const proposal = await proposalResponse.json();
  const proposalId = proposal.proposal?.id;
  if (!proposalId) {
    throw new Error("Folder export report proposal creation did not return an id");
  }

  const acceptResponse = await request.post(
    `${smokeBackendUrl}/api/v1/projects/${projectId}/report/proposals/${proposalId}/accept`,
    { headers: authHeaders }
  );
  expect(acceptResponse.ok()).toBeTruthy();

  await page.goto(`/projects/${projectId}/reports`);
  await expect(page.getByText(/Revision 1/i)).toBeVisible();
  await expect(
    page.getByTestId("report-preview-panel").getByText(/Folder export accepted path/i)
  ).toBeVisible();

  const exportResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/v1/projects/${projectId}/report/folder-export`) &&
      response.request().method() === "POST"
  );
  await page.getByRole("button", { name: /export folder/i }).click();
  const exportResponse = await exportResponsePromise;
  expect(exportResponse.ok()).toBeTruthy();
  const exportPayload = await exportResponse.json();

  await expect(page.getByText("Write-up folder exported.")).toBeVisible();
  await expect(page.getByText(exportPayload.path)).toBeVisible();

  expect(exportPayload.file_count).toBe(7);
  const reportMarkdown = await readFile(exportPayload.files.report_md, "utf8");
  const commandAppendix = await readFile(
    exportPayload.files.accepted_evidence_commands_md,
    "utf8"
  );
  const graphJson = JSON.parse(
    await readFile(exportPayload.files.attack_graph_json, "utf8")
  );
  const graphSvg = await readFile(exportPayload.files.attack_graph_svg, "utf8");
  const graphPng = await readFile(exportPayload.files.attack_graph_png);

  expect(reportMarkdown).toContain("Folder export accepted path");
  expect(reportMarkdown).toContain("![Attack Graph](attack-graph.png)");
  expect(commandAppendix).toContain(commandText);
  expect(commandAppendix).toContain(commandOutput);
  expect(
    graphJson.nodes.some(
      (node: { label?: string }) => node.label === "python3.8 cap_setuid"
    )
  ).toBeTruthy();
  expect(graphSvg).toContain("python3.8 cap_setuid");
  expect(graphPng.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");

  const notesSyncResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/v1/projects/${projectId}/report/notes-sync`) &&
      response.request().method() === "POST"
  );
  await page.getByRole("button", { name: /sync to notes/i }).click();
  const notesSyncResponse = await notesSyncResponsePromise;
  expect(notesSyncResponse.ok()).toBeTruthy();
  const notesSyncPayload = await notesSyncResponse.json();

  await expect(page.getByText("Write-up synced to Notes.")).toBeVisible();
  await expect(
    page.getByText(`${notesSyncPayload.source_name} / ${notesSyncPayload.doc_path}`)
  ).toBeVisible();

  expect(notesSyncPayload.source_name).toBe("Report Write-up");
  expect(notesSyncPayload.doc_path).toBe("Write-up.md");
  expect(notesSyncPayload.report_revision).toBe(1);
  expect(notesSyncPayload.file_count).toBe(7);
  const notesMarkdown = await readFile(notesSyncPayload.files.report_md, "utf8");
  const notesCommandAppendix = await readFile(
    notesSyncPayload.files.accepted_evidence_commands_md,
    "utf8"
  );
  const notesGraphPng = await readFile(notesSyncPayload.files.attack_graph_png);

  expect(notesMarkdown).toContain("title: Write-up");
  expect(notesMarkdown).toContain("Folder export accepted path");
  expect(notesMarkdown).toContain("![Attack Graph](attack-graph.png)");
  expect(notesCommandAppendix).toContain(commandText);
  expect(notesGraphPng.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");

  await page.reload();
  await expect(page.getByText("Write-up synced to Notes.")).toBeVisible();
  await expect(
    page.getByText(`Notes synced: revision ${notesSyncPayload.report_revision}`)
  ).toBeVisible();
  await expect(
    page.getByText(`${notesSyncPayload.source_name} / ${notesSyncPayload.doc_path}`)
  ).toBeVisible();

  await page.getByRole("link", { name: /open notes/i }).click();
  await expect(page).toHaveURL(
    new RegExp(`/projects/${projectId}/notes\\?docId=${notesSyncPayload.doc_id}`)
  );
  await expect(page.getByText("Report Write-up")).toBeVisible();

  const artifactsResponse = await request.get(
    `${smokeBackendUrl}/api/v1/projects/${projectId}/report/bundle/artifacts`,
    { headers: authHeaders }
  );
  expect(artifactsResponse.ok()).toBeTruthy();
  const artifacts = await artifactsResponse.json();
  expect(artifacts.total).toBe(0);
});

test("command library can hand off a seeded prompt to project ai", async ({
  page,
}) => {
  await signupAsNewOperator(page);
  await createProjectFromDashboard(page);

  await openProjectCommandsTab(page);
  await handoffCommandSearchToAI(page, "enumerate smb shares");
  await expectSeededAIComposerPrompt(page, /enumerate smb shares/i);
});

test("command library can launch a command into the project terminal", async ({
  page,
}) => {
  await signupAsNewOperator(page);
  await createProjectFromDashboard(page);

  await openProjectCommandsTab(page);
  await runFirstProjectCommand(page);

  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  await expectTerminalTabActive(page);
  await waitForProjectTerminal(page);
});

test("project command settings can create update and delete a custom command", async ({
  page,
}) => {
  await signupAsNewOperator(page);
  await createProjectFromDashboard(page);

  const commandName = `Smoke HTTP Probe ${uniqueSmokeSuffix()}`;

  await openProjectCommandSettings(page);
  await createProjectCommand(page, {
    name: commandName,
    category: "Recon",
    command: "curl -I http://$target_ip",
    description: "Initial HTTP smoke probe",
    tags: ["http", "smoke"],
  });
  await updateProjectCommand(page, commandName, {
    command: "curl -skI https://$target_ip",
    description: "Updated HTTPS smoke probe",
    tags: ["http", "tls"],
  });
  await deleteProjectCommand(page, commandName);

  await page.getByRole("button", { name: /back to project/i }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
});

test("project command library can batch delete custom commands", async ({
  page,
}) => {
  await signupAsNewOperator(page);
  await createProjectFromDashboard(page);

  const commandOne = `Smoke Batch One ${uniqueSmokeSuffix()}`;
  const commandTwo = `Smoke Batch Two ${uniqueSmokeSuffix()}`;

  await openProjectCommandSettings(page);
  await createProjectCommand(page, {
    name: commandOne,
    category: "Recon",
    command: "curl -I http://$target_ip",
    description: "First batch-delete smoke command",
    tags: ["batch", "one"],
  });
  await createProjectCommand(page, {
    name: commandTwo,
    category: "Recon",
    command: "curl -skI https://$target_ip",
    description: "Second batch-delete smoke command",
    tags: ["batch", "two"],
  });

  await page.getByRole("button", { name: /back to project/i }).click();
  await batchDeleteProjectCommands(page, [commandOne, commandTwo]);
});

test("terminal can hand off transcript to project ai", async ({ page }) => {
  await signupAsNewOperator(page);
  await createProjectFromDashboard(page);

  await handoffTerminalTranscriptToAI(page);
  await expectTerminalTranscriptPrompt(page);
});

test("timeline can hand off context to project ai", async ({ page }) => {
  await signupAsNewOperator(page);
  await createProjectFromDashboard(page);

  const timelineContent = "Captured exposed Grafana login page";
  const timelineOutput = "HTTP 200 on /login";

  await seedTimelineEntry(page, {
    type: "note",
    content: timelineContent,
    output: timelineOutput,
  });
  await handoffTimelineEntryToAI(page, timelineContent);
  await expectSeededAIComposerPrompt(page, /captured exposed grafana login page/i);
  await expectSeededAIComposerPrompt(page, /http 200 on \/login/i);
});

test("timeline note can derive an engagement graph node", async ({ page }) => {
  await signupAsNewOperator(page);
  await createProjectFromDashboard(page);

  const findingContent = "SeImpersonatePrivilege identified on the Windows target";
  await seedTimelineEntry(page, {
    type: "finding",
    content: findingContent,
    output: "PrintSpoofer likely lands SYSTEM",
  });

  await page.reload();
  await expect(page.getByRole("tab", { name: /^terminal$/i })).toBeVisible();

  const expandAttackGraphButton = page.getByRole("button", {
    name: /expand attack graph/i,
  });
  if (await expandAttackGraphButton.isVisible().catch(() => false)) {
    await expandAttackGraphButton.click();
  }

  await expect(
    page.getByRole("button", {
      name: /graph node seimpersonateprivilege identified on the windows target/i,
    })
  ).toBeVisible();
  await expect(page.getByText(/^Timeline finding$/).first()).toBeVisible();
});

test("ai memory can derive an engagement graph node", async ({ page }) => {
  await signupAsNewOperator(page);
  await createProjectFromDashboard(page);

  const memoryValue =
    "AI memory: T1068 likely applies on this host after the current foothold.";

  await seedProjectAIMemory(page, {
    key: "windows_privesc_path",
    value: memoryValue,
  });

  await page.reload();
  await expect(page.getByRole("tab", { name: /^terminal$/i })).toBeVisible();

  const expandAttackGraphButton = page.getByRole("button", {
    name: /expand attack graph/i,
  });
  if (await expandAttackGraphButton.isVisible().catch(() => false)) {
    await expandAttackGraphButton.click();
  }

  const memoryGraphNode = page.getByRole("button", {
    name: /graph node ai memory: t1068 likely applies on this host after the current foothold\./i,
  });
  await expect(memoryGraphNode).toBeVisible();
  await expect(memoryGraphNode).toContainText(/ai memory/i);
  await expect(memoryGraphNode).toContainText(/mitre t1068/i);
});

test("timeline entry can link to a knowledge base article", async ({
  page,
}) => {
  await signupAsNewOperator(page);
  await createProjectFromDashboard(page);
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  const projectUrl = page.url();

  await addDocsVault(page);
  await page.goto(projectUrl);

  const timelineContent = "Mapped exposed SMB shares on target";

  await seedTimelineEntry(page, {
    type: "note",
    content: timelineContent,
    output: "Anonymous share listing enabled",
  });

  await linkTimelineEntryToKnowledge(page, timelineContent, "architecture");
  await expectTimelineLinkedKnowledge(page, timelineContent, /architecture/i);
});

test("timeline search and filters work across mixed timeline and command activity", async ({
  page,
}) => {
  await signupAsNewOperator(page);
  await createProjectFromDashboard(page);

  const timelineContent = "Captured exposed Grafana login page";
  const commandText = "nmap -sV 10.10.10.10";
  const commandOutput = "445/tcp open microsoft-ds";

  await seedTimelineEntry(page, {
    type: "note",
    content: timelineContent,
    output: "HTTP 200 on /login",
  });
  await seedCommandHistoryEntry(page, {
    command: commandText,
    output: `${commandOutput}\nHost script results: anonymous SMB listing enabled`,
  });

  await page.getByRole("tab", { name: /^history$/i }).click();

  const searchInput = page.getByPlaceholder("Search audit logs...");
  const timelineEntry = page.getByText(timelineContent, { exact: true });
  const commandEntry = page.getByText(commandText, { exact: true });

  await expect(timelineEntry).toBeVisible();
  await expect(commandEntry).toBeVisible();

  await searchInput.fill("microsoft-ds");
  await expect(commandEntry).toBeVisible();
  await expect(page.getByText(/microsoft-ds/i)).toBeVisible();
  await expect(timelineEntry).toHaveCount(0);

  await searchInput.fill("");
  await page.getByRole("button", { name: /^notes$/i }).click();
  await expect(timelineEntry).toBeVisible();
  await expect(commandEntry).toHaveCount(0);

  await page.getByRole("button", { name: /^commands$/i }).click();
  await expect(commandEntry).toBeVisible();
  await expect(timelineEntry).toHaveCount(0);

  await searchInput.fill("kerberos");
  await expect(
    page.getByText("No activity matches current search/filter.")
  ).toBeVisible();
});

test("timeline dense feed shows diagnostics after mixed activity search", async ({
  page,
}) => {
  await signupAsNewOperator(page);
  await createProjectFromDashboard(page);

  await seedDenseTimelineFeed(page, {
    prefix: "Dense Smoke",
    timelineCount: 12,
    commandCount: 12,
  });

  await page.getByRole("tab", { name: /^history$/i }).click();

  const searchInput = page.getByPlaceholder("Search audit logs...");
  await searchInput.fill("dense command output 11");

  await expect(
    page.getByTestId("timeline-performance-panel")
  ).toBeVisible();
  await expect(page.getByText("timeline.load")).toBeVisible();
  await expect(page.getByText("timeline.filter")).toBeVisible();
  await expect(page.getByText(/dense-smoke-cmd-11/i)).toBeVisible();
});

test("ai onboarding opens provider settings from a fresh project", async ({
  page,
}) => {
  await signupAsNewOperator(page);
  await createProjectFromDashboard(page);

  await page.getByRole("tab", { name: /ai assistant/i }).click();

  await expect(page.getByText("No AI provider configured")).toBeVisible();
  await page.getByRole("button", { name: "Open AI Settings" }).click();
  const providersDialog = page.getByRole("dialog");
  await expect(
    providersDialog.locator("h2", { hasText: "AI Providers" })
  ).toBeVisible();
  await expect(
    providersDialog.getByText(/configure ai providers and default models/i)
  ).toBeVisible();
});

test("ai onboarding quick add enables chat from a fresh project", async ({
  page,
}) => {
  await signupAsNewOperator(page);
  await createProjectFromDashboard(page);

  await page.getByRole("tab", { name: /ai assistant/i }).click();

  await expect(page.getByText("No AI provider configured")).toBeVisible();
  await page.getByRole("button", { name: "Open AI Settings" }).click();

  const providersDialog = page.getByRole("dialog");
  await expect(
    providersDialog.locator("h2", { hasText: "AI Providers" })
  ).toBeVisible();

  await providersDialog.getByRole("button", { name: "Ollama" }).click();

  await expect(page.getByRole("heading", { name: "PwnPilot AI" })).toBeVisible();
  await expect(page.getByText("No AI provider configured")).toHaveCount(0);

  await page.getByRole("button", { name: "AI Settings" }).click();
  const configuredProvidersDialog = page.getByRole("dialog");
  await expect(
    configuredProvidersDialog.locator("h2", { hasText: "AI Providers" })
  ).toBeVisible();
  await expect(
    configuredProvidersDialog.getByText("gemma3:latest • http://localhost:11434")
  ).toBeVisible();
  await expect(
    configuredProvidersDialog.getByText(
      /local runtime\. pull gemma3:latest in ollama before first use\./i
    )
  ).toBeVisible();
  await expect(
    configuredProvidersDialog.getByText(/http:\/\/localhost:11434/i)
  ).toBeVisible();
});

test("prompt template can be created inserted and deleted from project ai", async ({
  page,
}) => {
  await signupAsNewOperator(page);
  await createProjectFromDashboard(page);

  const promptName = `Smoke Prompt ${uniqueSmokeSuffix()}`;
  const promptContent = "Summarize the exposed SMB findings for the current target.";

  await enableProjectAIChat(page);
  await createPromptTemplate(page, {
    name: promptName,
    description: "Prompt created from Playwright smoke",
    content: promptContent,
  });
  await insertPromptTemplate(page, promptName);
  await expectSeededAIComposerPrompt(page, /summarize the exposed smb findings/i);
  await deletePromptTemplate(page, promptName);
});
