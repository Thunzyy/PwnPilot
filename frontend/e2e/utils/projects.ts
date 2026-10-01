import type { Page } from "@playwright/test";

import { uniqueSmokeSuffix } from "./runtime";

export async function createProjectFromDashboard(
  page: Page,
  options: { type?: string } = {}
) {
  const projectName = `Smoke Ops ${uniqueSmokeSuffix()}`;

  await page.getByRole("button", { name: /new project/i }).click();
  await page.getByLabel(/project name/i).fill(projectName);
  if (options.type) {
    await page.getByText(options.type, { exact: true }).click();
  }
  await page.getByRole("button", { name: /initialize project/i }).click();

  return projectName;
}
