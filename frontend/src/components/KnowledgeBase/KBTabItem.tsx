/**
 * KBTabItem -- Single tab in the document tab bar with right-click context menu.
 *
 * Active tab: solid background, visible close button.
 * Inactive tab: muted text, close button on hover.
 * Middle-click closes the tab.
 * Right-click shows context menu with close actions and stubs.
 */
import {
  Bookmark,
  Clipboard,
  Eye,
  FileText,
  Link2,
  Navigation,
  Pencil,
  Pin,
  PinOff,
  Plus,
  PanelRight,
  PanelBottom,
  Trash2,
  X,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useKBStore } from "@/stores/kbStore";
import type { KBTab } from "@/types/kb";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

interface KBTabItemProps {
  tab: KBTab;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseToRight: () => void;
  onCloseAll: () => void;
  onCopyPath?: () => void;
  onRevealInNavigation?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  isPinned?: boolean;
  onPin?: () => void;
  onUnpin?: () => void;
  isBookmarked?: boolean;
  onBookmark?: () => void;
  isEditing?: boolean;
  isReadOnly?: boolean;
  onToggleEditMode?: () => void;
  onSplitRight?: () => void;
  onSplitDown?: () => void;
  onOpenLinkedView?: () => void;
}

export function KBTabItem({
  tab,
  isActive,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onCloseAll,
  onCopyPath,
  onRevealInNavigation,
  onRename,
  onDelete,
  isPinned,
  onPin,
  onUnpin,
  isBookmarked,
  onBookmark,
  isEditing,
  isReadOnly,
  onToggleEditMode,
  onSplitRight,
  onSplitDown,
  onOpenLinkedView,
}: KBTabItemProps) {
  const isBlank = tab.type === 'new';
  const isDirty = useKBStore((s) => {
    if (isBlank) return false;
    const buffer = s.editBuffers[tab.docId];
    if (buffer === undefined) return false;
    const cached = s.docCache[tab.docId];
    return buffer !== (cached?.body ?? "");
  });

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="tab"
          aria-selected={isActive}
          className={cn(
            "group flex h-7 items-center gap-1.5 rounded-t px-3 text-xs font-medium cursor-pointer select-none transition-colors",
            isActive
              ? "bg-[#0e1420] text-slate-200 border-t border-x border-white/10"
              : "text-slate-500 hover:text-slate-300 hover:bg-white/5",
          )}
          onClick={onActivate}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              if (!isPinned) onClose();
            }
          }}
        >
          {isDirty && (
            <span
              className="size-1.5 shrink-0 rounded-full bg-amber-400"
              aria-label="Unsaved changes"
            />
          )}
          {isPinned && (
            <Pin className="h-3 w-3 shrink-0 text-slate-400" />
          )}
          {isBlank ? (
            <Plus className="h-3 w-3 shrink-0" />
          ) : (
            <FileText className="h-3 w-3 shrink-0" />
          )}
          <span className="max-w-[140px] truncate">{tab.title}</span>
          {!isPinned && (
            <button
              type="button"
              className={cn(
                "ml-0.5 rounded p-0.5 hover:bg-white/10",
                isActive
                  ? "opacity-100 text-slate-400 hover:text-slate-200"
                  : "opacity-0 group-hover:opacity-100 text-slate-500 hover:text-slate-300",
              )}
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              aria-label={`Close ${tab.title}`}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {isBlank ? (
          /* Blank tabs: only Close */
          <ContextMenuItem onSelect={onClose}>
            <X className="h-4 w-4" />
            Close
          </ContextMenuItem>
        ) : (
          /* Document tabs: full menu */
          <>
            <ContextMenuItem onSelect={onClose}>
              <X className="h-4 w-4" />
              Close
            </ContextMenuItem>
            <ContextMenuItem onSelect={onCloseOthers}>
              <XCircle className="h-4 w-4" />
              Close others
            </ContextMenuItem>
            <ContextMenuItem onSelect={onCloseToRight}>
              <XCircle className="h-4 w-4" />
              Close tabs to the right
            </ContextMenuItem>
            <ContextMenuItem onSelect={onCloseAll}>
              <XCircle className="h-4 w-4" />
              Close all
            </ContextMenuItem>
            <ContextMenuSeparator />
            {isPinned ? (
              <ContextMenuItem onSelect={onUnpin}>
                <PinOff className="h-4 w-4" />
                Unpin
              </ContextMenuItem>
            ) : (
              <ContextMenuItem onSelect={onPin}>
                <Pin className="h-4 w-4" />
                Pin
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={onSplitRight}
              disabled={!onSplitRight}
            >
              <PanelRight className="h-4 w-4" />
              Split right
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={onSplitDown}
              disabled={!onSplitDown}
            >
              <PanelBottom className="h-4 w-4" />
              Split down
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={onOpenLinkedView}
              disabled={!onOpenLinkedView}
            >
              <Link2 className="h-4 w-4" />
              Open linked view
            </ContextMenuItem>
            <ContextMenuSeparator />
            {!isReadOnly && onToggleEditMode && (
              <ContextMenuItem onSelect={onToggleEditMode}>
                {isEditing ? (
                  <>
                    <Eye className="h-4 w-4" />
                    Switch to Reading view
                  </>
                ) : (
                  <>
                    <Pencil className="h-4 w-4" />
                    Switch to Live Preview
                  </>
                )}
              </ContextMenuItem>
            )}
            {!isReadOnly && (onRename || onDelete) && (
              <>
                <ContextMenuSeparator />
                {onRename && (
                  <ContextMenuItem onSelect={onRename}>
                    <Pencil className="h-4 w-4" />
                    Rename
                  </ContextMenuItem>
                )}
                {onDelete && (
                  <ContextMenuItem onSelect={onDelete}>
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </ContextMenuItem>
                )}
              </>
            )}
            <ContextMenuSeparator />
            {onCopyPath && (
              <ContextMenuItem onSelect={onCopyPath}>
                <Clipboard className="h-4 w-4" />
                Copy path
              </ContextMenuItem>
            )}
            <ContextMenuItem
              onSelect={onRevealInNavigation}
              disabled={!onRevealInNavigation}
            >
              <Navigation className="h-4 w-4" />
              Reveal in navigation
            </ContextMenuItem>
            {onBookmark && (
              <ContextMenuItem onSelect={onBookmark}>
                <Bookmark className="h-4 w-4" />
                {isBookmarked ? "Remove bookmark" : "Bookmark"}
              </ContextMenuItem>
            )}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
