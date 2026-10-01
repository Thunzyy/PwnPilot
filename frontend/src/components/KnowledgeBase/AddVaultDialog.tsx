import { useEffect, useState } from "react";
import { toast } from "sonner";
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

export function AddVaultDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const createLocalSource = useKBStore((s) => s.createLocalSource);
  const { projects, fetchProjects } = useProjectStore();

  useEffect(() => {
    if (open && projects.length === 0) fetchProjects();
  }, [open, projects.length, fetchProjects]);

  const canSubmit = name.trim() && path.trim() && projects.length > 0;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await Promise.all(
        projects.map((p) =>
          createLocalSource({
            name: name.trim(),
            path: path.trim(),
            project_id: p.id,
            source_type: "local",
          })
        )
      );
      toast.success(`Vault added to all ${projects.length} projects`);
      setName("");
      setPath("");
      onOpenChange(false);
    } catch (error) {
      showApiErrorToast(
        "Failed to add vault",
        error,
        "Could not add this vault to the projects.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Local Vault</DialogTitle>
          <DialogDescription>
            Point to an Obsidian vault or markdown folder on disk.
            It will be added to all {projects.length} project{projects.length !== 1 ? "s" : ""}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Name</label>
            <Input
              placeholder="My notes"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Path</label>
            <Input
              placeholder="/home/user/notes"
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || submitting}>
            {submitting ? "Adding..." : "Add Vault"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
