import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";

import { smokeBackendUrl, uniqueSmokeSuffix } from "./runtime";

export interface OperatorCredentials {
  username: string;
  email: string;
  password: string;
}

export function buildOperatorCredentials(prefix = "smoke"): OperatorCredentials {
  const suffix = uniqueSmokeSuffix();
  const username = `${prefix}-${suffix}`;
  const email = `${username}@example.com`;
  const password = `Smoke-${suffix}!`;

  return { username, email, password };
}

export async function signupAsNewOperator(
  page: Page
): Promise<OperatorCredentials> {
  const { username, email, password } = buildOperatorCredentials();

  await page.goto("/");
  await page.getByRole("button", { name: /need an account/i }).click();
  await page.getByPlaceholder(/username/i).fill(username);
  await page.getByPlaceholder(/email/i).fill(email);
  await page.getByPlaceholder(/password/i).fill(password);
  await page.getByRole("button", { name: /^sign up$/i }).click();
  await expect(
    page.getByRole("heading", { name: /projects dashboard/i })
  ).toBeVisible();

  return { username, email, password };
}

export async function loginAsOperator(
  page: Page,
  credentials: OperatorCredentials
) {
  await page.goto("/");
  await page.getByPlaceholder(/username/i).fill(credentials.username);
  await page.getByPlaceholder(/password/i).fill(credentials.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(
    page.getByRole("heading", { name: /projects dashboard/i })
  ).toBeVisible();
}

export async function signupOperatorViaApi(
  request: APIRequestContext,
  credentials: OperatorCredentials
) {
  const response = await request.post(`${smokeBackendUrl}/api/v1/auth/signup`, {
    data: {
      username: credentials.username,
      email: credentials.email,
      password: credentials.password,
    },
  });
  expect(response.ok()).toBeTruthy();
}

export async function loginOperatorViaApi(
  request: APIRequestContext,
  credentials: OperatorCredentials
) {
  const response = await request.post(`${smokeBackendUrl}/api/v1/auth/login`, {
    data: {
      username_or_email: credentials.username,
      password: credentials.password,
    },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  return body.access_token as string;
}
