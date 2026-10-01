/**
 * KBTreeNode -- Folder (Radix Collapsible) or file with selection, WAI-ARIA tree roles,
 * and right-click context menus.
 * Ctrl+click and middle-click open documents in new tabs.
 * Supports highlight flash + scroll-into-view for "Reveal in navigation".
 */
import { useEffect, useMemo, useRef } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import {
  ChevronRight,
  Clipboard,
  FileText,
  FilePlus,
  Folder,
  FolderMinus,
  FolderOpen,
  Pencil,
  Bookmark,
  Trash2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useKBStore } from "@/stores/kbStore";
import type { KBTreeNode as KBTreeNodeType } from "@/types/kb";
import { TagPill } from "./TagPill";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

interface KBTreeNodeProps {
  node: KBTreeNodeType;
  level: number;
  activeDocId: string | null;
  expandedFolders: string[];
  parentPath: string;
  onToggleFolder: (path: string) => void;
  onSelectDoc: (docId: string, openInNewTab?: boolean) => void;
  onCopyPath: (path: string) => void;
  onCollapseAll?: (folderPath: string) => void;
  onRename?: (docId: string, currentTitle: string) => void;
  onDelete?: (docId: string, currentTitle: string) => void;
  isReadOnly?: boolean;
  highlightDocId?: string | null;
}

export function KBTreeNode({
  node,
  level,
  activeDocId,
  expandedFolders,
  parentPath,
  onToggleFolder,
  onSelectDoc,
  onCopyPath,
  onCollapseAll,
  onRename,
  onDelete,
  isReadOnly,
  highlightDocId,
}: KBTreeNodeProps) {
  const treeSortOrder = useKBStore((s) => s.treeSortOrder);
  const fullPath = parentPath ? `${parentPath}/${node.name}` : node.name;
  const isFolder = node.type === "folder" || node.children.length > 0;

  const sortedChildren = useMemo(() => {
    const arr = [...node.children];
    if (treeSortOrder === "name-desc") {
      return arr.sort((a, b) => b.name.localeCompare(a.name));
    }
    // For "name-asc" and "modified-desc", folders always sort by name ascending
    return arr.sort((a, b) => a.name.localeCompare(b.name));
  }, [node.children, treeSortOrder]);

  const sortedDocs = useMemo(() => {
    const arr = [...node.docs];
    if (treeSortOrder === "name-desc") {
      return arr.sort((a, b) => b.title.localeCompare(a.title));
    }
    if (treeSortOrder === "modified-desc") {
      return arr.sort((a, b) => {
        const aTime = a.updated_at ?? "";
        const bTime = b.updated_at ?? "";
        return bTime.localeCompare(aTime);
      });
    }
    return arr.sort((a, b) => a.title.localeCompare(b.title));
  }, [node.docs, treeSortOrder]);

  if (!isFolder) return null;

  const isOpen = expandedFolders.includes(fullPath);

  return (
    <li role="treeitem" aria-expanded={isOpen} aria-level={level}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div>
            <Collapsible.Root open={isOpen} onOpenChange={() => onToggleFolder(fullPath)}>
              <Collapsible.Trigger
                className={cn(
                  "flex w-full items-center gap-1.5 rounded px-2 py-1 text-sm",
                  "text-slate-300 hover:bg-white/[0.05] hover:text-slate-100",
                  "cursor-pointer select-none",
                )}
                style={{ paddingLeft: `${level * 12}px` }}
              >
                <ChevronRight className={cn(
                  "h-3.5 w-3.5 shrink-0 transition-transform duration-150",
                  isOpen && "rotate-90",
                )} />
                <Folder className="h-4 w-4 shrink-0 text-amber-400/80" />
                <span className="truncate">{node.name}</span>
              </Collapsible.Trigger>

              <Collapsible.Content>
                <ul role="group">
                  {sortedChildren.map((child) => (
                    <KBTreeNode
                      key={child.name}
                      node={child}
                      level={level + 1}
                      activeDocId={activeDocId}
                      expandedFolders={expandedFolders}
                      parentPath={fullPath}
                      onToggleFolder={onToggleFolder}
                      onSelectDoc={onSelectDoc}
                      onCopyPath={onCopyPath}
                      onCollapseAll={onCollapseAll}
                      onRename={onRename}
                      onDelete={onDelete}
                      isReadOnly={isReadOnly}
                      highlightDocId={highlightDocId}
                    />
                  ))}
                  {sortedDocs.map((doc) => (
                    <FileTreeItem
                      key={doc.id}
                      doc={doc}
                      level={level + 1}
                      isActive={doc.id === activeDocId}
                      isReadOnly={isReadOnly}
                      isHighlighted={doc.id === highlightDocId}
                      onSelectDoc={onSelectDoc}
                      onCopyPath={onCopyPath}
                      onRename={onRename}
                      onDelete={onDelete}
                    />
                  ))}
                </ul>
              </Collapsible.Content>
            </Collapsible.Root>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {!isReadOnly && (
            <ContextMenuItem disabled>
              <FilePlus className="h-4 w-4" />
              New note here
            </ContextMenuItem>
          )}
          <ContextMenuItem onSelect={() => onCopyPath(fullPath)}>
            <Clipboard className="h-4 w-4" />
            Copy path
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onCollapseAll?.(fullPath)}>
            <FolderMinus className="h-4 w-4" />
            Collapse all subfolders
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </li>
  );
}

