import { expect, type Page } from "@playwright/test";

async function getMembershipRow(page: Page, username: string) {
  const memberRow = page.locator("div.rounded-lg", {
    has: page.getByText(username, { exact: true }),
  }).first();
  await expect(memberRow).toBeVisible();
  return memberRow;
}

export async function openProjectTeamSettings(page: Page) {
  await page.getByRole("button", { name: /project settings/i }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/settings$/);
  await page.getByRole("link", { name: /^team$/i }).click();
  await expect(page.getByLabel(/invite username or email/i)).toBeVisible();
}

export async function inviteCollaborator(
  page: Page,
  usernameOrEmail: string,
  role: "member" | "admin" = "member"
) {
  await page.getByLabel(/invite username or email/i).fill(usernameOrEmail);
  await page.getByLabel(/invite role/i).selectOption(role);
  await page.getByRole("button", { name: /^invite$/i }).click();
}

export async function expectProjectAccessRequest(page: Page) {
  await expect(
    page.getByRole("heading", { name: /request project access/i })
  ).toBeVisible();
}

export async function requestProjectAccess(page: Page) {
  await page.getByRole("button", { name: /^request access$/i }).click();
  await expect(
    page.getByRole("heading", { name: /access request pending/i })
  ).toBeVisible();
}

export async function approvePendingCollaborator(page: Page, username: string) {
  const memberRow = await getMembershipRow(page, username);
  await memberRow.getByRole("button", { name: /^approve$/i }).click();
}

export async function denyPendingCollaborator(page: Page, username: string) {
  const memberRow = await getMembershipRow(page, username);
  await memberRow.getByRole("button", { name: /^deny$/i }).click();
}

export async function expectProjectAccessDenied(page: Page) {
  await expect(
    page.getByRole("heading", { name: /access request denied/i })
  ).toBeVisible();
}
