import { describe, expect, it, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { AIChatLayout } from "../components/AI/AIChatLayout";
import { AIOnboardingState } from "../components/AI/AIOnboardingState";
import { ChatPanel } from "../components/AI/ChatPanel";

const sendMessage = vi.fn();
const cancelMessage = vi.fn();
const useAIChatMock = vi.fn();
const loadMessagesMock = vi.fn();
const createConversationMock = vi.fn();
const createCLISessionMock = vi.fn();
const getConversationCLISessionMock = vi.fn();
const getCLISessionMock = vi.fn();
const importCLISessionMock = vi.fn();
const deleteCLISessionMock = vi.fn();
const startTempChatMock = vi.fn();
const fetchConfigsMock = vi.fn();
const fetchProvidersMock = vi.fn();
const fetchModelsMock = vi.fn();
const fetchRoutingsMock = vi.fn();
const launchAgentMock = vi.fn();
const stopAgentMock = vi.fn();
const consumePromptMock = vi.fn();
const modelSelectorPropsMock = vi.fn();
const chatStoreState = {
  loadMessages: loadMessagesMock,
  activeConversationId: null as string | null,
  isTempChat: false,
  createConversation: createConversationMock,
  startTempChat: startTempChatMock,
  conversations: [] as Array<{ id: string; title: string }>,
};
const aiStoreState = {
  providers: [] as Array<{
    id: number;
    name: string;
    provider_type?: "openai" | "cli";
    is_enabled: boolean;
    health_status: "healthy" | "unhealthy" | "unknown" | null;
    cli_command?: string | null;
  }>,
  hasFetchedProviders: false,
  hasFetchedRoutings: false,
  isLoading: false,
  modelsCache: {} as Record<number, { models: Array<{ id: string }> }>,
  routings: [] as Array<{
    id: number;
    user_id: string;
    project_id: string | null;
    context_type: string;
    provider_config_id: number;
    model: string | null;
  }>,
  fetchProviders: fetchProvidersMock,
  fetchModels: fetchModelsMock,
  fetchRoutings: fetchRoutingsMock,
};
const agentConfigStoreState = {
  configs: [] as Array<{ id: number; is_default?: boolean }>,
  templates: [] as Array<{ id: number; is_default?: boolean }>,
  fetchConfigs: fetchConfigsMock,
};

vi.mock("../hooks/useAIChat", () => ({
  useAIChat: (...args: unknown[]) => useAIChatMock(...args),
}));

vi.mock("../api/ai", () => ({
  aiApi: {
    branchMessage: vi.fn(),
    createCLISession: (...args: unknown[]) => createCLISessionMock(...args),
    getConversationCLISession: (...args: unknown[]) => getConversationCLISessionMock(...args),
    getCLISession: (...args: unknown[]) => getCLISessionMock(...args),
    importCLISession: (...args: unknown[]) => importCLISessionMock(...args),
    deleteCLISession: (...args: unknown[]) => deleteCLISessionMock(...args),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("../hooks/useSpeechToText", () => ({
  useSpeechToText: () => ({
    transcript: "",
    isListening: false,
    isSupported: false,
    startListening: vi.fn(),
    stopListening: vi.fn(),
    resetTranscript: vi.fn(),
  }),
}));

vi.mock("../stores/chatStore", () => ({
  useChatStore: (
    selector?: (
      state: {
        loadMessages: typeof loadMessagesMock;
        activeConversationId: string | null;
        isTempChat: boolean;
        createConversation: typeof createConversationMock;
        startTempChat: typeof startTempChatMock;
        conversations: Array<{ id: string; title: string }>;
      }
    ) => unknown
  ) => {
    return selector ? selector(chatStoreState) : chatStoreState;
  },
}));

vi.mock("../stores/aiStore", () => ({
  useAIStore: (
    selector?: (
      state: {
        providers: Array<{
          id: number;
          name: string;
          provider_type?: "openai" | "cli";
          is_enabled: boolean;
          health_status: "healthy" | "unhealthy" | "unknown" | null;
          cli_command?: string | null;
        }>;
        hasFetchedProviders: boolean;
        hasFetchedRoutings: boolean;
        isLoading: boolean;
        modelsCache: Record<number, { models: Array<{ id: string }> }>;
        routings: Array<{
          id: number;
          user_id: string;
          project_id: string | null;
          context_type: string;
          provider_config_id: number;
          model: string | null;
        }>;
        fetchProviders: typeof fetchProvidersMock;
        fetchModels: typeof fetchModelsMock;
        fetchRoutings: typeof fetchRoutingsMock;
      }
    ) => unknown
  ) => {
    return selector ? selector(aiStoreState) : aiStoreState;
  },
}));

vi.mock("../stores/agentProcessStore", () => ({
  useAgentProcessStore: (
    selector?: (
      state: {
        activeAgentId: number | null;
        isLaunching: boolean;
        launchAgent: typeof launchAgentMock;
        stopAgent: typeof stopAgentMock;
      }
    ) => unknown
  ) => {
    const state = {
      activeAgentId: null,
      isLaunching: false,
      launchAgent: launchAgentMock,
      stopAgent: stopAgentMock,
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock("../stores/agentConfigStore", () => ({
  useAgentConfigStore: (
    selector?: (
      state: {
        configs: Array<{ id: number; is_default?: boolean }>;
        templates: Array<{ id: number; is_default?: boolean }>;
        fetchConfigs: typeof fetchConfigsMock;
      }
    ) => unknown
  ) => {
    return selector ? selector(agentConfigStoreState) : agentConfigStoreState;
  },
}));

vi.mock("../stores/aiComposerStore", () => ({
  useAIComposerStore: (
    selector?: (
      state: {
        pendingPrompt: { text: string; source?: string } | null;
        consumePrompt: typeof consumePromptMock;
      }
    ) => unknown
  ) => {
    const state = {
      pendingPrompt: {
        text: "Summarize the latest audit trail and suggest the next step.",
        source: "timeline",
      },
      consumePrompt: consumePromptMock,
    };
    return selector ? selector(state) : state;
  },
}), { virtual: true });

vi.mock("../components/AI/ModelSelector", () => ({
  ModelSelector: (props: {
    selectedModel: string | null;
    selectedProviderId: number | null;
    onSelect: (model: string, providerId: number) => void;
  }) => {
    modelSelectorPropsMock(props);
    return (
      <button
        type="button"
        data-testid="model-selector"
        onClick={() => props.onSelect("claude-sonnet-4-20250514", 99)}
      >
        Select CLI model
      </button>
    );
  },
}));

vi.mock("../components/AI/ModeToggle", () => ({
  ModeToggle: () => <div data-testid="mode-toggle" />,
}));

vi.mock("../components/AI/AIQuickSettings", () => ({
  AIQuickSettings: (props: { label?: string }) => (
    <button type="button">{props.label ?? "AI Settings"}</button>
  ),
}));

vi.mock("../components/AI/FileAttachmentButton", () => ({
  FileAttachmentButton: () => <div data-testid="file-attachment-button" />,
}));

vi.mock("../components/AI/MessageBubble", () => ({
  MessageBubble: () => null,
  buildActiveBranch: (messages: unknown[]) => messages,
}));

vi.mock("../components/AI/AgentTerminalPanel", () => ({
  AgentTerminalPanel: () => <div data-testid="agent-terminal" />,
}));

vi.mock("../components/AI/AgentConfigSelector", () => ({
  AgentConfigSelector: () => <div data-testid="agent-config-selector" />,
}));

vi.mock("../components/AI/CLITerminalPanel", () => ({
  CLITerminalPanel: (props: { session: { id: string } }) => (
    <div data-testid="cli-terminal-panel">{props.session.id}</div>
  ),
}));

vi.mock("../components/AI/ConversationSidebar", () => ({
  ConversationSidebar: () => <div data-testid="conversation-sidebar" />,
}));

vi.mock("../components/AI/panels/SidePanel", () => ({
  SidePanel: () => <div data-testid="side-panel" />,
}));

describe("AI chat workspace", () => {
  beforeEach(() => {
    sendMessage.mockReset();
    cancelMessage.mockReset();
    useAIChatMock.mockReset();
    loadMessagesMock.mockReset();
    createConversationMock.mockReset();
    createCLISessionMock.mockReset();
    getConversationCLISessionMock.mockReset();
    getCLISessionMock.mockReset();
    importCLISessionMock.mockReset();
    deleteCLISessionMock.mockReset();
    startTempChatMock.mockReset();
    fetchConfigsMock.mockReset();
    fetchProvidersMock.mockReset();
    fetchModelsMock.mockReset();
    fetchRoutingsMock.mockReset();
    launchAgentMock.mockReset();
    stopAgentMock.mockReset();
    vi.mocked(toast.error).mockReset();
    vi.mocked(toast.success).mockReset();
    consumePromptMock.mockReset();
    chatStoreState.activeConversationId = null;
    chatStoreState.isTempChat = false;
    chatStoreState.conversations = [];
    aiStoreState.providers = [];
    aiStoreState.hasFetchedProviders = false;
    aiStoreState.hasFetchedRoutings = false;
    aiStoreState.isLoading = false;
    aiStoreState.modelsCache = {};
    aiStoreState.routings = [];
    agentConfigStoreState.configs = [];
    agentConfigStoreState.templates = [];
    modelSelectorPropsMock.mockReset();
    fetchModelsMock.mockResolvedValue({ models: [] });
    fetchRoutingsMock.mockResolvedValue([]);
    createConversationMock.mockResolvedValue("conv-new");
    getConversationCLISessionMock.mockResolvedValue(null);
    createCLISessionMock.mockResolvedValue({
      id: "cli-1",
      conversation_id: "conv-1",
      provider_config_id: 99,
      terminal_session_id: "term-1",
      terminal_name: "Claude Code Terminal",
      terminal_websocket_url: "ws://localhost:7680/ws",
      terminal_is_alive: true,
      cli_command: "claude",
      status: "running",
      working_directory: null,
      last_imported_at: null,
      started_at: "2026-04-16T00:00:00Z",
      exited_at: null,
    });
    useAIChatMock.mockReturnValue({
      messages: [],
      isConnected: true,
      connectionError: null,
      sendMessage,
      cancelMessage,
    });
  });

  it("hydrates the active chat composer from a seeded prompt", () => {
    render(<ChatPanel projectId="project-1" conversationId={null} />);

    expect(
      screen.getByPlaceholderText("Query PwnPilot context or ask for help...")
    ).toHaveValue(
      "Summarize the latest audit trail and suggest the next step."
    );
    expect(consumePromptMock).toHaveBeenCalledTimes(1);
  });

  it("shows actionable AI connection recovery guidance", () => {
    useAIChatMock.mockReturnValue({
      messages: [],
      isConnected: false,
      connectionError: "WebSocket connection failed",
      sendMessage,
      cancelMessage,
    });

    render(<ChatPanel projectId="project-1" conversationId={null} />);

    expect(screen.getByText("AI connection unavailable")).toBeInTheDocument();
    expect(screen.getByText("WebSocket connection failed")).toBeInTheDocument();
    expect(
      screen.getByText(/Check provider settings, backend connectivity, then retry/i),
    ).toBeInTheDocument();
  });

  it("shows provider onboarding when no AI provider is configured", () => {
    render(<AIChatLayout projectId="project-1" />);

    expect(screen.getByText("No AI provider configured")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open AI Settings" })
    ).toBeInTheDocument();
    expect(fetchProvidersMock).toHaveBeenCalledTimes(1);
  });

  it("offers an agent workspace entry when no AI provider is configured but agent configs exist", () => {
    agentConfigStoreState.configs = [{ id: 7, is_default: true }];

    const onOpenAgentWorkspace = vi.fn();
    render(
      <AIOnboardingState
        {...({
          onNewChat: vi.fn(),
          onOpenAgentWorkspace,
        } as unknown as React.ComponentProps<typeof AIOnboardingState>)}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: /open agent workspace/i })
    );

    expect(onOpenAgentWorkspace).toHaveBeenCalledTimes(1);
  });

  it("keeps the onboarding empty state visible after providers were already fetched", () => {
    aiStoreState.hasFetchedProviders = true;
    aiStoreState.isLoading = true;

    render(<AIChatLayout projectId="project-1" />);

    expect(screen.getByText("No AI provider configured")).toBeInTheDocument();
    expect(screen.queryByText(/Checking AI providers/i)).not.toBeInTheDocument();
  });

  it("keeps the normal chat CTA when at least one provider is available", () => {
    aiStoreState.providers = [
      {
        id: 1,
        name: "OpenAI",
        is_enabled: true,
        health_status: "healthy",
      },
    ];
    render(<AIChatLayout projectId="project-1" />);

    expect(screen.getByRole("button", { name: "New Chat" })).toBeInTheDocument();
  });

  it("auto-starts a temp chat when a global assistant default is configured", () => {
    aiStoreState.providers = [
      {
        id: 7,
        name: "Codex",
        provider_type: "cli",
        is_enabled: true,
        health_status: "healthy",
        cli_command: "codex",
      },
    ];
    aiStoreState.routings = [
      {
        id: 1,
        user_id: "user-1",
        project_id: null,
        context_type: "general",
        provider_config_id: 7,
        model: "gpt-5.4",
      },
    ];
    aiStoreState.hasFetchedRoutings = true;

    render(<AIChatLayout projectId="project-1" />);

    expect(startTempChatMock).toHaveBeenCalledTimes(1);
  });

  it("seeds the chat panel model selector from the configured default selection", () => {
    render(
      <ChatPanel
        projectId="project-1"
        conversationId={null}
        defaultSelection={{ providerId: 7, model: "gpt-5.4" }}
      />
    );

    expect(modelSelectorPropsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedModel: "gpt-5.4",
        selectedProviderId: 7,
      })
    );
  });

  it("shows enabled provider names when all configured providers need attention", () => {
    aiStoreState.providers = [
      {
        id: 1,
        name: "Ollama",
        is_enabled: true,
        health_status: "unhealthy",
      },
    ];

    render(<AIChatLayout projectId="project-1" />);

    expect(
      screen.getByText(/configured providers need attention/i)
    ).toBeInTheDocument();
    expect(screen.getAllByText(/ollama/i).length).toBeGreaterThan(0);
  });

  it("auto-launches agent mode when the chat panel is opened in agent workspace mode", () => {
    agentConfigStoreState.configs = [{ id: 7, is_default: true }];

    render(
      <ChatPanel
        {...({
          projectId: "project-1",
          conversationId: null,
          initialMode: "agent",
        } as unknown as React.ComponentProps<typeof ChatPanel>)}
      />
    );

    expect(launchAgentMock).toHaveBeenCalledWith({
      config_id: 7,
      project_id: "project-1",
      prompt: "",
      output_mode: "terminal",
    });
  });

  it("opens an embedded CLI terminal for the selected provider", async () => {
    aiStoreState.providers = [
      {
        id: 99,
        name: "Claude Code",
        provider_type: "cli",
        is_enabled: true,
        health_status: "healthy",
        cli_command: "claude",
      },
    ];
    chatStoreState.conversations = [{ id: "conv-1", title: "Recon Notes" }];

    render(<ChatPanel projectId="project-1" conversationId="conv-1" />);

    fireEvent.click(screen.getByTestId("model-selector"));
    fireEvent.click(await screen.findByRole("button", { name: /open in terminal/i }));

    expect(createCLISessionMock).toHaveBeenCalledWith({
      conversation_id: "conv-1",
      provider_config_id: 99,
    });
    const terminalPanels = await screen.findAllByTestId("cli-terminal-panel");
    expect(terminalPanels.some((panel) => panel.textContent?.includes("cli-1"))).toBe(true);
  });

  it("shows backend details when opening a CLI terminal fails", async () => {
    aiStoreState.providers = [
      {
        id: 99,
        name: "Claude Code",
        provider_type: "cli",
        is_enabled: true,
        health_status: "healthy",
        cli_command: "claude",
      },
    ];
    chatStoreState.conversations = [{ id: "conv-1", title: "Recon Notes" }];
    createCLISessionMock.mockRejectedValueOnce({
      response: {
        data: {
          error: {
            message: "Claude Code CLI is not available in PATH.",
          },
        },
      },
    });

    render(<ChatPanel projectId="project-1" conversationId="conv-1" />);

    fireEvent.click(screen.getByTestId("model-selector"));
    fireEvent.click(await screen.findByRole("button", { name: /open in terminal/i }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Failed to open the CLI terminal.", {
        description: "Claude Code CLI is not available in PATH.",
      }),
    );
  });
});
