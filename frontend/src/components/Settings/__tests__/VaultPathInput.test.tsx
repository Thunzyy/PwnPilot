/**
 * VaultPathInput Component Tests (SET-01 vault path validation)
 *
 * Validates rendering: input with value and Validate button,
 * vault detected feedback on valid Obsidian vault,
 * path not found feedback on missing path.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";

import { kbApi } from "@/api/kb";

import { VaultPathInput } from "../VaultPathInput";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/api/kb", () => ({
  kbApi: {
    validatePath: vi.fn(),
  },
}));

const mockedValidatePath = vi.mocked(kbApi.validatePath);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("VaultPathInput", () => {
  beforeEach(() => {
    mockedValidatePath.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders input with value and validate button", () => {
    const onChange = vi.fn();
    const { container } = render(
      <VaultPathInput value="/home/user/vault" onChange={onChange} />,
    );

    const input = container.querySelector("input");
    expect(input).toBeTruthy();
    expect(input!.value).toBe("/home/user/vault");

    // Validate button exists and is enabled
    const buttons = container.querySelectorAll("button");
    const validateBtn = Array.from(buttons).find((b) =>
      b.textContent?.includes("Validate"),
    );
    expect(validateBtn).toBeTruthy();
    expect(validateBtn!.disabled).toBe(false);
  });

  it("shows vault detected feedback on valid obsidian vault", async () => {
    mockedValidatePath.mockResolvedValue({
      path: "/home/user/vault",
      exists: true,
      is_directory: true,
      is_obsidian_vault: true,
    });

    const onChange = vi.fn();
    const { container } = render(
      <VaultPathInput value="/home/user/vault" onChange={onChange} />,
    );

    // Click Validate button
    const buttons = container.querySelectorAll("button");
    const validateBtn = Array.from(buttons).find((b) =>
      b.textContent?.includes("Validate"),
    );
    fireEvent.click(validateBtn!);

    await waitFor(() => {
      expect(container.textContent).toContain("Obsidian vault detected");
    });

    expect(mockedValidatePath).toHaveBeenCalledWith("/home/user/vault");
  });

  it("shows path not found feedback on missing path", async () => {
    mockedValidatePath.mockResolvedValue({
      path: "/nonexistent/path",
      exists: false,
      is_directory: false,
      is_obsidian_vault: false,
    });

    const onChange = vi.fn();
    const { container } = render(
      <VaultPathInput value="/nonexistent/path" onChange={onChange} />,
    );

    // Click Validate button
    const buttons = container.querySelectorAll("button");
    const validateBtn = Array.from(buttons).find((b) =>
      b.textContent?.includes("Validate"),
    );
    fireEvent.click(validateBtn!);

    await waitFor(() => {
      expect(container.textContent).toContain("Path not found on server");
    });
  });
});
