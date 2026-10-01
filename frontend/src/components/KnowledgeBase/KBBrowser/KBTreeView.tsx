/**
 * KBTreeView -- Collapsible folder tree with WAI-ARIA tree roles and context menus.
 *
 * Renders the KB source tree as a navigable folder structure.
 * Folders sorted before files, active document highlighted.
 * Ctrl+click and middle-click open documents in new tabs.
 * Right-click on files/folders shows context menus.
 * Supports highlight flash + scroll-into-view for "Reveal in navigation".
 */
import { useEffect, useMemo, useRef } from "react";
import {
  Bookmark,
  Clipboard,
  FileText,
  FolderOpen,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";

import { useKBStore } from "@/stores/kbStore";
import type { KBTreeNode as KBTreeNodeType } from "@/types/kb";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

import { KBTreeNode } from "./KBTreeNode";
import { TagPill } from "./TagPill";

interface KBTreeViewProps {
  tree: KBTreeNodeType | null;
  activeDocId: string | null;
  expandedFolders: string[];
  isLoading: boolean;
  onToggleFolder: (path: string) => void;
  onSelectDoc: (docId: string, openInNewTab?: boolean) => void;
  onCopyPath: (path: string) => void;
  onCollapseAll?: (folderPath: string) => void;
  onRename?: (docId: string, currentTitle: string) => void;
  onDelete?: (docId: string, currentTitle: string) => void;
  isReadOnly?: boolean;
  highlightDocId?: string | null;
}

export function KBTreeView({
  tree,
  activeDocId,
  expandedFolders,
  isLoading,
  onToggleFolder,
  onSelectDoc,
  onCopyPath,
  onCollapseAll,
  onRename,
  onDelete,
  isReadOnly,
  highlightDocId,
}: KBTreeViewProps) {
  const treeSortOrder = useKBStore((s) => s.treeSortOrder);

  const sortedRootChildren = useMemo(() => {
    if (!tree) return [];
    const arr = [...tree.children];
    if (treeSortOrder === "name-desc") {
      return arr.sort((a, b) => b.name.localeCompare(a.name));
    }
    return arr.sort((a, b) => a.name.localeCompare(b.name));
  }, [tree, treeSortOrder]);

  const sortedRootDocs = useMemo(() => {
    if (!tree) return [];
    const arr = [...tree.docs];
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
  }, [tree, treeSortOrder]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!tree || (tree.children.length === 0 && tree.docs.length === 0)) {
    return (
      <div className="px-3 py-6 text-center text-sm text-slate-500">
        No documents
      </div>
    );
  }

  return (
    <nav aria-label="Document tree">
      <ul role="tree">
        {sortedRootChildren.map((child) => (
          <KBTreeNode
            key={child.name}
            node={child}
            level={1}
            activeDocId={activeDocId}
            expandedFolders={expandedFolders}
            parentPath=""
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
        {sortedRootDocs.map((doc) => {
          const isActive = doc.id === activeDocId;
          return (
            <RootFileItem
              key={doc.id}
              doc={doc}
              isActive={isActive}
              isReadOnly={isReadOnly}
              isHighlighted={doc.id === highlightDocId}
              onSelectDoc={onSelectDoc}
              onCopyPath={onCopyPath}
              onRename={onRename}
              onDelete={onDelete}
            />
          );
        })}
      </ul>
    </nav>
  );
}

/* Root-level file item with context menu */
function RootFileItem({
  doc,
  isActive,
  isReadOnly,
  isHighlighted,
  onSelectDoc,
  onCopyPath,
  onRename,
  onDelete,
}: {
  doc: { id: string; title: string; relative_path: string; tags?: string | null };
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
  const rowClassName =
    isHighlighted
      ? "flex w-full items-center gap-1.5 rounded px-2 py-1 text-sm text-primary bg-primary/20 transition-colors duration-700 cursor-pointer select-none"
      : isActive
        ? "flex w-full items-center gap-1.5 rounded border-l-2 border-primary bg-primary/10 px-2 py-1 text-sm text-primary"
        : "flex w-full items-center gap-1.5 rounded px-2 py-1 text-sm text-slate-400 hover:bg-white/[0.05] hover:text-slate-200 cursor-pointer select-none";

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
          aria-level={1}
          aria-selected={isActive}
        >
          <div className={rowClassName} style={{ paddingLeft: "12px" }}>
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
