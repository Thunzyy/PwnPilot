import {
  useState,
  useRef,
  useEffect,
  useEffectEvent,
  type KeyboardEvent,
} from "react";
import { Bot, Send, Square, WifiOff, Mic, MicOff, Loader2, TerminalSquare } from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { showApiErrorToast } from "@/lib/apiToast";
import { cn } from "@/lib/utils";
import { useAIChat } from "@/hooks/useAIChat";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { useAIStore } from "@/stores/aiStore";
import { useChatStore } from "@/stores/chatStore";
import { useAgentProcessStore } from "@/stores/agentProcessStore";
import { useAgentConfigStore } from "@/stores/agentConfigStore";
import { useAIComposerStore } from "@/stores/aiComposerStore";
import { aiApi } from "@/api/ai";
import { ModelSelector } from "./ModelSelector";
import { ModeToggle } from "./ModeToggle";
import { AIQuickSettings } from "./AIQuickSettings";
import { CLITerminalPanel } from "./CLITerminalPanel";
import { ChatExportDialog } from "./ChatExportDialog";
import { FileAttachmentButton } from "./FileAttachmentButton";
import { MessageBubble, buildActiveBranch } from "./MessageBubble";
import { AgentTerminalPanel } from "./AgentTerminalPanel";
import { AgentConfigSelector } from "./AgentConfigSelector";
import type { AgentConfig } from "@/types/agent";
import type { CLISession, PendingAttachment } from "@/types/ai";

interface ChatPanelProps {
  projectId: string | null;
  conversationId: string | null;
  defaultSelection?: { providerId: number; model: string } | null;
  initialMode?: 'question' | 'agent';
}

