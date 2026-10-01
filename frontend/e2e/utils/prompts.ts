import { expect, type Locator, type Page } from "@playwright/test";

interface PromptTemplateInput {
  name: string;
  description?: string;
  content: string;
}

const aiComposerLocator = (page: Page): Locator =>
  page.getByRole("textbox", {
    name: /query pwnpilot context or ask for help/i,
  });

const promptsSearchLocator = (page: Page): Locator =>
  page.getByPlaceholder(/search templates/i);

const promptRowLocator = (page: Page, templateName: string): Locator =>
  page.locator("div.group").filter({
    has: page.getByText(templateName, { exact: true }),
  }).first();

async function openPromptsPanel(page: Page) {
  const openSidePanelButton = page.getByTitle("Open side panel");
  if (await openSidePanelButton.count()) {
    await openSidePanelButton.click();
  }

  await page.getByTitle("Prompts").click();
  await expect(promptsSearchLocator(page)).toBeVisible();
}

export async function enableProjectAIChat(page: Page) {
  await page.getByRole("tab", { name: /ai assistant/i }).click();
  await expect(page.getByText("No AI provider configured")).toBeVisible();

  await page.getByRole("button", { name: "Open AI Settings" }).click();
  const providersDialog = page.getByRole("dialog");
  await expect(
    providersDialog.locator("h2", { hasText: "AI Providers" })
  ).toBeVisible();

  await providersDialog.getByRole("button", { name: "Ollama" }).click();
  await expect(page.getByRole("heading", { name: "PwnPilot AI" })).toBeVisible();

  await page.getByRole("button", { name: /^new chat/i }).first().click();
  await expect(aiComposerLocator(page)).toBeVisible();
}

export async function createPromptTemplate(
  page: Page,
  template: PromptTemplateInput
) {
  await openPromptsPanel(page);
  await page.getByRole("button", { name: /new template/i }).click();

  await page.getByPlaceholder("Template name").fill(template.name);
  if (template.description) {
    await page
      .getByPlaceholder("Description (optional)")
      .fill(template.description);
  }
  await page
    .getByPlaceholder(
      "Template content... Use {variable} or {variable:default} for variables"
    )
    .fill(template.content);
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await promptsSearchLocator(page).fill(template.name);
  await expect(page.getByText(template.name, { exact: true })).toBeVisible();
}

export async function insertPromptTemplate(page: Page, templateName: string) {
  await openPromptsPanel(page);
  await promptsSearchLocator(page).fill(templateName);

  const promptRow = promptRowLocator(page, templateName);
  await expect(promptRow).toBeVisible();
  await promptRow.hover();
  await promptRow.getByTitle("Insert into chat").click();
}

export async function deletePromptTemplate(page: Page, templateName: string) {
  await openPromptsPanel(page);
  await promptsSearchLocator(page).fill(templateName);

  const promptRow = promptRowLocator(page, templateName);
  await expect(promptRow).toBeVisible();
  await promptRow.hover();
  await promptRow.getByTitle("Delete").click();
  await expect(page.getByText(templateName, { exact: true })).toHaveCount(0);
}
