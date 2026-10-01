/**
 * RenameDialog -- Modal dialog for renaming a document.
 *
 * Triggered from context menus (sidebar tree, tab bar).
 * Shows an input pre-filled with the current title.
 * Confirm calls the rename callback; Cancel dismisses.
 *
 * Uses inner-component pattern: RenameForm remounts when dialog opens,
 * seeding local state with the current title (React Compiler-safe).
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface RenameDialogProps {
  open: boolean;
  currentTitle: string;
  onConfirm: (newTitle: string) => void;
  onCancel: () => void;
}

export function RenameDialog({
  open,
  currentTitle,
  onConfirm,
  onCancel,
}: RenameDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        {open && (
          <RenameForm
            currentTitle={currentTitle}
            onConfirm={onConfirm}
            onCancel={onCancel}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Inner form that remounts each time the dialog opens. */
function RenameForm({
  currentTitle,
  onConfirm,
  onCancel,
}: {
  currentTitle: string;
  onConfirm: (newTitle: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(currentTitle);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === currentTitle) {
      onCancel();
      return;
    }
    onConfirm(trimmed);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Rename document</DialogTitle>
      </DialogHeader>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
        }}
        autoFocus
        placeholder="New title"
      />
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!value.trim()}>
          Rename
        </Button>
      </DialogFooter>
    </>
  );
}
