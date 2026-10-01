import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { kbApi } from "@/api/kb";
import { showApiErrorToast } from "@/lib/apiToast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { TagDetailRow } from "./TagDetailRow";
import type { KBTagInfo } from "@/types/kb";

export function TagManagement() {
  const [tags, setTags] = useState<KBTagInfo[]>([]);
  const [loading, setLoading] = useState(false);

  // Rename state
  const [renameTag, setRenameTag] = useState<KBTagInfo | null>(null);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState(false);

  // Delete state
  const [deleteTag, setDeleteTag] = useState<KBTagInfo | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchTags = useCallback(async () => {
    setLoading(true);
    try {
      const data = await kbApi.getTags();
      setTags(data);
    } catch (error) {
      showApiErrorToast(
        "Failed to load tags",
        error,
        "Could not load knowledge base tags.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  async function handleRename() {
    if (!renameTag) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === renameTag.tag || trimmed.includes(" ")) return;

    setRenaming(true);
    try {
      const result = await kbApi.renameTag(renameTag.tag, trimmed);
      const parts = [
        `Renamed "${renameTag.tag}" → "${trimmed}" in ${result.docs_updated} doc(s)`,
      ];
      if (result.read_only_skipped > 0) {
        parts.push(`${result.read_only_skipped} read-only skipped`);
      }
      toast.success(parts.join(". "));
      setRenameTag(null);
      fetchTags();
    } catch (error) {
      showApiErrorToast(
        "Failed to rename tag",
        error,
        "Could not rename this tag.",
      );
    } finally {
      setRenaming(false);
    }
  }

  async function handleDelete() {
    if (!deleteTag) return;

    setDeleting(true);
    try {
      const result = await kbApi.deleteTag(deleteTag.tag);
      const parts = [
        `Removed "${deleteTag.tag}" from ${result.docs_updated} doc(s)`,
      ];
      if (result.read_only_skipped > 0) {
        parts.push(`${result.read_only_skipped} read-only skipped`);
      }
      toast.success(parts.join(". "));
      setDeleteTag(null);
      fetchTags();
    } catch (error) {
      showApiErrorToast(
        "Failed to delete tag",
        error,
        "Could not delete this tag.",
      );
    } finally {
      setDeleting(false);
    }
  }

  const renameValid =
    newName.trim().length > 0 &&
    newName.trim() !== renameTag?.tag &&
    !newName.trim().includes(" ");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">
          Tags ({tags.length})
        </h3>
        <Button
          variant="ghost"
          size="sm"
          className="text-slate-400 hover:text-white"
          onClick={fetchTags}
          disabled={loading}
        >
          <RefreshCw
            className={`size-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {tags.length > 0 ? (
        <div className="space-y-0.5">
          {tags.map((t) => (
            <TagDetailRow
              key={t.tag}
              tag={t}
              onRename={(tag) => {
                setRenameTag(tag);
                setNewName(tag.tag);
              }}
              onDelete={setDeleteTag}
              onBulkComplete={fetchTags}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-600 py-4 text-center">
          No tags yet.
        </p>
      )}

      {/* Rename dialog */}
      <Dialog
        open={renameTag !== null}
        onOpenChange={(open) => !open && setRenameTag(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename tag</DialogTitle>
          </DialogHeader>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New tag name"
            onKeyDown={(e) => e.key === "Enter" && renameValid && handleRename()}
          />
          {newName.trim().includes(" ") && (
            <p className="text-xs text-red-400">Tags cannot contain spaces.</p>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setRenameTag(null)}
              disabled={renaming}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRename}
              disabled={!renameValid || renaming}
            >
              {renaming ? "Renaming..." : "Rename"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={deleteTag !== null}
        onOpenChange={(open) => !open && setDeleteTag(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete tag</AlertDialogTitle>
            <AlertDialogDescription>
              Remove &ldquo;{deleteTag?.tag}&rdquo; from{" "}
              {deleteTag?.count} document(s)? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
