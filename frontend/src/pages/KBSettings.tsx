import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  RefreshCw,
  AlertCircle,
  Plus,
  WifiOff,
  GitBranch,
} from "lucide-react";
import { toast } from "sonner";
import { useKBSources } from "@/hooks/useKBSources";
import { useKBStore } from "../stores/kbStore";
import { showApiErrorToast } from "@/lib/apiToast";
import { Button } from "@/components/ui/button";
import { SourceCard } from "@/components/KnowledgeBase/SourceCard";
import { AddVaultDialog } from "@/components/KnowledgeBase/AddVaultDialog";
import { AddGitSourceDialog } from "@/components/KnowledgeBase/AddGitSourceDialog";
import { CommunityCatalogDialog } from "@/components/KnowledgeBase/CommunityCatalogDialog";
import { TagManagement } from "@/components/KnowledgeBase/TagManagement";
import { KBPerformancePanel } from "@/components/KnowledgeBase/KBPerformancePanel";

export function KBSettings() {
  const navigate = useNavigate();
  const { sources, isLoading, error, refreshSources } = useKBSources();
  const {
    deleteSource,
    deleteCommunityByUrl,
  } = useKBStore();
  const [vaultDialogOpen, setVaultDialogOpen] = useState(false);
  const [gitDialogOpen, setGitDialogOpen] = useState(false);
  const [catalogDialogOpen, setCatalogDialogOpen] = useState(false);

  const localSources = sources.filter((s) => s.source_type === "local");

  const communityGroups = useMemo(() => {
    const groups = new Map<string, typeof sources>();
    for (const s of sources) {
      if (s.source_type !== "community" || !s.remote_url) continue;
      const list = groups.get(s.remote_url);
      if (list) list.push(s);
      else groups.set(s.remote_url, [s]);
    }
    return groups;
  }, [sources]);

  async function handleDeleteLocal(sourceId: string) {
    try {
      await deleteSource(sourceId);
      toast.success("Vault removed");
    } catch (error) {
      showApiErrorToast(
        "Failed to remove vault",
        error,
        "Could not remove this vault.",
      );
    }
  }

  async function handleDeleteCommunity(remoteUrl: string) {
    try {
      await deleteCommunityByUrl(remoteUrl);
      toast.success("Community source removed");
    } catch (error) {
      showApiErrorToast(
        "Failed to remove source",
        error,
        "Could not remove this community source.",
      );
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="container mx-auto max-w-5xl animate-in fade-in duration-500 space-y-8 p-8">
        {/* Page header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="size-9 text-slate-400 hover:text-white"
              onClick={() => navigate("/notes")}
            >
              <ArrowLeft className="size-4" />
            </Button>
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
              <BookOpen className="size-5 text-primary" />
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-white">
                KB Settings
              </h2>
              <p className="text-sm text-slate-500">
                Manage documentation sources, sync, and configuration.
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-slate-400 hover:text-white"
            onClick={() => void refreshSources()}
            disabled={isLoading}
          >
            <RefreshCw
              className={`size-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>

        {/* Error state */}
        {error && (
          <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
            {error.includes("Cannot reach") ? (
              <WifiOff className="size-5 text-red-400 shrink-0" />
            ) : (
              <AlertCircle className="size-5 text-red-400 shrink-0" />
            )}
            <span className="text-sm text-red-300 flex-1">{error}</span>
            <Button
              variant="ghost"
              size="sm"
              className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
              onClick={() => void refreshSources()}
            >
              <RefreshCw className="size-3.5 mr-1.5" />
              Retry
            </Button>
          </div>
        )}

        {/* Loading state */}
        {isLoading && sources.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-sm text-slate-500 animate-pulse">
              Loading knowledge sources...
            </p>
          </div>
        )}

        {/* Source sections */}
        {!isLoading && !error && sources.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-4 text-center">
            <BookOpen className="size-10 text-slate-600" />
            <p className="text-sm text-slate-500">
              No sources configured yet. Add a vault or browse community
              sources.
            </p>
            <div className="flex gap-3">
              <Button
                size="sm"
                onClick={() => setVaultDialogOpen(true)}
              >
                <Plus className="size-3.5 mr-1.5" />
                Add Vault
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setGitDialogOpen(true)}
              >
                <GitBranch className="size-3.5 mr-1.5" />
                Add Git URL
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCatalogDialogOpen(true)}
              >
                Browse Community
              </Button>
            </div>
          </div>
        ) : (
          sources.length > 0 && (
            <div className="space-y-8">
              {/* My Vaults */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">
                    My Vaults ({localSources.length})
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-slate-400 hover:text-white"
                    onClick={() => setVaultDialogOpen(true)}
                  >
                    <Plus className="size-3.5 mr-1.5" />
                    Add Vault
                  </Button>
                </div>
                {localSources.length > 0 ? (
                  <div className="space-y-2">
                    {localSources.map((source) => (
                      <SourceCard
                        key={source.id}
                        name={source.name}
                        sourceType={source.source_type}
                        syncStatus={source.sync_status}
                        lastSyncedAt={source.last_synced_at}
                        readOnly={source.read_only}
                        onBrowse={() => navigate("/notes")}
                        onDelete={() => handleDeleteLocal(source.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-600 py-4 text-center">
                    No vaults yet.
                  </p>
                )}
              </div>

              {/* Community Sources */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">
                    Community Sources ({communityGroups.size})
                  </h3>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-slate-400 hover:text-white"
                      onClick={() => setGitDialogOpen(true)}
                    >
                      <GitBranch className="size-3.5 mr-1.5" />
                      Git URL
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-slate-400 hover:text-white"
                      onClick={() => setCatalogDialogOpen(true)}
                    >
                      <Plus className="size-3.5 mr-1.5" />
                      Browse
                    </Button>
                  </div>
                </div>
                {communityGroups.size > 0 ? (
                  <div className="space-y-2">
                    {[...communityGroups.entries()].map(([url, group]) => {
                      const rep = group[0];
                      return (
                        <SourceCard
                          key={url}
                          name={rep.name}
                          sourceType={rep.source_type}
                          syncStatus={rep.sync_status}
                          lastSyncedAt={rep.last_synced_at}
                          readOnly={rep.read_only}
                          projectCount={group.length}
                          onDelete={() => handleDeleteCommunity(url)}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-slate-600 py-4 text-center">
                    No community sources yet.
                  </p>
                )}
              </div>

              {/* Tags */}
              <TagManagement />
            </div>
          )
        )}

        <KBPerformancePanel />

        {/* Dialogs */}
        <AddVaultDialog
          open={vaultDialogOpen}
          onOpenChange={setVaultDialogOpen}
        />
        <AddGitSourceDialog
          open={gitDialogOpen}
          onOpenChange={setGitDialogOpen}
        />
        <CommunityCatalogDialog
          open={catalogDialogOpen}
          onOpenChange={setCatalogDialogOpen}
        />
      </div>
    </div>
  );
}
