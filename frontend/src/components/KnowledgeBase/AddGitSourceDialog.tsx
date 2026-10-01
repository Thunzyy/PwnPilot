import { useEffect, useState } from "react";
import { toast } from "sonner";
import { GitBranch } from "lucide-react";
import { useKBStore } from "@/stores/kbStore";
import { useProjectStore } from "@/stores/projectStore";
import { showApiErrorToast } from "@/lib/apiToast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function AddGitSourceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const addCustomGitSource = useKBStore((s) => s.addCustomGitSource);
  const { projects, fetchProjects } = useProjectStore();

  useEffect(() => {
    if (open && projects.length === 0) fetchProjects();
  }, [open, projects.length, fetchProjects]);

  // Auto-derive name from URL
  useEffect(() => {
    if (!url.trim()) return;
    const parts = url.trim().replace(/\/+$/, "").split("/");
    const last = parts[parts.length - 1]?.replace(/\.git$/, "") ?? "";
    if (last && !name) setName(last);
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  const canSubmit = name.trim() && url.trim() && projects.length > 0;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await Promise.all(
        projects.map((p) =>
          addCustomGitSource({
            project_id: p.id,
            name: name.trim(),
            url: url.trim(),
          })
        )
      );
      toast.success(`${name.trim()} added to all projects`);
      setName("");
      setUrl("");
      onOpenChange(false);
    } catch (error) {
      showApiErrorToast(
        "Failed to add git source",
        error,
        "Could not add this git source to the projects.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="size-4 text-primary" />
            Add Git Source
          </DialogTitle>
          <DialogDescription>
            Clone a git repository as a read-only community source. It will be
            added to all {projects.length} project{projects.length !== 1 ? "s" : ""}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">
              Git URL
            </label>
            <Input
              placeholder="https://github.com/user/repo.git"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Name</label>
            <Input
              placeholder="Repository name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || submitting}>
            {submitting ? "Cloning..." : "Add Source"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
