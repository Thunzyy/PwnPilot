import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AISettings } from "../AISettings";
import { useAIStore } from "@/stores/aiStore";
import type {
  AIContextRouting,
  AIProvider,
  AIProviderCreate,
  AIProviderUpdate,
  DetectedCLIProvider,
  HealthCheckResult,
  ModelsListResponse,
} from "@/types/ai";

const listProvidersMock = vi.fn<() => Promise<AIProvider[]>>();
const createProviderMock = vi.fn<(data: AIProviderCreate) => Promise<AIProvider>>();
const updateProviderMock = vi.fn<
  (id: number, data: AIProviderUpdate) => Promise<AIProvider>
>();
const deleteProviderMock = vi.fn<(id: number) => Promise<void>>();
const testProviderMock = vi.fn<(id: number) => Promise<HealthCheckResult>>();
const listModelsMock = vi.fn<(id: number) => Promise<ModelsListResponse>>();
const detectCLIProvidersMock = vi.fn<() => Promise<DetectedCLIProvider[]>>();
const resolveCLIProviderMock = vi.fn<
  (command: string) => Promise<DetectedCLIProvider | null>
>();
const listRoutingMock = vi.fn<() => Promise<AIContextRouting[]>>();
const updateRoutingMock = vi.fn<(data: AIContextRouting[]) => Promise<AIContextRouting[]>>();

vi.mock("@/api/ai", () => ({
  aiApi: {
    listProviders: () => listProvidersMock(),
    createProvider: (data: AIProviderCreate) => createProviderMock(data),
    updateProvider: (id: number, data: AIProviderUpdate) =>
      updateProviderMock(id, data),
    deleteProvider: (id: number) => deleteProviderMock(id),
    testProvider: (id: number) => testProviderMock(id),
    listModels: (id: number) => listModelsMock(id),
    detectCLIProviders: () => detectCLIProvidersMock(),
    resolveCLIProvider: (command: string) => resolveCLIProviderMock(command),
    listRouting: () => listRoutingMock(),
    updateRouting: (data: AIContextRouting[]) => updateRoutingMock(data),
  },
}));

function buildProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    id: 1,
    user_id: "user-1",
    provider_type: "ollama",
    name: "Ollama",
    is_enabled: true,
    base_url: "http://localhost:11434",
    has_api_key: false,
    custom_headers: null,
    timeout_seconds: 30,
    default_model: "gemma3:latest",
    temperature: 0.7,
    max_tokens: 4096,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    last_health_check: null,
    health_status: null,
    cli_command: null,
    cli_args_template: null,
    cli_interactive_args: null,
    cli_env: null,
    working_directory: null,
    parse_mode: null,
    supports_streaming: false,
    supports_resume: false,
    session_flag: null,
    detected_version: null,
    detected_models: null,
    created_at: "2026-04-11T00:00:00Z",
    updated_at: "2026-04-11T00:00:00Z",
    ...overrides,
  };
}

function buildDetectedCLIProvider(
  overrides: Partial<DetectedCLIProvider> = {}
): DetectedCLIProvider {
  return {
    provider_type: "cli",
    name: "Claude Code",
    default_model: "claude-sonnet-4-20250514",
    cli_command: "claude",
    cli_args_template: "-p {prompt} --output-format json --model {model}",
    cli_interactive_args: "--resume {session_id}",
    cli_env: null,
    working_directory: null,
    parse_mode: "json",
    supports_streaming: true,
    supports_resume: true,
    session_flag: "--resume",
    detected_version: "1.2.3",
    detected_models: ["claude-sonnet-4-20250514"],
    ...overrides,
  };
}

