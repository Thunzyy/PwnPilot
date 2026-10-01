import { expect, type Page } from "@playwright/test";

import { smokeDocsVaultPath } from "./runtime";

export async function addDocsVault(page: Page, vaultName = "Docs Vault") {
  await page.goto("/notes/settings");

  await expect(
    page.getByRole("heading", { name: /kb settings/i })
  ).toBeVisible();

  await page.getByRole("button", { name: /^add vault$/i }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(/my notes/i).fill(vaultName);
  await dialog
    .getByPlaceholder(/\/home\/user\/notes/i)
    .fill(smokeDocsVaultPath);
  await dialog.getByRole("button", { name: /^add vault$/i }).click();

  await expect(page.getByText(vaultName, { exact: true }).first()).toBeVisible();

  return vaultName;
}

export async function openArchitectureFromKnowledgeBase(page: Page) {
  await page.goto("/notes");

  const searchbox = page.getByRole("searchbox", {
    name: /search knowledge base/i,
  });
  await searchbox.fill("architecture");

  const architectureResult = page.locator('[data-kb-result-path="ARCHITECTURE.md"]');
  await expect(architectureResult).toBeVisible();
  await architectureResult.click();

  await expect(page.getByRole("tab", { name: /^architecture/i })).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: /file path/i })
      .getByText(/architecture\.md/i)
  ).toBeVisible();
}
