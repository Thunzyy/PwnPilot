import { RefreshCw } from "lucide-react";
import { useKBStore } from "@/stores/kbStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const statusStyles: Record<string, string> = {
  completed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  running: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  pending: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  failed: "bg-red-500/10 text-red-400 border-red-500/20",
};

export function SyncStatusIndicator({
  sourceId,
  syncStatus,
  lastSyncedAt,
}: {
  sourceId: string;
  syncStatus: string | null;
  lastSyncedAt: string | null;
  sourceType: string;
}) {
  const syncSource = useKBStore((s) => s.syncSource);

  const isActive = syncStatus === "running" || syncStatus === "pending";

  return (
    <div className="flex items-center gap-2">
      {syncStatus && (
        <Badge
          className={`text-[10px] font-medium border ${statusStyles[syncStatus] ?? statusStyles.pending}`}
        >
          {syncStatus}
        </Badge>
      )}

      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-slate-400 hover:text-primary hover:bg-primary/10"
        disabled={isActive}
        onClick={() => syncSource(sourceId)}
        title="Trigger sync"
      >
        <RefreshCw
          className={`size-3.5 ${isActive ? "animate-spin" : ""}`}
        />
      </Button>

      {lastSyncedAt && (
        <span className="text-[11px] text-slate-500">
          Last synced {new Date(lastSyncedAt).toLocaleString()}
        </span>
      )}
    </div>
  );
}
