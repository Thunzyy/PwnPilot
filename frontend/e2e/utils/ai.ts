import { expect, type Page } from "@playwright/test";

import { smokeBackendUrl } from "./runtime";

const projectWorkspaceUrlPattern = /\/projects\/([^/]+)$/;

async function getCurrentProjectId(page: Page) {
  await expect(page).toHaveURL(projectWorkspaceUrlPattern);

  const projectId = page.url().match(projectWorkspaceUrlPattern)?.[1];
  if (!projectId) {
    throw new Error(`Unable to resolve project id from URL: ${page.url()}`);
  }

  return projectId;
}

export async function seedProjectAIMemory(
  page: Page,
  {
    key,
    value,
  }: {
    key: string;
    value: string;
  }
) {
  const projectId = await getCurrentProjectId(page);

  await page.evaluate(
    async ({ backendUrl, currentProjectId, memoryKey, memoryValue }) => {
      const token = window.localStorage.getItem("pwnpilot_access_token");
      if (!token) {
        throw new Error("Smoke auth token missing from localStorage");
      }

      const response = await fetch(`${backendUrl}/api/v1/ai/memories`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          project_id: currentProjectId,
          key: memoryKey,
          value: memoryValue,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Failed to seed AI memory: ${response.status} ${await response.text()}`
        );
      }
    },
    {
      backendUrl: smokeBackendUrl,
      currentProjectId: projectId,
      memoryKey: key,
      memoryValue: value,
    }
  );
}
