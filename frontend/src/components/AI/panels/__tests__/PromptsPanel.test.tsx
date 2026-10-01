import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "@/lib/queryClient";
import { aiApi } from "@/api/ai";

import { PromptsPanel } from "../PromptsPanel";

vi.mock("@/api/ai", () => ({
  aiApi: {
    listTemplatesByCategory: vi.fn(),
    createPrompt: vi.fn(),
    deletePrompt: vi.fn(),
  },
}));

const mockedListTemplatesByCategory = vi.mocked(aiApi.listTemplatesByCategory);
const mockedCreatePrompt = vi.mocked(aiApi.createPrompt);
const mockedDeletePrompt = vi.mocked(aiApi.deletePrompt);

interface RenderPanelOverrides {
  onInsert?: (text: string) => void;
  onInsertWithVariables?: (template: { id: number; name: string }) => void;
}

function renderPanel(overrides?: RenderPanelOverrides) {
  const props = {
    onInsert: overrides?.onInsert ?? vi.fn(),
    onInsertWithVariables: overrides?.onInsertWithVariables ?? vi.fn(),
  };

  return {
    ...render(
      <QueryClientProvider client={createQueryClient()}>
        <PromptsPanel {...props} />
      </QueryClientProvider>
    ),
    ...props,
  };
}

describe("PromptsPanel", () => {
  beforeEach(() => {
    mockedListTemplatesByCategory.mockReset();
    mockedCreatePrompt.mockReset();
    mockedDeletePrompt.mockReset();
  });

  it("renders templates and inserts plain prompt content", async () => {
    const onInsert = vi.fn();
    mockedListTemplatesByCategory.mockResolvedValue({
      categories: [
        {
          id: "recon",
          name: "Recon",
          templates: [
            {
              id: 1,
              type: "template",
              category: "recon",
              name: "Quick Recon",
              description: "Fast port scan",
              variables: [],
              content: "nmap -sV $target",
              is_default: false,
              is_user_created: false,
              created_at: "2026-04-10T00:00:00Z",
              updated_at: "2026-04-10T00:00:00Z",
            },
          ],
        },
      ],
    });

    renderPanel({ onInsert });

    expect(await screen.findByText("Quick Recon")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Insert into chat"));

    expect(onInsert).toHaveBeenCalledWith("nmap -sV $target");
  });

  it("routes variable templates through the variable flow", async () => {
    const onInsertWithVariables = vi.fn();
    mockedListTemplatesByCategory.mockResolvedValue({
      categories: [
        {
          id: "web",
          name: "Web",
          templates: [
            {
              id: 2,
              type: "template",
              category: "web",
              name: "Dirsearch",
              description: "Bruteforce common paths",
              variables: ["target"],
              content: "ffuf -u http://{target}/FUZZ",
              is_default: false,
              is_user_created: false,
              created_at: "2026-04-10T00:00:00Z",
              updated_at: "2026-04-10T00:00:00Z",
            },
          ],
        },
      ],
    });

    renderPanel({ onInsertWithVariables });

    expect(await screen.findByText("Dirsearch")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Insert into chat"));

    expect(onInsertWithVariables).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2, name: "Dirsearch" })
    );
  });

  it("creates and deletes user templates", async () => {
    mockedListTemplatesByCategory.mockResolvedValue({
      categories: [
        {
          id: "general",
          name: "General",
          templates: [
            {
              id: 9,
              type: "template",
              category: "general",
              name: "User Template",
              description: "Custom helper",
              variables: [],
              content: "echo custom",
              is_default: false,
              is_user_created: true,
              created_at: "2026-04-10T00:00:00Z",
              updated_at: "2026-04-10T00:00:00Z",
            },
          ],
        },
      ],
    });
    mockedCreatePrompt.mockResolvedValue({
      id: 10,
      type: "template",
      category: "general",
      name: "New Template",
      description: "Created from UI",
      variables: [],
      content: "echo hello",
      is_default: false,
      is_user_created: true,
      created_at: "2026-04-10T00:00:00Z",
      updated_at: "2026-04-10T00:00:00Z",
    });
    mockedDeletePrompt.mockResolvedValue(undefined);

    renderPanel();

    expect(await screen.findByText("User Template")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /new template/i }));
    fireEvent.change(screen.getByPlaceholderText("Template name"), {
      target: { value: "New Template" },
    });
    fireEvent.change(screen.getByPlaceholderText("Description (optional)"), {
      target: { value: "Created from UI" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "Template content... Use {variable} or {variable:default} for variables"
      ),
      {
        target: { value: "echo hello" },
      }
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockedCreatePrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "New Template",
          description: "Created from UI",
          category: "general",
          content: "echo hello",
          type: "template",
        })
      );
    });

    fireEvent.click(screen.getByTitle("Delete"));

    await waitFor(() => {
      expect(mockedDeletePrompt).toHaveBeenCalledWith(9);
    });
  });

  it("shows matching templates when search narrows to a non-default category", async () => {
    mockedListTemplatesByCategory.mockResolvedValue({
      categories: [
        {
          id: "general",
          name: "General",
          templates: [
            {
              id: 1,
              type: "template",
              category: "general",
              name: "General Helper",
              description: "Generic helper",
              variables: [],
              content: "echo general",
              is_default: false,
              is_user_created: false,
              created_at: "2026-04-10T00:00:00Z",
              updated_at: "2026-04-10T00:00:00Z",
            },
          ],
        },
        {
          id: "web",
          name: "Web",
          templates: [
            {
              id: 2,
              type: "template",
              category: "web",
              name: "Dirsearch",
              description: "Bruteforce common paths",
              variables: [],
              content: "ffuf -u http://target/FUZZ",
              is_default: false,
              is_user_created: false,
              created_at: "2026-04-10T00:00:00Z",
              updated_at: "2026-04-10T00:00:00Z",
            },
          ],
        },
      ],
    });

    renderPanel();

    fireEvent.change(screen.getByPlaceholderText("Search templates..."), {
      target: { value: "Dirsearch" },
    });

    expect(await screen.findByText("Dirsearch")).toBeInTheDocument();
  });
});
