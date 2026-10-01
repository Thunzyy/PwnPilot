import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { ModelSelector } from "../ModelSelector";

const fetchProvidersMock = vi.fn();
const fetchModelsMock = vi.fn();

const aiStoreState = {
  providers: [] as Array<{
    id: number;
    name: string;
    provider_type: "ollama" | "openai_compat" | "openai" | "anthropic" | "cli";
    is_enabled: boolean;
    health_status: "healthy" | "unhealthy" | "unknown" | null;
    has_api_key: boolean;
    default_model: string;
    base_url: string | null;
    cli_command?: string | null;
    parse_mode?: "json" | "markdown" | "raw" | null;
    detected_models?: string[] | null;
  }>,
  hasFetchedProviders: true,
  modelsCache: {} as Record<
    number,
    {
      provider_id: number;
      provider_name: string;
      models: Array<{ id: string; name: string }>;
      cached: boolean;
    }
  >,
  modelErrors: {} as Record<number, string | null | undefined>,
  fetchModels: fetchModelsMock,
  fetchProviders: fetchProvidersMock,
};

vi.mock("@/stores/aiStore", () => ({
  useAIStore: (
    selector?: (state: typeof aiStoreState) => unknown
  ) => {
    return selector ? selector(aiStoreState) : aiStoreState;
  },
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div role="menu">{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: ReactNode;
    onSelect?: () => void;
  }) => (
    <button type="button" onClick={() => onSelect?.()}>
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
}));

describe("ModelSelector", () => {
  beforeEach(() => {
    fetchProvidersMock.mockReset();
    fetchModelsMock.mockReset();
    fetchModelsMock.mockResolvedValue({
      provider_id: 0,
      provider_name: "",
      models: [],
      cached: false,
    });
    aiStoreState.providers = [];
    aiStoreState.hasFetchedProviders = true;
    aiStoreState.modelsCache = {};
    aiStoreState.modelErrors = {};
  });

  it("shows a local Ollama hint when no models were discovered", async () => {
    aiStoreState.providers = [
      {
        id: 1,
        name: "Ollama",
        provider_type: "ollama",
        is_enabled: true,
        health_status: "healthy",
        has_api_key: false,
        default_model: "gemma3:latest",
        base_url: "http://localhost:11434",
      },
    ];
    aiStoreState.modelsCache = {
      1: {
        provider_id: 1,
        provider_name: "Ollama",
        models: [],
        cached: true,
      },
    };

    render(
      <ModelSelector
        selectedModel={null}
        selectedProviderId={null}
        onSelect={vi.fn()}
      />
    );

    expect(
      await screen.findByText(/start ollama and pull gemma3:latest/i)
    ).toBeInTheDocument();
  });

  it("shows a fetch error instead of a perpetual loading state", async () => {
    aiStoreState.providers = [
      {
        id: 2,
        name: "Remote OpenAI",
        provider_type: "openai",
        is_enabled: true,
        health_status: "unhealthy",
        has_api_key: true,
        default_model: "gpt-4o",
        base_url: null,
      },
    ];
    aiStoreState.modelErrors = {
      2: "Failed to load models from provider",
    };

    render(
      <ModelSelector
        selectedModel={null}
        selectedProviderId={null}
        onSelect={vi.fn()}
      />
    );

    expect(
      await screen.findByText(/failed to load models from provider/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });

  it("shows an actionable empty-model hint for a healthy remote provider", async () => {
    aiStoreState.providers = [
      {
        id: 4,
        name: "OpenAI",
        provider_type: "openai",
        is_enabled: true,
        health_status: "healthy",
        has_api_key: true,
        default_model: "gpt-4o",
        base_url: null,
      },
    ];
    aiStoreState.modelsCache = {
      4: {
        provider_id: 4,
        provider_name: "OpenAI",
        models: [],
        cached: true,
      },
    };

    render(
      <ModelSelector
        selectedModel={null}
        selectedProviderId={null}
        onSelect={vi.fn()}
      />
    );

    expect(
      await screen.findByText(/provider responded but returned no models/i)
    ).toBeInTheDocument();
  });

  it("fetches models for enabled providers that are missing from cache", async () => {
    aiStoreState.providers = [
      {
        id: 3,
        name: "LM Studio",
        provider_type: "openai_compat",
        is_enabled: true,
        health_status: "unknown",
        has_api_key: false,
        default_model: "local-model",
        base_url: "http://localhost:1234/v1",
      },
    ];

    render(
      <ModelSelector
        selectedModel={null}
        selectedProviderId={null}
        onSelect={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(fetchModelsMock).toHaveBeenCalledWith(3);
    });
  });

  it("groups CLI providers separately from API providers", async () => {
    aiStoreState.providers = [
      {
        id: 10,
        name: "OpenAI",
        provider_type: "openai",
        is_enabled: true,
        health_status: "healthy",
        has_api_key: true,
        default_model: "gpt-4o",
        base_url: null,
      },
      {
        id: 11,
        name: "Claude Code",
        provider_type: "cli",
        is_enabled: true,
        health_status: "healthy",
        has_api_key: false,
        default_model: "claude-sonnet-4-20250514",
        base_url: null,
        cli_command: "claude",
        parse_mode: "json",
        detected_models: ["claude-sonnet-4-20250514"],
      },
    ];
    aiStoreState.modelsCache = {
      10: {
        provider_id: 10,
        provider_name: "OpenAI",
        models: [{ id: "gpt-4o", name: "gpt-4o" }],
        cached: true,
      },
      11: {
        provider_id: 11,
        provider_name: "Claude Code",
        models: [{ id: "claude-sonnet-4-20250514", name: "claude-sonnet-4-20250514" }],
        cached: true,
      },
    };

    render(
      <ModelSelector
        selectedModel={null}
        selectedProviderId={null}
        onSelect={vi.fn()}
      />
    );

    expect(await screen.findByText(/api providers/i)).toBeInTheDocument();
    expect(screen.getByText(/cli providers/i)).toBeInTheDocument();
    expect(screen.getByText(/openai/i)).toBeInTheDocument();
    expect(screen.getByText(/claude code/i)).toBeInTheDocument();
  });
});
