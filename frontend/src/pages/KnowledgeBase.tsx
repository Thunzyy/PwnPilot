import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";

import { useKBStore } from "../stores/kbStore";
import { KBSidebar } from "@/components/KnowledgeBase/KBSidebar";
import { KBResizableLayout } from "@/components/KnowledgeBase/KBResizableLayout";
import { RenameDialog } from "@/components/KnowledgeBase/RenameDialog";
import { DeleteConfirmDialog } from "@/components/KnowledgeBase/DeleteConfirmDialog";
import { useKBSources } from "@/hooks/useKBSources";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";

interface KnowledgeBaseProps {
  embedded?: boolean;
  projectId?: string;
}

export function KnowledgeBase({
  embedded = false,
}: KnowledgeBaseProps = {}) {
  const { docId: urlDocId } = useParams<{ docId?: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const collapseRef = useRef<(() => void) | undefined>(undefined);

  useKBSources();
  const activeDocId = useKBStore((s) => s.activeDocId);
  const requestSearchFocus = useKBStore((s) => s.requestSearchFocus);
  const renameDoc = useKBStore((s) => s.renameDoc);
  const deleteDoc = useKBStore((s) => s.deleteDoc);

  // Pane-scoped actions for sidebar clicks and keyboard shortcuts
  const openTabInPane = useKBStore((s) => s.openTabInPane);
  const closeTabInPane = useKBStore((s) => s.closeTabInPane);
  const setActivePaneTab = useKBStore((s) => s.setActivePaneTab);

  const [sidebarRenameTarget, setSidebarRenameTarget] = useState<{
    docId: string;
    title: string;
  } | null>(null);
  const [sidebarDeleteTarget, setSidebarDeleteTarget] = useState<{
    docId: string;
    title: string;
  } | null>(null);

  useUnsavedChangesGuard();

  const embeddedDocId = searchParams.get("docId")?.trim() ?? "";
  const requestedDocId = embedded ? embeddedDocId : (urlDocId ?? "");

  // Sync requested docId to the focused pane -- also create tab if none exists.
  useEffect(() => {
    if (!requestedDocId) return;

    const state = useKBStore.getState();
    const focusedPane = state.panes[state.focusedPaneId];
    const hasRequestedTab = focusedPane?.openTabs.some(
      (tab) => tab.docId === requestedDocId,
    );
    if (activeDocId === requestedDocId && hasRequestedTab) {
      return;
    }

    openTabInPane(state.focusedPaneId, requestedDocId, requestedDocId);
  }, [requestedDocId, activeDocId, openTabInPane]);

  // Sync store activeDocId to URL
  useEffect(() => {
    if (embedded) return;
    if (activeDocId && activeDocId !== urlDocId) {
      navigate(`/notes/${activeDocId}`, { replace: true });
    } else if (!activeDocId && urlDocId) {
      navigate("/notes", { replace: true });
    }
  }, [embedded, activeDocId, urlDocId, navigate]);

  // Handle doc selection from sidebar -- targets the focused pane
  const handleSelectDoc = useCallback(
    (
      docId: string,
      _sourceId: string,
      title: string,
      openInNewTab?: boolean,
    ) => {
      const state = useKBStore.getState();
      const { focusedPaneId } = state;
      const focusedPane = state.panes[focusedPaneId];
      if (!focusedPane) return;

      if (openInNewTab) {
        // Ctrl+click or middle-click: always open new tab in focused pane
        openTabInPane(focusedPaneId, docId, title, _sourceId);
        return;
      }

      // Single-click: replace current tab or create first tab
      if (focusedPane.openTabs.length === 0 || !focusedPane.activeTabId) {
        openTabInPane(focusedPaneId, docId, title, _sourceId);
      } else {
        // Replace current active tab in-place within the focused pane.
        // If the target document is already open elsewhere in the pane,
        // switch to that tab and remove the current one to avoid duplicate IDs.
        useKBStore.setState((s) => {
          const pane = s.panes[focusedPaneId];
          if (!pane || !pane.activeTabId) return {};

          const activeTab = pane.openTabs.find((t) => t.id === pane.activeTabId);
          if (!activeTab) return {};

          const existingTargetTab = pane.openTabs.find((t) => t.docId === docId);
          if (existingTargetTab) {
            // Target already open: close current tab and focus existing target tab.
            if (existingTargetTab.id === activeTab.id) {
              return {
                panes: {
                  ...s.panes,
                  [focusedPaneId]: {
                    ...pane,
                    activeTabId: existingTargetTab.id,
                    activeDocId: docId,
                  },
                },
                activeTabId: existingTargetTab.id,
                activeDocId: docId,
              };
            }

            const updatedTabs = pane.openTabs.filter((t) => t.id !== activeTab.id);
            return {
              panes: {
                ...s.panes,
                [focusedPaneId]: {
                  ...pane,
                  openTabs: updatedTabs,
                  activeTabId: existingTargetTab.id,
                  activeDocId: docId,
                  pinnedTabIds: pane.pinnedTabIds.filter((id) => id !== activeTab.id),
                },
              },
              activeTabId: existingTargetTab.id,
              activeDocId: docId,
            };
          }

          const activeTabWasPinned = pane.pinnedTabIds.includes(activeTab.id);
          const updatedTabs = pane.openTabs.map((t) =>
            t.id === pane.activeTabId
              ? {
                  ...t,
                  id: docId,
                  type: "doc" as const,
                  docId,
                  title,
                  sourceId: _sourceId,
                }
              : t,
          );
          return {
            panes: {
              ...s.panes,
              [focusedPaneId]: {
                ...pane,
                openTabs: updatedTabs,
                activeTabId: docId,
                activeDocId: docId,
                pinnedTabIds: activeTabWasPinned
                  ? pane.pinnedTabIds.map((id) =>
                      id === activeTab.id ? docId : id,
                    )
                  : pane.pinnedTabIds,
              },
            },
            activeTabId: docId,
            activeDocId: docId,
          };
        });
      }
    },
    [openTabInPane],
  );

  // Keyboard shortcuts -- operate on focused pane via backward-compat shim
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ctrl+Shift+F: focus sidebar search ("search in all files", like Obsidian)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "KeyF") {
        e.preventDefault();
        requestSearchFocus();
        return;
      }

      // Ctrl+F: open find bar in reading view (CodeMirror handles edit mode)
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        const state = useKBStore.getState();
        const docId = state.activeDocId;
        const isEditing = docId ? (state.editModes[docId] ?? false) : false;
        if (!isEditing && docId) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("kb:open-find-bar"));
        }
        return;
      }

      // Ctrl+N: create Untitled note instantly (like Obsidian)
      if ((e.ctrlKey || e.metaKey) && e.key === "n") {
        e.preventDefault();
        useKBStore.getState().createUntitledNote();
        return;
      }

      // Ctrl+O: focus sidebar search ("go to file")
      if ((e.ctrlKey || e.metaKey) && e.key === "o") {
        e.preventDefault();
        requestSearchFocus();
        return;
      }

      // Ctrl+E: toggle edit mode on active document (reads from shim)
      if ((e.ctrlKey || e.metaKey) && e.key === "e") {
        e.preventDefault();
        const state = useKBStore.getState();
        const docId = state.activeDocId;
        if (!docId) return;
        const cached = state.docCache[docId];
        if (!cached || cached.source?.read_only) return;
        const current = state.editModes[docId] ?? false;
        state.setEditMode(docId, !current);
        return;
      }

      // Ctrl+S: save active document if in edit mode (reads from shim)
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        const state = useKBStore.getState();
        const docId = state.activeDocId;
        if (!docId) return;
        const isEditing = state.editModes[docId] ?? false;
        if (!isEditing) return;
        state.saveDoc(docId);
        return;
      }

      if (!e.altKey) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const { navCursor } = useKBStore.getState();
        if (navCursor > 0) useKBStore.getState().navigateBack();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        const { navStack, navCursor } = useKBStore.getState();
        if (navCursor < navStack.length - 1)
          useKBStore.getState().navigateForward();
      } else if (e.key === "PageDown") {
        e.preventDefault();
        const state = useKBStore.getState();
        const pane = state.panes[state.focusedPaneId];
        if (!pane || pane.openTabs.length < 2 || !pane.activeTabId) return;
        const idx = pane.openTabs.findIndex(
          (t) => t.id === pane.activeTabId,
        );
        const next = pane.openTabs[(idx + 1) % pane.openTabs.length];
        setActivePaneTab(state.focusedPaneId, next.id);
      } else if (e.key === "PageUp") {
        e.preventDefault();
        const state = useKBStore.getState();
        const pane = state.panes[state.focusedPaneId];
        if (!pane || pane.openTabs.length < 2 || !pane.activeTabId) return;
        const idx = pane.openTabs.findIndex(
          (t) => t.id === pane.activeTabId,
        );
        const prev =
          pane.openTabs[
            (idx - 1 + pane.openTabs.length) % pane.openTabs.length
          ];
        setActivePaneTab(state.focusedPaneId, prev.id);
      } else if (e.key === "w" || e.key === "W") {
        e.preventDefault();
        const state = useKBStore.getState();
        const pane = state.panes[state.focusedPaneId];
        if (pane?.activeTabId) {
          closeTabInPane(state.focusedPaneId, pane.activeTabId);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [requestSearchFocus, setActivePaneTab, closeTabInPane]);

  const handleSidebarRename = useCallback(
    async (newTitle: string) => {
      if (!sidebarRenameTarget) return;
      await renameDoc(sidebarRenameTarget.docId, newTitle);
      setSidebarRenameTarget(null);
    },
    [sidebarRenameTarget, renameDoc],
  );

  const handleSidebarDelete = useCallback(async () => {
    if (!sidebarDeleteTarget) return;
    await deleteDoc(sidebarDeleteTarget.docId);
    setSidebarDeleteTarget(null);
  }, [sidebarDeleteTarget, deleteDoc]);

  return (
    <div className="h-full w-full overflow-hidden bg-[#0e1420]">
      <KBResizableLayout
        sidebar={
          <KBSidebar
            onSelectDoc={handleSelectDoc}
            onCollapse={() => collapseRef.current?.()}
            onRename={(docId, title) =>
              setSidebarRenameTarget({ docId, title })
            }
            onDelete={(docId, title) =>
              setSidebarDeleteTarget({ docId, title })
            }
          />
        }
        onCollapseRef={collapseRef}
      />
      <RenameDialog
        open={sidebarRenameTarget !== null}
        currentTitle={sidebarRenameTarget?.title ?? ""}
        onConfirm={handleSidebarRename}
        onCancel={() => setSidebarRenameTarget(null)}
      />
      <DeleteConfirmDialog
        open={sidebarDeleteTarget !== null}
        title={sidebarDeleteTarget?.title ?? ""}
        onConfirm={handleSidebarDelete}
        onCancel={() => setSidebarDeleteTarget(null)}
      />
    </div>
  );
}
