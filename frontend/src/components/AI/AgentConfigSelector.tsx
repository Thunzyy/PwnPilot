import { Check, ChevronDown, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAgentConfigStore } from "@/stores/agentConfigStore";
import { AGENT_TYPE_LABELS } from "@/types/agent";
import type { AgentConfig } from "@/types/agent";

interface AgentConfigSelectorProps {
  selectedConfigId: number | null;
  onSelect: (config: AgentConfig) => void;
}

export function AgentConfigSelector({ selectedConfigId, onSelect }: AgentConfigSelectorProps) {
  const configs = useAgentConfigStore((s) => s.configs);
  const navigate = useNavigate();

  const selected = configs.find((c) => c.id === selectedConfigId);
  const displayLabel = selected
    ? selected.display_name.length > 18
      ? selected.display_name.slice(0, 18) + "\u2026"
      : selected.display_name
    : "Select agent";

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
        className="w-64 bg-[#1a2030] border-[#252b3a] max-h-72 overflow-y-auto"
      >
        {configs.length === 0 && (
          <div className="px-3 py-4 text-xs text-slate-500 text-center">
            No agents configured
          </div>
        )}
        {configs.map((config) => {
          const isSelected = config.id === selectedConfigId;
          return (
            <DropdownMenuItem
              key={config.id}
              className="px-3 py-1.5 text-sm text-slate-300 cursor-pointer focus:bg-white/5 focus:text-white"
              onSelect={() => onSelect(config)}
            >
              <Check className={`h-3 w-3 mr-2 shrink-0 ${isSelected ? "opacity-100 text-primary" : "opacity-0"}`} />
              <span className="truncate flex-1">{config.display_name}</span>
              <span className="text-[10px] text-slate-500 uppercase ml-2">
                {AGENT_TYPE_LABELS[config.agent_type] ?? config.agent_type}
              </span>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator className="bg-white/5" />
        <DropdownMenuItem
          className="px-3 py-1.5 text-sm text-slate-400 cursor-pointer focus:bg-white/5 focus:text-white gap-2"
          onSelect={() => navigate("/settings")}
        >
          <Plus className="h-3 w-3" />
          Add agent
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
