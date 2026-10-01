/**
 * KBDocTabs -- Pane-aware tab bar container with unsaved-changes guard
 * and context menus.
 *
 * Reads tab state from the current pane via PaneContext.
 * When closing a tab with unsaved changes, shows an AlertDialog
 * confirmation before proceeding (EDIT-06).
 * "+" opens a blank "new tab" landing page instead of a dialog.
 * Context menu actions: close others, close to right, close all,
 * copy path, split right/down.
 */
import { useCallback, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { useKBStore } from "@/stores/kbStore";
import { usePaneId } from "./PaneContext";
import { KBTabItem } from "./KBTabItem";
import { RenameDialog } from "./RenameDialog";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
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
import type { KBTab } from "@/types/kb";

const EMPTY_TABS: KBTab[] = [];
const EMPTY_IDS: string[] = [];

export function KBDocTabs() {
  const paneId = usePaneId();

  // Pane-scoped state
  const pane = useKBStore((s) => s.panes[paneId]);
  const openTabs = pane?.openTabs ?? EMPTY_TABS;
  const activeTabId = pane?.activeTabId ?? null;
  const pinnedTabIds = pane?.pinnedTabIds ?? EMPTY_IDS;

  // Pane-scoped actions
  const closeTabInPane = useKBStore((s) => s.closeTabInPane);
  const setActivePaneTab = useKBStore((s) => s.setActivePaneTab);
  const closeOtherTabsInPane = useKBStore((s) => s.closeOtherTabsInPane);
  const closeTabsToRightInPane = useKBStore((s) => s.closeTabsToRightInPane);
  const closeAllTabsInPane = useKBStore((s) => s.closeAllTabsInPane);
  const openNewTabInPane = useKBStore((s) => s.openNewTabInPane);
  const splitPane = useKBStore((s) => s.splitPane);
  const openLinkedView = useKBStore((s) => s.openLinkedView);

  // Shared (non-pane-scoped) state and actions
  const clearEditBuffer = useKBStore((s) => s.clearEditBuffer);
  const isDocDirty = useKBStore((s) => s.isDocDirty);
  const revealInNavigation = useKBStore((s) => s.revealInNavigation);
  const editModes = useKBStore((s) => s.editModes);
  const docCache = useKBStore((s) => s.docCache);
  const setEditMode = useKBStore((s) => s.setEditMode);

  const pinTab = useKBStore((s) => s.pinTab);
  const unpinTab = useKBStore((s) => s.unpinTab);

  const bookmarkIds = useKBStore((s) => s.bookmarkIds);
  const toggleBookmark = useKBStore((s) => s.toggleBookmark);

  const renameDoc = useKBStore((s) => s.renameDoc);
  const deleteDoc = useKBStore((s) => s.deleteDoc);

  // Can split only when there is a single pane
  const canSplit = useKBStore((s) => Object.keys(s.panes).length < 2);

  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(
    null,
  );
  const [renameTarget, setRenameTarget] = useState<{
    docId: string;
    title: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    docId: string;
    title: string;
  } | null>(null);

  const sortedTabs = useMemo(() => {
    const pinned = openTabs.filter((t) => pinnedTabIds.includes(t.id));
    const unpinned = openTabs.filter((t) => !pinnedTabIds.includes(t.id));
    return [...pinned, ...unpinned];
  }, [openTabs, pinnedTabIds]);

  const handleClose = (tabId: string) => {
    if (pinnedTabIds.includes(tabId)) return;
    const tab = openTabs.find((t) => t.id === tabId);
    if (tab?.type === "new") {
      closeTabInPane(paneId, tabId);
      return;
    }
    if (tab && isDocDirty(tab.docId)) {
      setPendingCloseTabId(tabId);
      return;
    }
    const docId = tab?.docId;
    if (docId) clearEditBuffer(docId);
    closeTabInPane(paneId, tabId);
  };

  const confirmClose = () => {
    if (!pendingCloseTabId) return;
    const tab = openTabs.find((t) => t.id === pendingCloseTabId);
    if (tab) clearEditBuffer(tab.docId);
    closeTabInPane(paneId, pendingCloseTabId);
    setPendingCloseTabId(null);
  };

  const cancelClose = () => {
    setPendingCloseTabId(null);
  };

  const handleRename = async (newTitle: string) => {
    if (!renameTarget) return;
    await renameDoc(renameTarget.docId, newTitle);
    setRenameTarget(null);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteDoc(deleteTarget.docId);
    setDeleteTarget(null);
  };

  const handleCopyPath = useCallback((docId: string) => {
    const cached = useKBStore.getState().docCache[docId];
    if (cached) {
      navigator.clipboard.writeText(cached.relative_path).then(() => {
        toast.success("Path copied to clipboard");
      });
    }
  }, []);

  const pendingTab = openTabs.find((t) => t.id === pendingCloseTabId);

  return (
    <>
      <div
        role="tablist"
        aria-label="Open documents"
        className="flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-white/5 bg-black/40 px-2"
      >
        {sortedTabs.map((tab) => {
          const isDoc = tab.type === "doc";
          const tabIsEditing = isDoc
            ? (editModes[tab.docId] ?? false)
            : false;
          const tabIsReadOnly = isDoc
            ? (docCache[tab.docId]?.source?.read_only ?? true)
            : true;

          return (
            <KBTabItem
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              onActivate={() => setActivePaneTab(paneId, tab.id)}
              onClose={() => handleClose(tab.id)}
              onCloseOthers={() => closeOtherTabsInPane(paneId, tab.id)}
              onCloseToRight={() => closeTabsToRightInPane(paneId, tab.id)}
              onCloseAll={() => closeAllTabsInPane(paneId)}
              onCopyPath={
                isDoc ? () => handleCopyPath(tab.docId) : undefined
              }
              onRevealInNavigation={
                isDoc ? () => revealInNavigation(tab.docId) : undefined
              }
              onRename={
                isDoc && !tabIsReadOnly
                  ? () =>
                      setRenameTarget({
                        docId: tab.docId,
                        title: tab.title,
                      })
                  : undefined
              }
              onDelete={
                isDoc && !tabIsReadOnly
                  ? () =>
                      setDeleteTarget({
                        docId: tab.docId,
                        title: tab.title,
                      })
                  : undefined
              }
              isPinned={pinnedTabIds.includes(tab.id)}
              onPin={isDoc ? () => pinTab(tab.id) : undefined}
              onUnpin={isDoc ? () => unpinTab(tab.id) : undefined}
              isBookmarked={isDoc ? bookmarkIds.includes(tab.docId) : false}
              onBookmark={
                isDoc ? () => toggleBookmark(tab.docId) : undefined
              }
              isEditing={tabIsEditing}
              isReadOnly={tabIsReadOnly}
              onToggleEditMode={
                isDoc && !tabIsReadOnly
                  ? () => setEditMode(tab.docId, !tabIsEditing)
                  : undefined
              }
              onSplitRight={
                isDoc && canSplit
                  ? () =>
                      splitPane(
                        paneId,
                        "horizontal",
                        tab.docId,
                        tab.title,
                        tab.sourceId,
                      )
                  : undefined
              }
              onSplitDown={
                isDoc && canSplit
                  ? () =>
                      splitPane(
                        paneId,
                        "vertical",
                        tab.docId,
                        tab.title,
                        tab.sourceId,
                      )
                  : undefined
              }
              onOpenLinkedView={
                isDoc && canSplit
                  ? () => openLinkedView(paneId)
                  : undefined
              }
            />
          );
        })}
        <button
          type="button"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-500 hover:text-slate-300 hover:bg-white/5"
          onClick={() => openNewTabInPane(paneId)}
          aria-label="New tab"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <AlertDialog
        open={pendingCloseTabId !== null}
        onOpenChange={(open) => {
          if (!open) cancelClose();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{pendingTab?.title ?? "Document"}&quot; has unsaved
              changes. Are you sure you want to close it? Your changes will
              be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelClose}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmClose}
              className="bg-red-600 hover:bg-red-700"
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RenameDialog
        open={renameTarget !== null}
        currentTitle={renameTarget?.title ?? ""}
        onConfirm={handleRename}
        onCancel={() => setRenameTarget(null)}
      />
      <DeleteConfirmDialog
        open={deleteTarget !== null}
        title={deleteTarget?.title ?? ""}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
