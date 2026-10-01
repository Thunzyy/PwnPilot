import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Database, FolderGit2, FolderOpen, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useKBSources } from "@/hooks/useKBSources";
import { useKBStore } from "@/stores/kbStore";
import { showApiErrorToast } from "@/lib/apiToast";
import type { KBSource } from "@/types/kb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SourceEditDialog } from "./SourceEditDialog";
import { DeleteSourceDialog } from "./DeleteSourceDialog";
import { SyncStatusIndicator } from "./SyncStatusIndicator";

function SourceRow({
  source,
  onEdit,
  onDelete,
  onBrowse,
}: {
  source: KBSource;
  onEdit: () => void;
  onDelete: () => void;
  onBrowse: () => void;
}) {
  return (
    <div className="group flex items-center gap-4 rounded-lg border border-white/5 bg-black/20 px-4 py-3 transition-colors hover:border-primary/20">
      <div className="flex size-10 items-center justify-center rounded-lg bg-white/[0.03] border border-white/5 shrink-0">
        {source.source_type === "community" ? (
          <FolderGit2 className="size-5 text-primary" />
        ) : (
          <Database className="size-5 text-primary" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-200 truncate">
            {source.name}
          </span>
          <Badge
            variant="outline"
            className="text-[10px] font-mono uppercase tracking-wider border-white/10 text-slate-500"
          >
            {source.source_type}
          </Badge>
          {source.read_only && <Lock className="size-3 text-slate-500 shrink-0" />}
        </div>
        {source.path && (
          <p className="text-[11px] text-slate-500 truncate mt-0.5">{source.path}</p>
        )}
      </div>

      <SyncStatusIndicator
        sourceId={source.id}
        syncStatus={source.sync_status}
        lastSyncedAt={source.last_synced_at}
        sourceType={source.source_type}
      />

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-slate-500 hover:text-primary hover:bg-primary/10"
          onClick={onEdit}
          title="Edit source"
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-slate-500 hover:text-primary hover:bg-primary/10"
          onClick={onBrowse}
          title="Browse documents"
        >
          <FolderOpen className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-slate-600 hover:text-red-400 hover:bg-red-500/10"
          onClick={onDelete}
          title="Remove source"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function SourceManagement() {
  const navigate = useNavigate();
  const deleteSourceWithCleanup = useKBStore((state) => state.deleteSourceWithCleanup);
  const { sources, isLoading } = useKBSources();

  const [editSource, setEditSource] = useState<KBSource | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteSource, setDeleteSource] = useState<KBSource | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  function handleAdd() {
    setEditSource(null);
    setEditDialogOpen(true);
  }

  function handleEdit(source: KBSource) {
    setEditSource(source);
    setEditDialogOpen(true);
  }

  function handleDeletePrompt(source: KBSource) {
    setDeleteSource(source);
    setDeleteDialogOpen(true);
  }

  async function handleDeleteConfirm(deleteFiles: boolean) {
    if (!deleteSource) return;
    try {
      await deleteSourceWithCleanup(deleteSource.id, deleteFiles);
      toast.success("Source removed");
    } catch (error) {
      showApiErrorToast(
        "Failed to remove source",
        error,
        "Could not remove this source.",
      );
    }
    setDeleteDialogOpen(false);
    setDeleteSource(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-widest text-slate-500">
          Knowledge Sources
        </h3>
        <Button
          variant="ghost"
          size="sm"
          className="text-slate-400 hover:text-white"
          onClick={handleAdd}
        >
          <Plus className="size-3.5 mr-1.5" />
          Add Source
        </Button>
      </div>

      {isLoading && sources.length === 0 && (
        <div className="flex items-center justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {!isLoading && sources.length === 0 && (
        <div className="rounded-lg border border-white/5 bg-black/20 px-6 py-8 text-center">
          <p className="text-sm text-slate-500">
            No knowledge sources configured yet. Add a vault to get started.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-3 text-primary hover:text-primary/80"
            onClick={handleAdd}
          >
            <Plus className="size-3.5 mr-1.5" />
            Add Source
          </Button>
        </div>
      )}

      {sources.length > 0 && (
        <div className="space-y-2">
          {sources.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              onEdit={() => handleEdit(source)}
              onDelete={() => handleDeletePrompt(source)}
              onBrowse={() => navigate(`/notes/${source.id}/browse`)}
            />
          ))}
        </div>
      )}

      <SourceEditDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        source={editSource}
      />
      <DeleteSourceDialog
        source={deleteSource}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
