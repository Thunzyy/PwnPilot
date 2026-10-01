/**
 * SourceEditDialog Component Tests (SET-01/SET-02 source create/edit)
 *
 * Validates rendering: create mode with empty fields, edit mode with populated fields,
 * create submission via createLocalSource, OPSEC warning trigger on first remote URL.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { toast } from "sonner";

import { useKBStore } from "@/stores/kbStore";

import { SourceEditDialog } from "../SourceEditDialog";
import { makeSource } from "./helpers";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCreateLocalSource = vi.fn();
const mockUpdateSource = vi.fn();

vi.mock("@/stores/kbStore", () => ({
  useKBStore: vi.fn(),
}));

// Mock the ProjectPicker to avoid projectStore dependency
vi.mock("@/components/KnowledgeBase/ProjectPicker", () => ({
  ProjectPicker: ({
    onSelect,
    selectedProjectId,
  }: {
    onSelect: (id: string) => void;
    selectedProjectId: string;
  }) => (
    <button
      data-testid="project-picker"
      onClick={() => onSelect("proj-1")}
    >
      {selectedProjectId || "Select project"}
    </button>
  ),
}));

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockedUseKBStore = vi.mocked(useKBStore);

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function setupStoreMock() {
  mockedUseKBStore.mockImplementation((selector: unknown) => {
    const state = {
      createLocalSource: mockCreateLocalSource,
      updateSource: mockUpdateSource,
    };
    return typeof selector === "function"
      ? (selector as (s: typeof state) => unknown)(state)
      : state;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SourceEditDialog", () => {
  beforeEach(() => {
    mockCreateLocalSource.mockReset();
    mockUpdateSource.mockReset();
    vi.mocked(toast.error).mockReset();
    vi.mocked(toast.success).mockReset();
    mockCreateLocalSource.mockResolvedValue(undefined);
    mockUpdateSource.mockResolvedValue(undefined);
    setupStoreMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders in create mode with empty fields", () => {
    const onOpenChange = vi.fn();

    render(
      <SourceEditDialog
        open={true}
        onOpenChange={onOpenChange}
        source={null}
      />,
    );

    // Dialog renders via portal in document.body
    const body = document.body;
    expect(body.textContent).toContain("Add Source");

    // Input fields should be empty
    const inputs = body.querySelectorAll("input");
    const nonEmptyInputs = Array.from(inputs).filter(
      (i) => i.value && i.value !== "Select project",
    );
    expect(nonEmptyInputs.length).toBe(0);
  });

  it("renders in edit mode with populated fields", () => {
    const source = makeSource({
      name: "My Vault",
      path: "/home/user/notes",
      remote_url: "git@github.com:user/repo.git",
    });
    const onOpenChange = vi.fn();

    render(
      <SourceEditDialog
        open={true}
        onOpenChange={onOpenChange}
        source={source}
      />,
    );

    const body = document.body;
    expect(body.textContent).toContain("Edit Source");

    // Check inputs have source values
    const inputs = body.querySelectorAll("input");
    const values = Array.from(inputs).map((i) => i.value);
    expect(values).toContain("My Vault");
    expect(values).toContain("/home/user/notes");
    expect(values).toContain("git@github.com:user/repo.git");
  });

  it("submits create via createLocalSource", async () => {
    const onOpenChange = vi.fn();

    render(
      <SourceEditDialog
        open={true}
        onOpenChange={onOpenChange}
        source={null}
      />,
    );

    const body = document.body;
    const inputs = body.querySelectorAll("input");

    // Fill in name (first input after dialog renders)
    const nameInput = Array.from(inputs).find(
      (i) => i.placeholder === "My notes",
    );
    const pathInput = Array.from(inputs).find(
      (i) => i.placeholder === "/home/user/notes",
    );
    expect(nameInput).toBeTruthy();
    expect(pathInput).toBeTruthy();

    fireEvent.change(nameInput!, { target: { value: "New Source" } });
    fireEvent.change(pathInput!, { target: { value: "/tmp/vault" } });

    // Select project via mock ProjectPicker
    const projectBtn = body.querySelector('[data-testid="project-picker"]');
    fireEvent.click(projectBtn!);

    // Click Add Source button
    const buttons = body.querySelectorAll("button");
    const submitBtn = Array.from(buttons).find((b) =>
      b.textContent?.includes("Add Source"),
    );
    expect(submitBtn).toBeTruthy();
    fireEvent.click(submitBtn!);

    await waitFor(() => {
      expect(mockCreateLocalSource).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "New Source",
          path: "/tmp/vault",
          project_id: "proj-1",
          source_type: "local",
        }),
      );
    });
  });

  it("shows OPSEC warning when setting remote_url on source without prior remote", async () => {
    const source = makeSource({
      remote_url: null,
      opsec_acknowledged: false,
    });
    const onOpenChange = vi.fn();

    render(
      <SourceEditDialog
        open={true}
        onOpenChange={onOpenChange}
        source={source}
      />,
    );

    const body = document.body;

    // Type a remote URL
    const inputs = body.querySelectorAll("input");
    const remoteInput = Array.from(inputs).find(
      (i) => i.placeholder === "git@github.com:user/repo.git",
    );
    expect(remoteInput).toBeTruthy();
    fireEvent.change(remoteInput!, {
      target: { value: "https://github.com/user/repo" },
    });

    // Click Save Changes
    const buttons = body.querySelectorAll("button");
    const saveBtn = Array.from(buttons).find((b) =>
      b.textContent?.includes("Save Changes"),
    );
    expect(saveBtn).toBeTruthy();
    fireEvent.click(saveBtn!);

    // OPSEC warning should appear via portal
    await waitFor(() => {
      expect(body.textContent).toContain("Remote Repository Notice");
    });
  });

  it("shows backend details when source creation fails", async () => {
    const onOpenChange = vi.fn();
    mockCreateLocalSource.mockRejectedValueOnce({
      response: {
        data: {
          error: {
            message: "Selected project cannot write to this vault path.",
          },
        },
      },
    });

    render(
      <SourceEditDialog
        open={true}
        onOpenChange={onOpenChange}
        source={null}
      />,
    );

    const body = document.body;
    const inputs = body.querySelectorAll("input");
    const nameInput = Array.from(inputs).find(
      (i) => i.placeholder === "My notes",
    );
    const pathInput = Array.from(inputs).find(
      (i) => i.placeholder === "/home/user/notes",
    );
    fireEvent.change(nameInput!, { target: { value: "New Source" } });
    fireEvent.change(pathInput!, { target: { value: "/tmp/vault" } });
    fireEvent.click(body.querySelector('[data-testid="project-picker"]')!);

    const submitBtn = Array.from(body.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Add Source"),
    );
    fireEvent.click(submitBtn!);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Failed to add source", {
        description: "Selected project cannot write to this vault path.",
      }),
    );
  });
});
