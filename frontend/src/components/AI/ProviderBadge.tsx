import { Badge } from "@/components/ui/badge";
import type { ProviderType, SourceMode } from "@/types/ai";

interface ProviderBadgeProps {
  providerType?: ProviderType | null;
  sourceMode?: SourceMode | null;
  providerName?: string | null;
}

const sourceLabel = (sourceMode?: SourceMode | null) => {
  if (sourceMode === "cli_orchestrated" || sourceMode === "cli_terminal") {
    return "CLI";
  }
  if (sourceMode === "api") {
    return "API";
  }
  return null;
};

export function ProviderBadge({
  providerType,
  sourceMode,
  providerName,
}: ProviderBadgeProps) {
  const label = sourceLabel(sourceMode) ?? (providerType === "cli" ? "CLI" : null);
  if (!label && !providerName) {
    return null;
  }

  return (
    <div className="flex items-center gap-1">
      {providerName ? (
        <Badge className="h-4 px-1.5 text-[8px] bg-white/5 text-slate-300 border-white/10">
          {providerName}
        </Badge>
      ) : null}
      {label ? (
        <Badge className="h-4 px-1.5 text-[8px] bg-white/5 text-slate-400 border-white/10 uppercase">
          {label}
        </Badge>
      ) : null}
    </div>
  );
}
