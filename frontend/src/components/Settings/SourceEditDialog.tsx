import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useKBStore } from "@/stores/kbStore";
import { showApiErrorToast } from "@/lib/apiToast";
import type { KBSource } from "@/types/kb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ProjectPicker } from "@/components/KnowledgeBase/ProjectPicker";
import { OpsecWarningDialog } from "./OpsecWarningDialog";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-slate-300">{label}</label>
      {children}
    </div>
  );
}

export function SourceEditDialog({
  open, onOpenChange, source,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: KBSource | null;
}) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [projectId, setProjectId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showOpsecWarning, setShowOpsecWarning] = useState(false);
  const [opsecAcknowledged, setOpsecAcknowledged] = useState(false);

  const createLocalSource = useKBStore((s) => s.createLocalSource);
  const updateSource = useKBStore((s) => s.updateSource);
  const isCreate = source === null;

  useEffect(() => {
    if (!open) return;
    setName(source?.name ?? "");
    setPath(source?.path ?? "");
    setRemoteUrl(source?.remote_url ?? "");
    setProjectId(source?.project_id ?? "");
    setOpsecAcknowledged(source?.opsec_acknowledged ?? false);
    setSubmitting(false);
    setShowOpsecWarning(false);
  }, [open, source]);

  const canSubmit = isCreate ? name.trim() && path.trim() && projectId : name.trim();

  function needsOpsecWarning(): boolean {
    if (opsecAcknowledged || !remoteUrl.trim()) return false;
    return !(source?.remote_url && source.remote_url.trim());
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    if (needsOpsecWarning()) { setShowOpsecWarning(true); return; }

    setSubmitting(true);
    try {
      if (isCreate) {
        await createLocalSource({
          name: name.trim(), path: path.trim(), project_id: projectId,
          source_type: "local", remote_url: remoteUrl.trim() || undefined,
        });
        toast.success("Source added");
      } else {
        await updateSource(source.id, {
          name: name.trim(), path: path.trim() || undefined,
          remote_url: remoteUrl.trim() || undefined,
          opsec_acknowledged: opsecAcknowledged || undefined,
        });
        toast.success("Source updated");
      }
      onOpenChange(false);
    } catch (error) {
      showApiErrorToast(
        isCreate ? "Failed to add source" : "Failed to update source",
        error,
        isCreate ? "Could not add this source." : "Could not update this source.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function handleOpsecAcknowledge() {
    setOpsecAcknowledged(true);
    setShowOpsecWarning(false);
    setTimeout(handleSubmit, 0);
  }

  const submitLabel = submitting
    ? (isCreate ? "Adding..." : "Saving...")
    : (isCreate ? "Add Source" : "Save Changes");

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isCreate ? "Add Source" : "Edit Source"}</DialogTitle>
            <DialogDescription>
              {isCreate ? "Add a local vault or markdown folder." : `Edit settings for "${source.name}".`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Name">
              <Input placeholder="My notes" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Path">
              <Input placeholder="/home/user/notes" value={path} onChange={(e) => setPath(e.target.value)} />
            </Field>
            <Field label="Remote URL (optional)">
              <Input placeholder="git@github.com:user/repo.git" value={remoteUrl} onChange={(e) => setRemoteUrl(e.target.value)} />
            </Field>
            {isCreate && (
              <Field label="Project">
                <ProjectPicker selectedProjectId={projectId} onSelect={setProjectId} />
              </Field>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={!canSubmit || submitting}>{submitLabel}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <OpsecWarningDialog open={showOpsecWarning} onOpenChange={setShowOpsecWarning} onAcknowledge={handleOpsecAcknowledge} />
    </>
  );
}
