import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useKBStore } from "@/stores/kbStore";
import { useProjectStore } from "@/stores/projectStore";
import { showApiErrorToast } from "@/lib/apiToast";
import type { KBCatalogEntry } from "@/types/kb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function CatalogCard({
  entry,
  onAdd,
}: {
  entry: KBCatalogEntry;
  onAdd: (entry: KBCatalogEntry) => void;
}) {
  return (
    <div className="rounded-lg border border-white/5 bg-[#121722] p-4 space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-slate-200">{entry.name}</h4>
        <p className="mt-1 text-xs text-slate-500 leading-relaxed line-clamp-2">
          {entry.description}
        </p>
      </div>
      {entry.recommended_filters.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {entry.recommended_filters.map((f) => (
            <Badge
              key={f}
              variant="outline"
              className="text-[10px] border-white/10 text-slate-500"
            >
              {f}
            </Badge>
          ))}
        </div>
      )}
      <Button
        size="sm"
        variant="secondary"
        className="w-full"
        onClick={() => onAdd(entry)}
      >
        Add
      </Button>
    </div>
  );
}

export function CommunityCatalogDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { catalog, sources, isCatalogLoading, fetchCatalog, addCommunitySource } = useKBStore();
  const { projects, fetchProjects } = useProjectStore();

  const [step, setStep] = useState<"browse" | "configure">("browse");
  const [selected, setSelected] = useState<KBCatalogEntry | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      if (catalog.length === 0) fetchCatalog();
      if (projects.length === 0) fetchProjects();
    }
  }, [open, catalog.length, projects.length, fetchCatalog, fetchProjects]);

  const addedUrls = new Set(
    sources
      .filter((s) => s.source_type === "community")
      .map((s) => s.remote_url)
  );

  const availableCatalog = catalog.filter((e) => !addedUrls.has(e.url));

  function handleSelectEntry(entry: KBCatalogEntry) {
    setSelected(entry);
    setSelectedPaths(new Set(entry.recommended_filters));
    setStep("configure");
  }

  function togglePath(path: string) {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  function resetAndClose() {
    setStep("browse");
    setSelected(null);
    setSelectedPaths(new Set());
    onOpenChange(false);
  }

  async function handleSubmit() {
    if (!selected || projects.length === 0) return;
    setSubmitting(true);

    const allSelected =
      selected.recommended_filters.length > 0 &&
      selectedPaths.size === selected.recommended_filters.length;
    const include_paths = allSelected ? null : [...selectedPaths];

    try {
      await Promise.all(
        projects.map((p) =>
          addCommunitySource({
            project_id: p.id,
            slug: selected.slug,
            include_paths,
          })
        )
      );
      toast.success(`${selected.name} added to all projects`);
      resetAndClose();
    } catch (error) {
      showApiErrorToast(
        "Failed to add community source",
        error,
        "Could not add this community source to the projects.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetAndClose(); else onOpenChange(v); }}>
      <DialogContent className="sm:max-w-2xl">
        {step === "browse" ? (
          <>
            <DialogHeader>
              <DialogTitle>Community Sources</DialogTitle>
              <DialogDescription>
                Curated security repos added as read-only references to all projects.
              </DialogDescription>
            </DialogHeader>

            {isCatalogLoading ? (
              <div className="flex justify-center py-10">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : availableCatalog.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 max-h-[60vh] overflow-y-auto pr-1">
                {availableCatalog.map((entry) => (
                  <CatalogCard
                    key={entry.slug}
                    entry={entry}
                    onAdd={handleSelectEntry}
                  />
                ))}
              </div>
            ) : (
              <p className="text-center text-sm text-slate-500 py-8">
                {catalog.length > 0
                  ? "All community sources have been added."
                  : "No community sources available."}
              </p>
            )}
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStep("browse")}
                  className="rounded-md p-1 hover:bg-white/5 transition-colors"
                >
                  <ArrowLeft className="size-4" />
                </button>
                {selected?.name}
              </DialogTitle>
              <DialogDescription>
                {selected?.description}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {selected && selected.recommended_filters.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Path filters
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {selected.recommended_filters.map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => togglePath(f)}
                        className="cursor-pointer"
                      >
                        <Badge
                          variant={selectedPaths.has(f) ? "default" : "outline"}
                          className={
                            selectedPaths.has(f)
                              ? "bg-primary/20 text-primary border-primary/30"
                              : "border-white/10 text-slate-500"
                          }
                        >
                          {f}
                        </Badge>
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-600">
                    Toggle paths to include. All selected = no filter applied.
                  </p>
                </div>
              )}

              <p className="text-xs text-slate-500">
                This source will be added to all {projects.length} project{projects.length !== 1 ? "s" : ""}.
              </p>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => setStep("browse")}>
                Back
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={projects.length === 0 || submitting}
              >
                {submitting ? "Adding..." : "Add Source"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
