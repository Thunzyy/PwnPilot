import { expect, type Page } from "@playwright/test";

import { smokeBackendUrl } from "./runtime";

interface SeedTimelineEntryInput {
  type?: string;
  content: string;
  output?: string;
}

interface SeedCommandHistoryInput {
  sessionName?: string;
  command: string;
  output?: string;
  exitCode?: number;
  cwd?: string;
  durationMs?: number;
}

interface SeedDenseTimelineFeedInput {
  prefix?: string;
  timelineCount: number;
  commandCount: number;
}

const projectWorkspaceUrlPattern = /\/projects\/([^/]+)$/;

async function getCurrentProjectId(page: Page) {
  await expect(page).toHaveURL(projectWorkspaceUrlPattern);

  const projectId = page.url().match(projectWorkspaceUrlPattern)?.[1];
  if (!projectId) {
    throw new Error(`Unable to resolve project id from URL: ${page.url()}`);
  }

  return projectId;
}

export async function seedTimelineEntry(
  page: Page,
  { type = "note", content, output }: SeedTimelineEntryInput
) {
  const projectId = await getCurrentProjectId(page);

  await page.evaluate(
    async ({ backendUrl, currentProjectId, entryType, entryContent, entryOutput }) => {
      const token = window.localStorage.getItem("pwnpilot_access_token");
      if (!token) {
        throw new Error("Smoke auth token missing from localStorage");
      }

      const response = await fetch(
        `${backendUrl}/api/v1/projects/${currentProjectId}/timeline`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            type: entryType,
            content: entryContent,
            output: entryOutput,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          `Failed to seed timeline entry: ${response.status} ${await response.text()}`
        );
      }
    },
    {
      backendUrl: smokeBackendUrl,
      currentProjectId: projectId,
      entryType: type,
      entryContent: content,
      entryOutput: output ?? null,
    }
  );
}

export async function seedCommandHistoryEntry(
  page: Page,
  {
    sessionName = "Smoke Timeline Session",
    command,
    output,
    exitCode = 0,
    cwd = "/tmp",
    durationMs = 1500,
  }: SeedCommandHistoryInput
) {
  const projectId = await getCurrentProjectId(page);

  await page.evaluate(
    async ({
      backendUrl,
      currentProjectId,
      currentSessionName,
      currentCommand,
      currentOutput,
      currentExitCode,
      currentCwd,
      currentDurationMs,
    }) => {
      const token = window.localStorage.getItem("pwnpilot_access_token");
      if (!token) {
        throw new Error("Smoke auth token missing from localStorage");
      }

      const sessionResponse = await fetch(`${backendUrl}/api/v1/terminal/sessions`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: currentSessionName,
          project_id: currentProjectId,
          cols: 120,
          rows: 30,
        }),
      });

      if (!sessionResponse.ok) {
        throw new Error(
          `Failed to seed command session: ${sessionResponse.status} ${await sessionResponse.text()}`
        );
      }

      const session = await sessionResponse.json();

      const commandResponse = await fetch(
        `${backendUrl}/api/v1/terminal/sessions/${session.id}/commands`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            command: currentCommand,
            output: currentOutput,
            exit_code: currentExitCode,
            cwd: currentCwd,
            duration_ms: currentDurationMs,
          }),
        }
      );

      if (!commandResponse.ok) {
        throw new Error(
          `Failed to seed command history: ${commandResponse.status} ${await commandResponse.text()}`
        );
      }
    },
    {
      backendUrl: smokeBackendUrl,
      currentProjectId: projectId,
      currentSessionName: sessionName,
      currentCommand: command,
      currentOutput: output ?? null,
      currentExitCode: exitCode,
      currentCwd: cwd,
      currentDurationMs: durationMs,
    }
  );
}