/* File tree item -- extracted for context menu wrapping */
function FileTreeItem({
  doc,
  level,
  isActive,
  isReadOnly,
  isHighlighted,
  onSelectDoc,
  onCopyPath,
  onRename,
  onDelete,
}: {
  doc: { id: string; title: string; relative_path: string; tags?: string | null };
  level: number;
  isActive: boolean;
  isReadOnly?: boolean;
  isHighlighted?: boolean;
  onSelectDoc: (docId: string, openInNewTab?: boolean) => void;
  onCopyPath: (path: string) => void;
  onRename?: (docId: string, currentTitle: string) => void;
  onDelete?: (docId: string, currentTitle: string) => void;
}) {
  const bookmarkIds = useKBStore((s) => s.bookmarkIds);
  const toggleBookmark = useKBStore((s) => s.toggleBookmark);
  const setActiveTag = useKBStore((s) => s.setActiveTag);
  const itemRef = useRef<HTMLLIElement>(null);
  const isDocBookmarked = bookmarkIds.includes(doc.id);

  const MAX_VISIBLE_TAGS = 2;
  const tagList = doc.tags?.split(" ").filter(Boolean) ?? [];
  const visibleTags = tagList.slice(0, MAX_VISIBLE_TAGS);
  const overflowCount = tagList.length - visibleTags.length;
  const rowClassName = cn(
    "flex w-full items-center gap-1.5 rounded px-2 py-1 text-sm transition-colors duration-700",
    "cursor-pointer select-none",
    isHighlighted
      ? "bg-primary/20 text-primary"
      : isActive
        ? "border-l-2 border-primary bg-primary/10 text-primary"
        : "text-slate-400 hover:bg-white/[0.05] hover:text-slate-200",
  );

  // Scroll into view when highlighted (Reveal in navigation)
  useEffect(() => {
    if (isHighlighted && itemRef.current) {
      itemRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [isHighlighted]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li
          ref={itemRef}
          role="treeitem"
          aria-level={level}
          aria-selected={isActive}
        >
          <div className={rowClassName} style={{ paddingLeft: `${level * 12}px` }}>
            <button
              type="button"
              onClick={(e) => {
                const newTab = e.ctrlKey || e.metaKey;
                onSelectDoc(doc.id, newTab || undefined);
              }}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onSelectDoc(doc.id, true);
                }
              }}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left focus:outline-none"
            >
              <FileText className="h-3.5 w-3.5 shrink-0" />
              {isDocBookmarked && (
                <Bookmark className="h-3 w-3 shrink-0 text-amber-400/70" />
              )}
              <span className="min-w-0 truncate">{doc.title}</span>
            </button>
            {visibleTags.length > 0 && (
              <div
                className="ml-auto flex shrink-0 items-center gap-0.5 pl-2"
                onClick={(e) => e.stopPropagation()}
                onAuxClick={(e) => e.stopPropagation()}
              >
                {visibleTags.map((tag) => (
                  <TagPill key={tag} tag={tag} size="sm" onClick={setActiveTag} />
                ))}
                {overflowCount > 0 && (
                  <span className="text-[10px] text-slate-500">+{overflowCount}</span>
                )}
              </div>
            )}
          </div>
        </li>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onSelectDoc(doc.id)}>
          <FolderOpen className="h-4 w-4" />
          Open
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onSelectDoc(doc.id, true)}>
          <FileText className="h-4 w-4" />
          Open in new tab
        </ContextMenuItem>
        <ContextMenuSeparator />
        {!isReadOnly && (
          <>
            <ContextMenuItem onSelect={() => onRename?.(doc.id, doc.title)}>
              <Pencil className="h-4 w-4" />
              Rename
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => onDelete?.(doc.id, doc.title)}>
              <Trash2 className="h-4 w-4" />
              Delete
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onSelect={() => onCopyPath(doc.relative_path)}>
          <Clipboard className="h-4 w-4" />
          Copy path
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => toggleBookmark(doc.id)}>
          <Bookmark className="h-4 w-4" />
          {isDocBookmarked ? "Remove bookmark" : "Bookmark"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
