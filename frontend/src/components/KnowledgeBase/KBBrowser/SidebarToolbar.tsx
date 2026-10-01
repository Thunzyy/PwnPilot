/**
 * SidebarToolbar -- Row of 5 icon buttons above the file tree.
 * Actions: New note, New folder, Sort order, Reveal current file, Collapse all.
 * Hidden during search mode (controlled by parent KBSidebar).
 */
import {
  FilePlus,
  FolderPlus,
  ArrowDownAZ,
  ArrowUpZA,
  Clock,
  Crosshair,
  FoldVertical,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { TreeSortOrder } from "@/types/kb";

interface SidebarToolbarProps {
  onNewNote: () => void;
  onNewFolder: () => void;
  sortOrder: TreeSortOrder;
  onCycleSortOrder: () => void;
  onRevealCurrentFile: () => void;
  onCollapseAll: () => void;
}

function ToolbarButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-slate-500 hover:text-slate-300"
          onClick={onClick}
          aria-label={label}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

const SORT_CONFIG: Record<TreeSortOrder, { icon: typeof ArrowDownAZ; label: string }> = {
  "name-asc": { icon: ArrowDownAZ, label: "Sort: A-Z" },
  "name-desc": { icon: ArrowUpZA, label: "Sort: Z-A" },
  "modified-desc": { icon: Clock, label: "Sort: Modified" },
};

export function SidebarToolbar({
  onNewNote,
  onNewFolder,
  sortOrder,
  onCycleSortOrder,
  onRevealCurrentFile,
  onCollapseAll,
}: SidebarToolbarProps) {
  const { icon: SortIcon, label: sortLabel } = SORT_CONFIG[sortOrder];

  return (
    <div className="flex items-center gap-0.5 border-b border-white/5 px-2 py-1">
      <ToolbarButton
        icon={<FilePlus className="h-3.5 w-3.5" />}
        label="New note"
        onClick={onNewNote}
      />
      <ToolbarButton
        icon={<FolderPlus className="h-3.5 w-3.5" />}
        label="New folder"
        onClick={onNewFolder}
      />
      <ToolbarButton
        icon={<SortIcon className="h-3.5 w-3.5" />}
        label={sortLabel}
        onClick={onCycleSortOrder}
      />
      <ToolbarButton
        icon={<Crosshair className="h-3.5 w-3.5" />}
        label="Reveal current file"
        onClick={onRevealCurrentFile}
      />
      <ToolbarButton
        icon={<FoldVertical className="h-3.5 w-3.5" />}
        label="Collapse all"
        onClick={onCollapseAll}
      />
    </div>
  );
}