describe("AISettings", () => {
  beforeEach(() => {
    listProvidersMock.mockReset();
    createProviderMock.mockReset();
    updateProviderMock.mockReset();
    deleteProviderMock.mockReset();
    testProviderMock.mockReset();
    listModelsMock.mockReset();
    detectCLIProvidersMock.mockReset();
    resolveCLIProviderMock.mockReset();
    listRoutingMock.mockReset();
    updateRoutingMock.mockReset();

    listProvidersMock.mockResolvedValue([]);
    updateProviderMock.mockRejectedValue(new Error("not implemented"));
    deleteProviderMock.mockRejectedValue(new Error("not implemented"));
    testProviderMock.mockRejectedValue(new Error("not implemented"));
    listModelsMock.mockRejectedValue(new Error("not implemented"));
    detectCLIProvidersMock.mockResolvedValue([]);
    resolveCLIProviderMock.mockResolvedValue(null);
    listRoutingMock.mockResolvedValue([]);
    updateRoutingMock.mockImplementation(async (data) => data);

    useAIStore.setState({
      providers: [],
      routings: [],
      healthResults: {},
      modelsCache: {},
      hasFetchedRoutings: false,
      hasFetchedProviders: false,
      isLoading: false,
      error: null,
    });
  });

  it("quick-adds the local Ollama preset and renders the provider card", async () => {
    const provider = buildProvider();
    createProviderMock.mockResolvedValue(provider);

    render(<AISettings />);

    await waitFor(() => {
      expect(listProvidersMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: /^ollama$/i }));

    await waitFor(() => {
      expect(createProviderMock).toHaveBeenCalledWith({
        provider_type: "ollama",
        name: "Ollama",
        default_model: "gemma3:latest",
        base_url: "http://localhost:11434",
      });
    });

    expect(
      await screen.findByText(/gemma3:latest .* http:\/\/localhost:11434/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No AI providers configured")
    ).not.toBeInTheDocument();
  });

  it("shows a runtime hint for unhealthy local Ollama providers", async () => {
    listProvidersMock.mockResolvedValue([
      buildProvider({
        health_status: "unhealthy",
      }),
    ]);

    render(<AISettings />);

    expect(
      await screen.findByText(/ensure ollama is running/i)
    ).toBeInTheDocument();
  });

  it("surfaces a slow-runtime hint after a healthy provider test", async () => {
    listProvidersMock.mockResolvedValue([
      buildProvider({
        id: 9,
        provider_type: "openai",
        name: "OpenAI",
        default_model: "gpt-4o",
        has_api_key: true,
        base_url: null,
        health_status: "healthy",
      }),
    ]);
    testProviderMock.mockResolvedValue({
      provider_id: 9,
      status: "healthy",
      latency_ms: 1800,
      error_message: null,
      checked_at: "2026-04-13T09:00:00Z",
    });

    render(<AISettings />);

    fireEvent.click(await screen.findByRole("button", { name: /test provider/i }));

    expect(
      await screen.findByText(/provider reachable but slow \(1800 ms\)/i)
    ).toBeInTheDocument();
  });

  it("detects installed CLI tools and lets the user add one directly", async () => {
    detectCLIProvidersMock.mockResolvedValue([buildDetectedCLIProvider()]);
    createProviderMock.mockResolvedValue(
      buildProvider({
        id: 7,
        provider_type: "cli",
        name: "Claude Code",
        default_model: "claude-sonnet-4-20250514",
        base_url: null,
        cli_command: "claude",
        parse_mode: "json",
        supports_streaming: true,
        supports_resume: true,
        session_flag: "--resume",
        detected_version: "1.2.3",
        detected_models: ["claude-sonnet-4-20250514"],
      })
    );

    render(<AISettings />);

    fireEvent.click(await screen.findByRole("button", { name: /detect cli tools/i }));

    expect(await screen.findByText(/claude code/i)).toBeInTheDocument();
    expect(screen.getByText(/1\.2\.3/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /add detected cli claude code/i }));

    await waitFor(() => {
      expect(createProviderMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider_type: "cli",
          name: "Claude Code",
          cli_command: "claude",
          parse_mode: "json",
          detected_models: ["claude-sonnet-4-20250514"],
        })
      );
    });
  });

  it("hides already-added detected CLI models and defaults to the newest remaining model", async () => {
    listProvidersMock.mockResolvedValue([
      buildProvider({
        id: 21,
        provider_type: "cli",
        name: "Claude Code",
        default_model: "claude-sonnet-4-20250201",
        base_url: null,
        cli_command: "claude",
        parse_mode: "json",
        supports_streaming: true,
        supports_resume: true,
        session_flag: "--resume",
      }),
    ]);
    detectCLIProvidersMock.mockResolvedValue([
      buildDetectedCLIProvider({
        default_model: "claude-sonnet-4-20250115",
        detected_models: [
          "claude-sonnet-4-20250201",
          "claude-opus-4-20250411",
          "claude-sonnet-4-20250115",
        ],
      }),
    ]);
    createProviderMock.mockResolvedValue(
      buildProvider({
        id: 22,
        provider_type: "cli",
        name: "Claude Code",
        default_model: "claude-opus-4-20250411",
        base_url: null,
        cli_command: "claude",
        parse_mode: "json",
        supports_streaming: true,
        supports_resume: true,
        session_flag: "--resume",
      })
    );

    render(<AISettings />);

    fireEvent.click(await screen.findByRole("button", { name: /detect cli tools/i }));

    const detectedModelSelect = await screen.findByLabelText(
      /default model for detected cli claude code/i
    );

    expect(detectedModelSelect).toHaveValue("claude-opus-4-20250411");
    expect(
      screen.queryByRole("option", { name: "claude-sonnet-4-20250201" })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /add detected cli claude code/i }));

    await waitFor(() => {
      expect(createProviderMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider_type: "cli",
          name: "Claude Code",
          default_model: "claude-opus-4-20250411",
          cli_command: "claude",
        })
      );
    });
  });

  it("removes a detected CLI from add flow once all of its models are already configured", async () => {
    listProvidersMock.mockResolvedValue([
      buildProvider({
        id: 31,
        provider_type: "cli",
        name: "Claude Code",
        default_model: "claude-sonnet-4-20250514",
        base_url: null,
        cli_command: "claude",
        parse_mode: "json",
      }),
      buildProvider({
        id: 32,
        provider_type: "cli",
        name: "Claude Code",
        default_model: "claude-opus-4-20250514",
        base_url: null,
        cli_command: "claude",
        parse_mode: "json",
      }),
    ]);
    detectCLIProvidersMock.mockResolvedValue([
      buildDetectedCLIProvider({
        detected_models: [
          "claude-sonnet-4-20250514",
          "claude-opus-4-20250514",
        ],
      }),
    ]);

    render(<AISettings />);

    fireEvent.click(await screen.findByRole("button", { name: /detect cli tools/i }));

    await waitFor(() => {
      expect(detectCLIProvidersMock).toHaveBeenCalledTimes(1);
    });

    expect(
      screen.queryByRole("button", { name: /add detected cli claude code/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/detected cli tools/i)).not.toBeInTheDocument();
  });

  it("resolves a manual CLI command and creates the provider without a typed model", async () => {
    resolveCLIProviderMock.mockResolvedValue({
      provider_type: "cli",
      name: "Claude Code",
      default_model: "claude-sonnet-4-20250514",
      cli_command: String.raw`C:\Users\operator\.local\bin\claude.exe`,
      cli_args_template: "-p {prompt} --output-format json --model {model}",
      cli_interactive_args: "--resume {session_id}",
      cli_env: null,
      working_directory: null,
      parse_mode: "json",
      supports_streaming: true,
      supports_resume: true,
      session_flag: "--resume",
      detected_version: "1.2.3",
      detected_models: ["claude-sonnet-4-20250514", "claude-opus-4-20250514"],
    });
    createProviderMock.mockResolvedValue(
      buildProvider({
        id: 11,
        provider_type: "cli",
        name: "Claude Code",
        default_model: "claude-sonnet-4-20250514",
        base_url: null,
        cli_command: String.raw`C:\Users\operator\.local\bin\claude.exe`,
        parse_mode: "json",
        supports_streaming: true,
        supports_resume: true,
        session_flag: "--resume",
        detected_version: "1.2.3",
        detected_models: ["claude-sonnet-4-20250514", "claude-opus-4-20250514"],
      })
    );

    render(<AISettings />);

    fireEvent.click(await screen.findByRole("button", { name: /add provider/i }));
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "cli" },
    });
    fireEvent.change(screen.getByPlaceholderText("CLI command"), {
      target: { value: String.raw`C:\Users\operator\.local\bin\claude.exe` },
    });
    fireEvent.click(screen.getByRole("button", { name: /add provider/i }));

    await waitFor(() => {
      expect(resolveCLIProviderMock).toHaveBeenCalledWith(
        String.raw`C:\Users\operator\.local\bin\claude.exe`
      );
    });

    await waitFor(() => {
      expect(createProviderMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider_type: "cli",
          name: "Claude Code",
          default_model: "claude-sonnet-4-20250514",
          cli_command: String.raw`C:\Users\operator\.local\bin\claude.exe`,
          cli_args_template: "-p {prompt} --output-format json --model {model}",
          cli_interactive_args: "--resume {session_id}",
          parse_mode: "json",
          detected_models: ["claude-sonnet-4-20250514", "claude-opus-4-20250514"],
        })
      );
    });
  });

  it("auto-detects a manual CLI command while typing", async () => {
    resolveCLIProviderMock.mockResolvedValue({
      provider_type: "cli",
      name: "Claude Code",
      default_model: "claude-sonnet-4-20240101",
      cli_command: String.raw`C:\Users\operator\.local\bin\claude.EXE`,
      cli_args_template: "-p {prompt} --output-format json --model {model}",
      cli_interactive_args: "--resume {session_id}",
      cli_env: null,
      working_directory: null,
      parse_mode: "json",
      supports_streaming: true,
      supports_resume: true,
      session_flag: "--resume",
      detected_version: "1.2.3",
      detected_models: ["claude-sonnet-4-20240101", "claude-opus-4-20250514"],
    });

    render(<AISettings />);

    fireEvent.click(await screen.findByRole("button", { name: /add provider/i }));
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "cli" },
    });
    fireEvent.change(screen.getByPlaceholderText("CLI command"), {
      target: { value: String.raw`C:\Users\operator\.local\bin\claude.EXE` },
    });

    await waitFor(() => {
      expect(resolveCLIProviderMock).toHaveBeenCalledWith(
        String.raw`C:\Users\operator\.local\bin\claude.EXE`
      );
    });

    expect(await screen.findByDisplayValue("Claude Code")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Default model")).toHaveValue(
      "claude-opus-4-20250514"
    );
    expect(screen.getByLabelText(/detected cli models/i)).toHaveValue(
      "claude-opus-4-20250514"
    );
    expect(
      screen.getByText(/Detected .*Claude Code/i)
    ).toBeInTheDocument();
  });

  it("prefills the newest detected CLI model and lets the user choose another default model", async () => {
    resolveCLIProviderMock.mockResolvedValue(
      buildDetectedCLIProvider({
        default_model: "claude-sonnet-4-20240101",
        cli_command: String.raw`C:\Users\operator\.local\bin\claude.EXE`,
        detected_models: [
          "claude-sonnet-4-20240101",
          "claude-opus-4-20250514",
          "claude-sonnet-4-20250301",
        ],
      })
    );
    createProviderMock.mockResolvedValue(
      buildProvider({
        id: 41,
        provider_type: "cli",
        name: "Claude Code",
        default_model: "claude-sonnet-4-20240101",
        base_url: null,
        cli_command: String.raw`C:\Users\operator\.local\bin\claude.EXE`,
        parse_mode: "json",
      })
    );

    render(<AISettings />);

    fireEvent.click(await screen.findByRole("button", { name: /add provider/i }));
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "cli" },
    });
    fireEvent.change(screen.getByPlaceholderText("CLI command"), {
      target: { value: String.raw`C:\Users\operator\.local\bin\claude.EXE` },
    });

    await waitFor(() => {
      expect(resolveCLIProviderMock).toHaveBeenCalledWith(
        String.raw`C:\Users\operator\.local\bin\claude.EXE`
      );
    });

    expect(screen.getByPlaceholderText("Default model")).toHaveValue(
      "claude-opus-4-20250514"
    );
    expect(screen.getByLabelText(/detected cli models/i)).toHaveValue(
      "claude-opus-4-20250514"
    );

    fireEvent.change(screen.getByLabelText(/detected cli models/i), {
      target: { value: "claude-sonnet-4-20240101" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add provider/i }));

    await waitFor(() => {
      expect(createProviderMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider_type: "cli",
          default_model: "claude-sonnet-4-20240101",
          cli_command: String.raw`C:\Users\operator\.local\bin\claude.EXE`,
        })
      );
    });
  });

  it("prefers the detected Codex default model over unsupported latest aliases", async () => {
    resolveCLIProviderMock.mockResolvedValue(
      buildDetectedCLIProvider({
        name: "Codex",
        default_model: "gpt-5.4",
        cli_command: "/home/operator/.npm-global/bin/codex",
        parse_mode: "json",
        supports_streaming: true,
        detected_models: [
          "gpt-5.4",
          "gpt-5.4-mini",
          "codex-mini-latest",
        ],
      })
    );

    render(<AISettings />);

    fireEvent.click(await screen.findByRole("button", { name: /add provider/i }));
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "cli" },
    });
    fireEvent.change(screen.getByPlaceholderText("CLI command"), {
      target: { value: "/home/operator/.npm-global/bin/codex" },
    });

    await waitFor(() => {
      expect(resolveCLIProviderMock).toHaveBeenCalledWith(
        "/home/operator/.npm-global/bin/codex"
      );
    });

    expect(screen.getByPlaceholderText("Default model")).toHaveValue("gpt-5.4");
    expect(screen.getByLabelText(/detected cli models/i)).toHaveValue("gpt-5.4");
  });

  it("shows and saves global routing defaults per feature", async () => {
    listProvidersMock.mockResolvedValue([
      buildProvider({
        id: 3,
        provider_type: "openai_compat",
        name: "Gemini",
        default_model: "gemini-2.5-pro",
        base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
      }),
      buildProvider({
        id: 7,
        provider_type: "cli",
        name: "Codex",
        default_model: "gpt-5.4",
        base_url: null,
        cli_command: "codex",
        parse_mode: "json",
      }),
    ]);
    listRoutingMock.mockResolvedValue([
      {
        id: 11,
        user_id: "user-1",
        project_id: null,
        context_type: "general",
        provider_config_id: 3,
        model: "gemini-2.5-pro",
      },
    ]);

    render(<AISettings />);

    expect(await screen.findByText(/default routing/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/provider for attack graph/i), {
      target: { value: "7" },
    });
    fireEvent.change(screen.getByLabelText(/model for attack graph/i), {
      target: { value: "gpt-5.4" },
    });
    fireEvent.change(screen.getByLabelText(/provider for reports/i), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText(/model for reports/i), {
      target: { value: "gemini-2.5-pro" },
    });

    fireEvent.click(screen.getByRole("button", { name: /save default routing/i }));

    await waitFor(() => {
      expect(updateRoutingMock).toHaveBeenCalledWith([
        {
          context_type: "general",
          provider_config_id: 3,
          model: "gemini-2.5-pro",
          project_id: null,
        },
        {
          context_type: "graph",
          provider_config_id: 7,
          model: "gpt-5.4",
          project_id: null,
        },
        {
          context_type: "reporting",
          provider_config_id: 3,
          model: "gemini-2.5-pro",
          project_id: null,
        },
      ]);
    });
  });
});
