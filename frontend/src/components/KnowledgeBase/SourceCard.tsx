import { Database, FolderGit2, FolderOpen, Lock, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function SyncStatusBadge({ status }: { status: string | null }) {
  if (!status) return null;

  const styles: Record<string, string> = {
    completed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    running: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    pending: "bg-slate-500/10 text-slate-400 border-slate-500/20",
    failed: "bg-red-500/10 text-red-400 border-red-500/20",
  };

  return (
    <Badge className={`text-[10px] font-medium border ${styles[status] ?? styles.pending}`}>
      {status}
    </Badge>
  );
}

function SourceIcon({ type }: { type: string }) {
  if (type === "community") {
    return <FolderGit2 className="size-5 text-primary shrink-0" />;
  }
  return <Database className="size-5 text-primary shrink-0" />;
}

export function SourceCard({
  name,
  sourceType,
  syncStatus,
  lastSyncedAt,
  readOnly,
  projectCount,
  onBrowse,
  onDelete,
}: {
  name: string;
  sourceType: string;
  syncStatus: string | null;
  lastSyncedAt: string | null;
  readOnly?: boolean;
  projectCount?: number;
  onBrowse?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="group flex items-center gap-4 rounded-lg border border-white/5 bg-[#121722] px-4 py-3 transition-colors hover:border-primary/20">
      <div className="flex size-10 items-center justify-center rounded-lg bg-white/[0.03] border border-white/5">
        <SourceIcon type={sourceType} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-200 truncate">
            {name}
          </span>
          <Badge
            variant="outline"
            className="text-[10px] font-mono uppercase tracking-wider border-white/10 text-slate-500"
          >
            {sourceType}
          </Badge>
          {readOnly && (
            <Lock className="size-3 text-slate-500 shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {lastSyncedAt && (
            <p className="text-[11px] text-slate-500">
              Last synced {new Date(lastSyncedAt).toLocaleString()}
            </p>
          )}
          {projectCount != null && (
            <span className="text-[11px] text-slate-600">
              {projectCount} project{projectCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>
      <SyncStatusBadge status={syncStatus} />
      {onBrowse && (
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-slate-500 opacity-0 group-hover:opacity-100 hover:text-primary hover:bg-primary/10 transition-all"
          onClick={onBrowse}
          title="Browse documents"
        >
          <FolderOpen className="size-3.5" />
        </Button>
      )}
      {onDelete && (
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-slate-600 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all"
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
