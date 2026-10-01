/**
 * KBEditToggle -- Edit/preview mode toggle button for the document toolbar.
 *
 * Hidden entirely for read-only sources (EDIT-03). Shows Pencil icon
 * when in Reading view, Eye icon when in Live Preview. Ctrl+E toggles via
 * the keyboard handler in KnowledgeBase.tsx.
 *
 * Terminology (LP-04):
 * - Tooltip: "Reading view (Ctrl+E)" when in Live Preview
 * - Tooltip: "Live Preview (Ctrl+E)" when in Reading view
 */
import { Eye, Pencil } from "lucide-react";

import { useKBStore } from "@/stores/kbStore";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface KBEditToggleProps {
  docId: string;
  isReadOnly: boolean;
}

export function KBEditToggle({ docId, isReadOnly }: KBEditToggleProps) {
  const isEditing = useKBStore((s) => s.editModes[docId] ?? false);
  const setEditMode = useKBStore((s) => s.setEditMode);

  // EDIT-03: completely absent for read-only sources
  if (isReadOnly) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-slate-500 hover:text-slate-300"
          onClick={() => setEditMode(docId, !isEditing)}
          aria-label={isEditing ? "Switch to Reading view" : "Switch to Live Preview"}
        >
          {isEditing ? (
            <Eye className="h-4 w-4" />
          ) : (
            <Pencil className="h-4 w-4" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {isEditing ? "Reading view (Ctrl+E)" : "Live Preview (Ctrl+E)"}
      </TooltipContent>
    </Tooltip>
  );
}