export function ChatPanel({
  projectId,
  conversationId,
  defaultSelection = null,
  initialMode = 'question',
}: ChatPanelProps) {
  const { messages, isConnected, connectionError, sendMessage, cancelMessage } = useAIChat(projectId, conversationId);
  const loadMessages = useChatStore((s) => s.loadMessages);
  const createConversation = useChatStore((s) => s.createConversation);
  const conversations = useChatStore((s) => s.conversations);
  const conversationTitle = useChatStore((s) =>
    conversationId
      ? s.conversations.find((conversation) => conversation.id === conversationId)?.title ?? "Conversation"
      : null
  );
  const providers = useAIStore((s) => s.providers);

  const streamingMessage = messages.find((m) => m.isStreaming);

  const [input, setInput] = useState("");
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<number | null>(null);
  const [cliSession, setCliSession] = useState<CLISession | null>(null);
  const [isStartingCliSession, setIsStartingCliSession] = useState(false);
  const [isImportingCliSession, setIsImportingCliSession] = useState(false);
  const [isClosingCliSession, setIsClosingCliSession] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [mode, setMode] = useState<'question' | 'agent'>(initialMode);
  const [activeBranches, setActiveBranches] = useState<Record<string, string>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastAppliedPromptRef = useRef<string | null>(null);
  const speech = useSpeechToText();
  const seededSelectionScopeRef = useRef<string | null>(null);

  // Agent process state
  const activeAgentId = useAgentProcessStore((s) => s.activeAgentId);
  const isLaunching = useAgentProcessStore((s) => s.isLaunching);
  const launchAgent = useAgentProcessStore((s) => s.launchAgent);
  const stopAgent = useAgentProcessStore((s) => s.stopAgent);

  // Agent configs - fetch once so we can auto-select default
  const configs = useAgentConfigStore((s) => s.configs);
  const fetchConfigs = useAgentConfigStore((s) => s.fetchConfigs);
  const [selectedConfigId, setSelectedConfigId] = useState<number | null>(null);
  const pendingPrompt = useAIComposerStore((s) => s.pendingPrompt);
  const consumePrompt = useAIComposerStore((s) => s.consumePrompt);
  const defaultConfigId =
    configs.find((config) => config.is_default)?.id ?? configs[0]?.id ?? null;
  const effectiveSelectedConfigId = selectedConfigId ?? defaultConfigId;

  useEffect(() => {
    if (configs.length === 0) fetchConfigs(projectId ?? undefined);
  }, [configs.length, fetchConfigs, projectId]);

  // Auto-launch agent when switching to agent mode
  const launchedRef = useRef(false);
  useEffect(() => {
    if (mode !== 'agent') { launchedRef.current = false; return; }
    if (launchedRef.current || isLaunching || activeAgentId) return;
    if (!effectiveSelectedConfigId || !projectId) return;

    launchedRef.current = true;
    launchAgent({ config_id: effectiveSelectedConfigId, project_id: projectId, prompt: '', output_mode: 'terminal' });
  }, [mode, effectiveSelectedConfigId, projectId, isLaunching, activeAgentId, launchAgent]);

  // Switch to a different agent config
  const handleSwitchConfig = async (config: AgentConfig) => {
    if (config.id === effectiveSelectedConfigId && activeAgentId) return;
    setSelectedConfigId(config.id);
    if (activeAgentId) {
      try { await stopAgent(activeAgentId); } catch { /* ignore */ }
    }
    launchedRef.current = true;
    if (projectId) {
      launchAgent({ config_id: config.id, project_id: projectId, prompt: '', output_mode: 'terminal' });
    }
  };

  useEffect(() => {
    if (conversationId) loadMessages(conversationId);
  }, [conversationId, loadMessages]);

  useEffect(() => {
    if (!conversationId) {
      setCliSession(null);
      return;
    }

    let cancelled = false;

    const loadCLISession = async () => {
      try {
        const session = await aiApi.getConversationCLISession(conversationId);
        if (!cancelled) {
          setCliSession(session);
        }
      } catch {
        if (!cancelled) {
          setCliSession(null);
        }
      }
    };

    void loadCLISession();

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const applyPendingPrompt = useEffectEvent((text: string) => {
    setInput(text);
    consumePrompt();
  });

  useEffect(() => {
    if (!pendingPrompt?.text) return;
    if (lastAppliedPromptRef.current === pendingPrompt.text) return;
    lastAppliedPromptRef.current = pendingPrompt.text;
    applyPendingPrompt(pendingPrompt.text);
  }, [pendingPrompt]);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  const inputValue = speech.transcript || input;

  const visibleMessages = buildActiveBranch(messages, activeBranches);
  const activeConversation = conversationId
    ? conversations.find((conversation) => conversation.id === conversationId) ?? null
    : null;
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? null;
  const cliSessionProvider =
    providers.find((provider) => provider.id === cliSession?.provider_config_id) ?? null;
  const canOpenInTerminal =
    Boolean(conversationId) &&
    selectedProvider?.provider_type === "cli" &&
    Boolean(selectedProvider.cli_command);
  const showCLITerminal =
    Boolean(cliSession?.terminal_session_id) &&
    Boolean(cliSession?.terminal_websocket_url) &&
    cliSession?.status !== "exited";

  useEffect(() => {
    const scopeKey = conversationId
      ? `conversation:${conversationId}:${activeConversation?.provider_config_id ?? "none"}:${activeConversation?.model ?? "none"}`
      : `default:${defaultSelection?.providerId ?? "none"}:${defaultSelection?.model ?? "none"}`;

    if (seededSelectionScopeRef.current === scopeKey) {
      return;
    }

    if (activeConversation?.provider_config_id && activeConversation.model) {
      setSelectedProviderId(activeConversation.provider_config_id);
      setSelectedModel(activeConversation.model);
      seededSelectionScopeRef.current = scopeKey;
      return;
    }

    if (!conversationId && defaultSelection) {
      setSelectedProviderId(defaultSelection.providerId);
      setSelectedModel(defaultSelection.model);
      seededSelectionScopeRef.current = scopeKey;
    }
  }, [
    activeConversation?.model,
    activeConversation?.provider_config_id,
    conversationId,
    defaultSelection,
  ]);

  const handleSend = () => {
    const text = inputValue.trim();
    if (!text || !isConnected) return;
    const attachmentIds = attachments.filter((a) => a.status === "done" && a.serverAttachment).map((a) => a.serverAttachment!.id);
    sendMessage(text, { attachmentIds, model: selectedModel ?? undefined, providerId: selectedProviderId ?? undefined, mode });
    setInput("");
    setAttachments([]);
    if (speech.isListening) speech.stopListening();
    speech.resetTranscript();
  };

  const handleStop = () => { if (streamingMessage) cancelMessage(streamingMessage.id); };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
    if (e.key === "Escape" && streamingMessage) { e.preventDefault(); handleStop(); }
  };

  const handleEdit = async (messageId: string, newContent: string) => {
    if (!conversationId) return;
    try {
      await aiApi.branchMessage(conversationId, messageId, newContent);
      sendMessage(newContent, { model: selectedModel ?? undefined, providerId: selectedProviderId ?? undefined, mode });
      await loadMessages(conversationId);
    } catch {
      sendMessage(newContent, { model: selectedModel ?? undefined, providerId: selectedProviderId ?? undefined, mode });
    }
  };

  const handleSiblingSwitch = (targetId: string) => {
    const target = messages.find((m) => m.id === targetId);
    if (!target) return;
    setActiveBranches((prev) => ({ ...prev, [target.parentId ?? "__root"]: targetId }));
  };

  const handleOpenInTerminal = async () => {
    if (!selectedProvider || selectedProvider.provider_type !== "cli") return;

    setIsStartingCliSession(true);
    try {
      const targetConversationId =
        conversationId ?? (await createConversation(projectId, {
          model: selectedModel ?? undefined,
          providerConfigId: selectedProvider.id,
        }));
      const session = await aiApi.createCLISession({
        conversation_id: targetConversationId,
        provider_config_id: selectedProvider.id,
      });
      setCliSession(session);
    } catch (error) {
      showApiErrorToast(
        "Failed to open the CLI terminal.",
        error,
        "Could not start the selected CLI provider.",
      );
    } finally {
      setIsStartingCliSession(false);
    }
  };

  const handleImportCLISession = async () => {
    if (!cliSession || !conversationId) return;

    setIsImportingCliSession(true);
    try {
      const result = await aiApi.importCLISession(cliSession.id);
      await loadMessages(conversationId);
      const refreshedSession = await aiApi.getCLISession(cliSession.id);
      setCliSession(refreshedSession);
      toast.success(
        result.imported_commands > 0
          ? `Imported ${result.imported_commands} terminal command${result.imported_commands > 1 ? "s" : ""}.`
          : "No new terminal commands to import."
      );
    } catch (error) {
      showApiErrorToast(
        "Failed to import terminal history.",
        error,
        "Could not import the CLI terminal history.",
      );
    } finally {
      setIsImportingCliSession(false);
    }
  };

  const handleCloseCLISession = async () => {
    if (!cliSession) return;

    setIsClosingCliSession(true);
    try {
      await aiApi.deleteCLISession(cliSession.id);
      setCliSession(null);
    } catch (error) {
      showApiErrorToast(
        "Failed to close the CLI terminal.",
        error,
        "Could not close the CLI terminal session.",
      );
    } finally {
      setIsClosingCliSession(false);
    }
  };

  // Agent mode: show terminal or launching state
  const showAgentTerminal = mode === 'agent' && activeAgentId !== null;
  const showAgentLaunching = mode === 'agent' && (isLaunching || (!activeAgentId && configs.length > 0));

  // Agent mode: full-screen terminal, no input bar
  if (showAgentLaunching && !activeAgentId) {
    return (
      <div className="flex-1 flex flex-col bg-[#0b0f17] overflow-hidden">
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <Loader2 className="h-8 w-8 text-primary animate-spin" />
          <span className="text-sm text-slate-400">Launching agent...</span>
        </div>
        <div className="px-6 py-3 border-t border-white/5 flex items-center gap-2">
          <ModeToggle mode={mode} onChange={setMode} />
          <AgentConfigSelector selectedConfigId={effectiveSelectedConfigId} onSelect={handleSwitchConfig} />
        </div>
      </div>
    );
  }

  if (showAgentTerminal) {
    return (
      <div className="flex-1 flex flex-col bg-[#0b0f17] overflow-hidden">
        <AgentTerminalPanel agentId={activeAgentId} />
        <div className="px-6 py-3 border-t border-white/5 flex items-center gap-2">
          <ModeToggle mode={mode} onChange={setMode} />
          <AgentConfigSelector selectedConfigId={effectiveSelectedConfigId} onSelect={handleSwitchConfig} />
        </div>
      </div>
    );
  }

  // No agent configs found - show message
  if (mode === 'agent' && configs.length === 0) {
    return (
      <div className="flex-1 flex flex-col bg-[#0b0f17] overflow-hidden">
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-500">
          <Bot className="h-10 w-10 opacity-20" />
          <p className="text-sm">No agent configured</p>
          <p className="text-xs">Go to Settings to add an agent</p>
        </div>
        <div className="px-6 py-3 border-t border-white/5 flex items-center gap-2">
          <ModeToggle mode={mode} onChange={setMode} />
        </div>
      </div>
    );
  }

  const chatContent = (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="flex-1 p-6">
        <div ref={scrollRef} className="max-w-4xl mx-auto space-y-8 pb-4">
          {visibleMessages.length === 0 && !connectionError && (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500">
              <Bot className="h-12 w-12 mb-4 opacity-20" />
              <p className="text-sm font-medium">No messages yet</p>
              <p className="text-xs mt-1">{isConnected ? "Type a message to start chatting" : "Connecting..."}</p>
            </div>
          )}
          {connectionError && visibleMessages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500">
              <WifiOff className="h-12 w-12 mb-4 opacity-20 text-red-400" />
              <p className="text-sm font-medium text-red-400">
                AI connection unavailable
              </p>
              <p className="text-xs mt-1">{connectionError}</p>
              <p className="mt-2 max-w-md text-center text-xs leading-5 text-slate-600">
                Check provider settings, backend connectivity, then retry.
              </p>
            </div>
          )}
          {visibleMessages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              allMessages={messages}
              conversationId={conversationId}
              onEdit={handleEdit}
              onSiblingSwitch={handleSiblingSwitch}
            />
          ))}
        </div>
      </ScrollArea>

      <div className="border-white/5 p-6 backdrop-blur-md">
        <div className="max-w-4xl mx-auto">
          {attachments.length > 0 && (
            <div className="mb-3">
              <FileAttachmentButton attachments={attachments} onAttachmentsChange={setAttachments} disabled={!isConnected} />
            </div>
          )}
          <Card className="relative flex flex-col bg-white/[0.02] border-white/10 p-2 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all shadow-lg rounded-xl">
            <textarea
              className="w-full bg-transparent border-none focus:ring-0 p-3 min-h-[50px] max-h-[160px] resize-none text-sm text-slate-200 placeholder-slate-500 focus:outline-none"
              placeholder={isConnected ? "Query PwnPilot context or ask for help..." : "Waiting for connection..."}
              rows={1}
              value={inputValue}
              onChange={(e) => {
                if (speech.transcript) {
                  speech.resetTranscript();
                }
                setInput(e.target.value);
              }}
              onKeyDown={handleKeyDown}
              disabled={!isConnected}
            />
            <div className="flex items-center justify-between mt-1 px-2 pb-1">
              <div className="flex items-center gap-2">
                {attachments.length === 0 && <FileAttachmentButton attachments={attachments} onAttachmentsChange={setAttachments} disabled={!isConnected} />}
                {speech.isSupported && (
                  <button
                    onClick={speech.isListening ? speech.stopListening : speech.startListening}
                    className={cn(
                      "p-2 rounded-lg transition-colors",
                      speech.isListening
                        ? "text-red-400 bg-red-400/10 animate-pulse"
                        : "text-slate-400 hover:text-slate-200 hover:bg-white/10"
                    )}
                    title={speech.isListening ? "Stop recording" : "Voice input"}
                  >
                    {speech.isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  </button>
                )}
                <ModeToggle mode={mode} onChange={setMode} />
                <AIQuickSettings />
                <ModelSelector selectedModel={selectedModel} selectedProviderId={selectedProviderId} onSelect={(m, p) => { setSelectedModel(m); setSelectedProviderId(p); }} />
                {canOpenInTerminal && !showCLITerminal && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-3 text-xs text-slate-300 border border-white/10 bg-white/5 hover:bg-white/10"
                    onClick={() => void handleOpenInTerminal()}
                    disabled={isStartingCliSession}
                  >
                    {isStartingCliSession ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <TerminalSquare className="h-3 w-3 mr-1" />}
                    Open in terminal
                  </Button>
                )}
              </div>
              {streamingMessage ? (
                <Button size="sm" className="h-8 bg-red-600 hover:bg-red-500 text-white font-bold px-4 gap-2 shadow-[0_0_15px_rgba(239,68,68,0.2)]" onClick={handleStop}>
                  Stop <Square className="h-3 w-3 fill-current" />
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="h-8 bg-primary hover:bg-primary/90 text-white font-bold px-4 gap-2 shadow-[0_0_15px_rgba(163,114,248,0.2)]"
                  onClick={handleSend}
                  disabled={!input.trim() || !isConnected}
                >
                  Send <Send className="h-3 w-3" />
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col bg-[#0b0f17] overflow-hidden">
      {conversationId && conversationTitle && (
        <div className="border-b border-white/5 px-6 py-3">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-100">{conversationTitle}</p>
              <p className="text-xs text-slate-500">
                {showCLITerminal
                  ? "Interactive CLI session attached to this conversation."
                  : "Export this conversation for CLI handoff or offline reuse."}
              </p>
            </div>
            <ChatExportDialog
              conversationId={conversationId}
              title={conversationTitle}
            />
          </div>
        </div>
      )}

      {showCLITerminal && cliSession ? (
        <Group orientation="horizontal" className="min-h-0 flex-1">
          <Panel id="chat-panel" minSize={35} defaultSize={56}>
            {chatContent}
          </Panel>
          <Separator className="group relative flex items-center justify-center bg-white/5 transition-colors duration-150 data-[separator]:hover:bg-sky-500/40 data-[separator]:active:bg-sky-500/60">
            <div className="absolute z-10 flex items-center justify-center rounded-sm opacity-0 transition-opacity group-hover:opacity-100 group-active:opacity-100">
              <div className="h-6 w-0.5 rounded-full bg-sky-400/80" />
            </div>
          </Separator>
          <Panel id="cli-terminal-panel" minSize={25} defaultSize={44}>
            <CLITerminalPanel
              session={cliSession}
              providerName={cliSessionProvider?.name ?? selectedProvider?.name ?? null}
              onImport={handleImportCLISession}
              onClose={handleCloseCLISession}
              isImporting={isImportingCliSession}
              isClosing={isClosingCliSession}
            />
          </Panel>
        </Group>
      ) : (
        chatContent
      )}
    </div>
  );
}
