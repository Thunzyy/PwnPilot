import { expect, type Locator, type Page } from "@playwright/test";

const aiComposerLocator = (page: Page): Locator =>
  page.getByRole("textbox", {
    name: /query pwnpilot context or ask for help/i,
  });

const projectCommandSettingsRow = (
  page: Page,
  commandName: string
): Locator =>
  page.locator(
    `[data-testid="command-settings-command-row"][data-command-name="${commandName}"]`
  );

const projectCommandLibraryCard = (
  page: Page,
  commandName: string
): Locator =>
  page.locator(
    `[data-testid="command-library-card"][data-command-name="${commandName}"]`
  );

interface ProjectCommandDraft {
  name: string;
  category: string;
  command: string;
  description?: string;
  tags?: string[];
}

interface ProjectCommandUpdate {
  category?: string;
  command?: string;
  description?: string;
  tags?: string[];
}

export async function openProjectCommandsTab(page: Page) {
  await page.getByRole("tab", { name: /^commands$/i }).click();
  await expect(
    page.getByRole("heading", { name: /project command library/i })
  ).toBeVisible();
}

export async function openProjectCommandSettings(page: Page) {
  await openProjectCommandsTab(page);
  await page.getByRole("link", { name: /manage commands/i }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/commands\/settings$/);
  await expect(
    page.getByRole("heading", { name: /project command settings/i })
  ).toBeVisible();
}

export async function createProjectCommand(
  page: Page,
  command: ProjectCommandDraft
) {
  const createForm = page.getByTestId("command-settings-create-form-project");

  await createForm.getByLabel(/new command name/i).fill(command.name);
  await createForm.getByLabel(/new command category/i).fill(command.category);
  await createForm.getByLabel(/new command body/i).fill(command.command);
  await createForm
    .getByLabel(/new command description/i)
    .fill(command.description ?? "");
  await createForm
    .getByLabel(/new command tags/i)
    .fill(command.tags?.join(", ") ?? "");
  await createForm.getByRole("button", { name: /add command/i }).click();

  await expect(projectCommandSettingsRow(page, command.name)).toBeVisible();
}

export async function updateProjectCommand(
  page: Page,
  commandName: string,
  updates: ProjectCommandUpdate
) {
  const row = projectCommandSettingsRow(page, commandName);
  await expect(row).toBeVisible();

  if (updates.category !== undefined) {
    await row.getByLabel(/command category/i).fill(updates.category);
  }
  if (updates.command !== undefined) {
    await row.getByLabel(/command body/i).fill(updates.command);
  }
  if (updates.description !== undefined) {
    await row.getByLabel(/command description/i).fill(updates.description);
  }
  if (updates.tags !== undefined) {
    await row.getByLabel(/command tags/i).fill(updates.tags.join(", "));
  }

  await row.getByRole("button", { name: /save/i }).click();

  if (updates.category !== undefined) {
    await expect(row.getByLabel(/command category/i)).toHaveValue(
      updates.category
    );
  }
  if (updates.command !== undefined) {
    await expect(row.getByLabel(/command body/i)).toHaveValue(updates.command);
  }
  if (updates.description !== undefined) {
    await expect(row.getByLabel(/command description/i)).toHaveValue(
      updates.description
    );
  }
  if (updates.tags !== undefined) {
    await expect(row.getByLabel(/command tags/i)).toHaveValue(
      updates.tags.join(", ")
    );
  }
}

export async function deleteProjectCommand(page: Page, commandName: string) {
  const row = projectCommandSettingsRow(page, commandName);
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /delete/i }).click();
  await expect(projectCommandSettingsRow(page, commandName)).toHaveCount(0);
}

export async function batchDeleteProjectCommands(
  page: Page,
  commandNames: string[]
) {
  await openProjectCommandsTab(page);
  await page.getByRole("button", { name: /^select$/i }).click();

  for (const commandName of commandNames) {
    const card = projectCommandLibraryCard(page, commandName);
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: new RegExp(`select command ${commandName}`, "i") }).click();
  }

  await page.getByRole("button", { name: /delete selected/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/delete command\(s\)\?/i)).toBeVisible();
  await dialog.getByRole("button", { name: /^delete$/i }).click();

  for (const commandName of commandNames) {
    await expect(projectCommandLibraryCard(page, commandName)).toHaveCount(0);
  }
}

export async function handoffCommandSearchToAI(page: Page, query: string) {
  const searchInput = page.getByPlaceholder(
    /search project \+ global command database/i
  );

  await searchInput.fill(query);
  await page.getByTitle(/ask ai to find a command/i).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/ai$/);
}

export async function runFirstProjectCommand(page: Page) {
  const runButtons = page.getByRole("button", { name: /run command/i });
  await expect(runButtons.first()).toBeVisible();
  await runButtons.first().click();
}

export async function expectSeededAIComposerPrompt(
  page: Page,
  expectedPattern: RegExp
) {
  await expect(aiComposerLocator(page)).toHaveValue(expectedPattern);
}