export async function seedDenseTimelineFeed(
  page: Page,
  { prefix = "Dense Smoke", timelineCount, commandCount }: SeedDenseTimelineFeedInput
) {
  const projectId = await getCurrentProjectId(page);

  await page.evaluate(
    async ({
      backendUrl,
      currentProjectId,
      currentPrefix,
      currentTimelineCount,
      currentCommandCount,
    }) => {
      const token = window.localStorage.getItem("pwnpilot_access_token");
      if (!token) {
        throw new Error("Smoke auth token missing from localStorage");
      }

      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };

      const sessionResponse = await fetch(`${backendUrl}/api/v1/terminal/sessions`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({
          name: `${currentPrefix} Session`,
          project_id: currentProjectId,
          cols: 120,
          rows: 30,
        }),
      });

      if (!sessionResponse.ok) {
        throw new Error(
          `Failed to seed dense timeline session: ${sessionResponse.status} ${await sessionResponse.text()}`
        );
      }

      const session = await sessionResponse.json();

      const timelineRequests = Array.from(
        { length: currentTimelineCount },
        (_, index) =>
          fetch(`${backendUrl}/api/v1/projects/${currentProjectId}/timeline`, {
            method: "POST",
            credentials: "include",
            headers,
            body: JSON.stringify({
              type: "note",
              content: `${currentPrefix} timeline ${index}`,
              output: `timeline output ${index}`,
            }),
          })
      );

      const commandRequests = Array.from(
        { length: currentCommandCount },
        (_, index) =>
          fetch(
            `${backendUrl}/api/v1/terminal/sessions/${session.id}/commands`,
            {
              method: "POST",
              credentials: "include",
              headers,
              body: JSON.stringify({
                command: `${currentPrefix.toLowerCase().replace(/\s+/g, "-")}-cmd-${index}`,
                output: `dense command output ${index}`,
                exit_code: 0,
                cwd: "/tmp",
                duration_ms: 1000 + index,
              }),
            }
          )
      );

      const responses = await Promise.all([...timelineRequests, ...commandRequests]);

      for (const response of responses) {
        if (!response.ok) {
          throw new Error(
            `Failed to seed dense timeline feed: ${response.status} ${await response.text()}`
          );
        }
      }
    },
    {
      backendUrl: smokeBackendUrl,
      currentProjectId: projectId,
      currentPrefix: prefix,
      currentTimelineCount: timelineCount,
      currentCommandCount: commandCount,
    }
  );
}

export async function handoffTimelineEntryToAI(page: Page, content: string) {
  await page.getByRole("tab", { name: /^history$/i }).click();
  const contentLocator = page.getByText(content);
  await expect(contentLocator).toBeVisible();
  await contentLocator.hover();
  await page.getByRole("button", { name: /send to ai/i }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/ai$/);
}

export async function linkTimelineEntryToKnowledge(
  page: Page,
  entryContent: string,
  articleQuery: string
) {
  await page.getByRole("tab", { name: /^history$/i }).click();

  const entryCard = page
    .locator('[class*="group flex gap-6 relative"]')
    .filter({ has: page.getByText(entryContent) })
    .first();

  await expect(entryCard).toBeVisible();
  await entryCard.getByRole("button", { name: /link knowledge/i }).click();

  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: /link knowledge base article/i })
  ).toBeVisible();

  const searchInput = dialog.getByPlaceholder(/search articles/i);
  await searchInput.fill(articleQuery);

  const resultButton = dialog.getByRole("button").filter({
    hasText: new RegExp(articleQuery, "i"),
  }).first();
  await expect(resultButton).toBeVisible();
  await resultButton.click();

  await expect(dialog).toHaveCount(0);

  return entryCard;
}

export async function expectTimelineLinkedKnowledge(
  page: Page,
  entryContent: string,
  linkedDocPattern: RegExp
) {
  const entryCard = page
    .locator('[class*="group flex gap-6 relative"]')
    .filter({ has: page.getByText(entryContent) })
    .first();

  await expect(entryCard).toBeVisible();
  await expect(entryCard.getByText(/related knowledge/i)).toBeVisible();
  await expect(entryCard.getByText(linkedDocPattern)).toBeVisible();
}
