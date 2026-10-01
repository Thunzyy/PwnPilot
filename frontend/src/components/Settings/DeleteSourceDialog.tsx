import { useState } from "react";
import type { KBSource } from "@/types/kb";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function DeleteSourceDialog({
  source,
  open,
  onOpenChange,
  onConfirm,
}: {
  source: KBSource | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (deleteFiles: boolean) => void;
}) {
  const [deleteFiles, setDeleteFiles] = useState(false);

  if (!source) return null;

  const isCommunity = source.source_type === "community";

  function handleConfirm() {
    onConfirm(deleteFiles);
    setDeleteFiles(false);
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Remove &ldquo;{source.name}&rdquo;?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-slate-400">
            This will remove the source from PwnPilot and unindex all its
            documents.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {isCommunity ? (
          <div className="flex items-center gap-2 py-2">
            <Checkbox
              id="delete-files"
              checked={deleteFiles}
              onCheckedChange={(v) => setDeleteFiles(v === true)}
            />
            <label
              htmlFor="delete-files"
              className="text-sm text-slate-400 cursor-pointer select-none"
            >
              Also delete local files
            </label>
          </div>
        ) : (
          <p className="text-xs text-slate-500 py-2">
            Local vault files will be preserved on disk.
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-600 hover:bg-red-700"
            onClick={handleConfirm}
          >
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
