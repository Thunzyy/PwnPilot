import { useEffect } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAIStore } from "@/stores/aiStore";
import { getModelSelectorEmptyMessage } from "./providerStatus";

interface ModelSelectorProps {
  selectedModel: string | null;
  selectedProviderId: number | null;
  onSelect: (model: string, providerId: number) => void;
}

export function ModelSelector({ selectedModel, selectedProviderId, onSelect }: ModelSelectorProps) {
  const providers = useAIStore((s) => s.providers);
  const hasFetchedProviders = useAIStore((s) => s.hasFetchedProviders);
  const modelsCache = useAIStore((s) => s.modelsCache);
  const modelErrors = useAIStore((s) => s.modelErrors);
  const fetchModels = useAIStore((s) => s.fetchModels);
  const fetchProviders = useAIStore((s) => s.fetchProviders);

  useEffect(() => {
    if (providers.length > 0 || hasFetchedProviders) return;
    void fetchProviders();
  }, [providers.length, hasFetchedProviders, fetchProviders]);

  useEffect(() => {
    for (const p of providers) {
      if (p.is_enabled && !modelsCache[p.id] && !modelErrors[p.id]) {
        fetchModels(p.id).catch(() => {});
      }
    }
  }, [providers, modelsCache, modelErrors, fetchModels]);

  const enabledProviders = providers.filter((p) => p.is_enabled);
  const groupedProviders = [
    {
      key: "api",
      label: "API Providers",
      providers: enabledProviders.filter((provider) => provider.provider_type !== "cli"),
    },
    {
      key: "cli",
      label: "CLI Providers",
      providers: enabledProviders.filter((provider) => provider.provider_type === "cli"),
    },
  ].filter((group) => group.providers.length > 0);

  const displayLabel = selectedModel
    ? selectedModel.length > 20
      ? selectedModel.slice(0, 20) + "\u2026"
      : selectedModel
    : "Select model";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-8 px-3 text-xs bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 hover:text-slate-200 gap-1.5 font-mono"
        >
          {displayLabel}
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-64 bg-[#1a2030] border-white/10 max-h-72 overflow-y-auto"
      >
        {enabledProviders.length === 0 && (
          <div className="px-3 py-4 text-xs text-slate-500 text-center">
            No providers enabled
          </div>
        )}
        {groupedProviders.map((group, groupIndex) => (
          <div key={group.key}>
            {groupIndex > 0 && <DropdownMenuSeparator className="bg-white/5" />}
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-slate-500 font-bold px-3 py-1.5">
              {group.label}
            </DropdownMenuLabel>
            {group.providers.map((provider, providerIndex) => {
              const cached = modelsCache[provider.id];
              const errorMessage = modelErrors[provider.id];
              const models = cached?.models ?? [];
              const emptyMessage = getModelSelectorEmptyMessage({
                provider,
                hasCachedModels: Boolean(cached),
                errorMessage,
              });

              return (
                <div key={provider.id}>
                  {providerIndex > 0 && <DropdownMenuSeparator className="bg-white/5" />}
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-slate-400 px-3 py-1.5">
                    {provider.name}
                  </DropdownMenuLabel>
                  {models.length === 0 && (
                    <div
                      className={[
                        "px-3 py-1 text-[11px] italic",
                        errorMessage ? "text-rose-400" : "text-slate-500",
                      ].join(" ")}
                    >
                      {emptyMessage}
                    </div>
                  )}
                  {models.map((m) => {
                    const isSelected = m.id === selectedModel && provider.id === selectedProviderId;
                    return (
                      <DropdownMenuItem
                        key={m.id}
                        className="px-3 py-1.5 text-sm text-slate-300 cursor-pointer focus:bg-white/5 focus:text-white"
                        onSelect={() => onSelect(m.id, provider.id)}
                      >
                        <Check className={`h-3 w-3 mr-2 shrink-0 ${isSelected ? "opacity-100 text-primary" : "opacity-0"}`} />
                        <span className="truncate">{m.name}</span>
                      </DropdownMenuItem>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
