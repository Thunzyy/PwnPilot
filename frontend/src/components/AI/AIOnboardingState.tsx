import { useEffect, useMemo, useState } from "react";
import { Bot, Sparkles, Terminal as TerminalIcon, Cloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAIStore } from "@/stores/aiStore";
import { useAgentConfigStore } from "@/stores/agentConfigStore";
import { AIQuickSettings } from "./AIQuickSettings";
import { getProviderAttentionMessage } from "./providerStatus";
import type { AIProvider } from "@/types/ai";

interface AIOnboardingStateProps {
  onNewChat: (selection?: { model: string; providerConfigId: number }) => void | Promise<void>;
  onOpenAgentWorkspace?: () => void;
}

export function AIOnboardingState({
  onNewChat,
  onOpenAgentWorkspace,
}: AIOnboardingStateProps) {
  const providers = useAIStore((s) => s.providers);
  const hasFetchedProviders = useAIStore((s) => s.hasFetchedProviders);
  const isLoading = useAIStore((s) => s.isLoading);
  const fetchProviders = useAIStore((s) => s.fetchProviders);
  const modelsCache = useAIStore((s) => s.modelsCache);
  const fetchModels = useAIStore((s) => s.fetchModels);
  const agentConfigs = useAgentConfigStore((s) => s.configs);
  const fetchAgentConfigs = useAgentConfigStore((s) => s.fetchConfigs);
  // User-driven choice (null = use auto pick).
  const [userSelection, setUserSelection] = useState<{
    providerId: number;
    model: string;
  } | null>(null);

  useEffect(() => {
    if (providers.length > 0 || hasFetchedProviders) return;
    void fetchProviders();
  }, [fetchProviders, hasFetchedProviders, providers.length]);

  useEffect(() => {
    if (agentConfigs.length > 0) return;
    void fetchAgentConfigs();
  }, [agentConfigs.length, fetchAgentConfigs]);

  const enabledProviders = providers.filter((provider) => provider.is_enabled);

  useEffect(() => {
    for (const p of enabledProviders) {
      if (!modelsCache[p.id]) {
        fetchModels(p.id).catch(() => {});
      }
    }
  }, [enabledProviders, modelsCache, fetchModels]);

  // Auto-select the first healthy provider's default model so the user can
  // hit "New Chat" immediately if they don't want to pick.
  const autoSelection = useMemo(() => {
    if (enabledProviders.length === 0) return null;
    const first = enabledProviders.find((p) =>
      p.health_status === null ||
      p.health_status === "healthy" ||
      p.health_status === "unknown"
    ) ?? enabledProviders[0];
    if (!first) return null;
    const cached = modelsCache[first.id];
    const fallback = first.default_model || cached?.models?.[0]?.id;
    if (!fallback) return null;
    return { providerId: first.id, model: fallback };
  }, [enabledProviders, modelsCache]);

  const selection = userSelection ?? autoSelection;

  const cliProviders = useMemo(
    () => enabledProviders.filter((p) => p.provider_type === "cli"),
    [enabledProviders],
  );
  const apiProviders = useMemo(
    () => enabledProviders.filter((p) => p.provider_type !== "cli"),
    [enabledProviders],
  );

  const hasProviders = enabledProviders.length > 0;
  const hasAgentConfigs = agentConfigs.length > 0;
  const hasHealthyProviderCandidate = enabledProviders.some((provider) => {
    return (
      provider.health_status === null ||
      provider.health_status === "healthy" ||
      provider.health_status === "unknown"
    );
  });

  if (!hasProviders && !hasFetchedProviders && isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#0b0f17] gap-4 text-slate-400">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm font-medium">Checking AI providers...</p>
      </div>
    );
  }

  if (!hasProviders) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#0b0f17] px-6">
        <div className="size-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-[0_0_30px_rgba(163,114,248,0.1)] mb-6">
          <Sparkles className="h-8 w-8" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">
          No AI provider configured
        </h2>
        <p className="text-sm text-slate-400 mb-6 text-center max-w-md">
          Add at least one provider before starting a conversation. PwnPilot can
          use OpenAI-compatible endpoints, official OpenAI, Anthropic, or Ollama.
        </p>
        {hasAgentConfigs ? (
          <div className="mb-6 w-full max-w-md rounded-xl border border-primary/20 bg-primary/5 p-4 text-left">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <TerminalIcon className="h-4 w-4 text-primary" />
              Agent workspace available
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              You can still launch a CLI agent from AI Assistant even if no API
              provider is configured for question mode.
            </p>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-center gap-3">
          {hasAgentConfigs && onOpenAgentWorkspace ? (
            <Button
              type="button"
              variant="secondary"
              onClick={onOpenAgentWorkspace}
            >
              Open Agent Workspace
            </Button>
          ) : null}
          <AIQuickSettings label="Open AI Settings" />
        </div>
      </div>
    );
  }

  const title = hasHealthyProviderCandidate
    ? "PwnPilot AI"
    : "Configured providers need attention";
  const description = hasHealthyProviderCandidate
    ? "Start a new conversation or select one from the sidebar"
    : "At least one provider exists, but its last known health state needs review before relying on it.";

  const startChat = (provider: AIProvider, model: string) => {
    setUserSelection({ providerId: provider.id, model });
    void onNewChat({ providerConfigId: provider.id, model });
  };

  const startWithSelection = () => {
    if (selection) {
      void onNewChat({
        providerConfigId: selection.providerId,
        model: selection.model,
      });
    } else {
      void onNewChat();
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#0b0f17] px-6 py-10">
      <div className="mx-auto flex max-w-2xl flex-col items-center">
        <div className="size-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-[0_0_30px_rgba(163,114,248,0.1)] mb-6">
          <Bot className="h-8 w-8" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">{title}</h2>
        <p className="text-sm text-slate-400 mb-6 text-center max-w-sm">
          {description}
        </p>

        {!hasHealthyProviderCandidate ? (
          <div className="mb-6 w-full rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-[10px] uppercase tracking-[0.25em] text-slate-500">
              Enabled providers
            </div>
            <div className="mt-3 space-y-3">
              {enabledProviders.map((provider) => (
                <div key={provider.id} className="rounded-lg border border-white/5 bg-black/20 p-3">
                  <div className="text-sm font-medium text-white">{provider.name}</div>
                  <div className="mt-1 text-xs text-slate-400">
                    {getProviderAttentionMessage(provider)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {cliProviders.length > 0 && (
          <ProviderPicker
            title="Start with a CLI"
            icon={<TerminalIcon className="h-3.5 w-3.5" />}
            providers={cliProviders}
            modelsCache={modelsCache}
            selection={selection}
            onPick={startChat}
          />
        )}

        {apiProviders.length > 0 && (
          <ProviderPicker
            title="Start with an API"
            icon={<Cloud className="h-3.5 w-3.5" />}
            providers={apiProviders}
            modelsCache={modelsCache}
            selection={selection}
            onPick={startChat}
          />
        )}

        <div className="mt-8 flex items-center gap-3">
          <Button
            onClick={startWithSelection}
            className="bg-primary hover:bg-primary/90 text-white font-bold px-6 shadow-[0_0_15px_rgba(163,114,248,0.2)]"
          >
            New Chat
            {selection && (
              <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-mono">
                {selection.model.length > 24 ? selection.model.slice(0, 24) + "…" : selection.model}
              </span>
            )}
          </Button>
          <AIQuickSettings label="AI Settings" variant="secondary" />
        </div>
      </div>
    </div>
  );
}

interface ProviderPickerProps {
  title: string;
  icon: React.ReactNode;
  providers: AIProvider[];
  modelsCache: ReturnType<typeof useAIStore.getState>["modelsCache"];
  selection: { providerId: number; model: string } | null;
  onPick: (provider: AIProvider, model: string) => void;
}

function ProviderPicker({ title, icon, providers, modelsCache, selection, onPick }: ProviderPickerProps) {
  return (
    <div className="mb-4 w-full">
      <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-slate-500">
        {icon}
        <span>{title}</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {providers.map((provider) => {
          const cached = modelsCache[provider.id];
          const models = cached?.models ?? [];
          const defaultModel = provider.default_model || models[0]?.id;
          const isSelected =
            selection?.providerId === provider.id && selection.model === defaultModel;
          return (
            <button
              key={provider.id}
              type="button"
              disabled={!defaultModel}
              onClick={() => defaultModel && onPick(provider, defaultModel)}
              className={cn(
                "group flex flex-col items-start gap-1 rounded-xl border bg-white/[0.02] px-3 py-2.5 text-left transition-colors",
                "hover:border-primary/40 hover:bg-primary/5",
                "disabled:cursor-not-allowed disabled:opacity-50",
                isSelected ? "border-primary/60 bg-primary/10" : "border-white/10",
              )}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="text-sm font-semibold text-white truncate">
                  {provider.name}
                </span>
                {provider.provider_type === "cli" && (
                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">
                    CLI
                  </span>
                )}
              </div>
              <span className="font-mono text-[11px] text-slate-400 truncate w-full">
                {defaultModel ?? "no model available"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
