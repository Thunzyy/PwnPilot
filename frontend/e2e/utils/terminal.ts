import { expect, type Page } from "@playwright/test";

const sendToAiButton = (page: Page) =>
  page.getByRole("button", { name: /send to ai/i });

export async function waitForProjectTerminal(page: Page) {
  const terminalReady = sendToAiButton(page);
  const terminalUnavailable = page.getByText(/terminal unavailable/i);

  await expect(terminalReady.or(terminalUnavailable).first()).toBeVisible();

  if (await terminalUnavailable.isVisible()) {
    throw new Error("Terminal is unavailable in the smoke harness");
  }

  await expect(terminalReady).toBeEnabled();
}

export async function handoffTerminalTranscriptToAI(page: Page) {
  await waitForProjectTerminal(page);
  await sendToAiButton(page).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/ai$/);
}

export async function expectTerminalTabActive(page: Page) {
  await expect(page.getByRole("tab", { name: /^terminal$/i })).toHaveAttribute(
    "data-state",
    "active"
  );
}

export async function expectTerminalTranscriptPrompt(page: Page) {
  const composer = page.getByRole("textbox", {
    name: /query pwnpilot context or ask for help/i,
  });

  await expect(composer).toHaveValue(/terminal session:/i);
  await expect(composer).toHaveValue(/connected to terminal session/i);
}
