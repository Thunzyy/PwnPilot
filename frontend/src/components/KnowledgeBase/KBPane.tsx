/**
 * KBPane -- Single pane container wrapping KBDocTabs + KBDocViewer.
 *
 * Reads pane ID from PaneContext. Sets focused pane on pointer down or focus.
 * The focused pane gets a subtle purple ring to indicate which pane
 * receives keyboard shortcuts.
 */
import { useCallback, useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { useKBStore } from "@/stores/kbStore";
import { usePaneId } from "./PaneContext";
import { KBDocTabs } from "./KBDocTabs";
import { KBDocViewer } from "./KBBrowser/KBDocViewer";

export function KBPane() {
  const paneId = usePaneId();
  const focusedPaneId = useKBStore((s) => s.focusedPaneId);
  const setFocusedPane = useKBStore((s) => s.setFocusedPane);
  const paneCount = useKBStore((s) => Object.keys(s.panes).length);

  const isFocused = focusedPaneId === paneId;
  const isSplit = paneCount > 1;

  const [showFindBar, setShowFindBar] = useState(false);

  // Check if active doc is in edit mode (find bar only shows in read mode)
  const isEditing = useKBStore((s) => {
    const docId = s.panes[paneId]?.activeDocId;
    return docId ? (s.editModes[docId] ?? false) : false;
  });

  // Listen for global Ctrl+F event -- only the focused pane opens its find bar
  useEffect(() => {
    function handleOpenFindBar() {
      if (focusedPaneId === paneId) setShowFindBar(true);
    }
    window.addEventListener("kb:open-find-bar", handleOpenFindBar);
    return () =>
      window.removeEventListener("kb:open-find-bar", handleOpenFindBar);
  }, [focusedPaneId, paneId]);

  const handleFocus = useCallback(() => {
    if (!isFocused) setFocusedPane(paneId);
  }, [isFocused, paneId, setFocusedPane]);

  // Derive sourceId from the pane's active doc
  const activeSourceId = useKBStore((s) => {
    const pane = s.panes[paneId];
    const docId = pane?.activeDocId;
    if (!docId) return "";
    const cached = s.docCache[docId];
    return cached?.source?.id ?? cached?.source_id ?? "";
  });

  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden",
        isSplit && isFocused && "ring-1 ring-primary/40 ring-inset",
      )}
      onPointerDown={handleFocus}
      onFocus={handleFocus}
    >
      <KBDocTabs />
      <div className="flex min-h-0 flex-1 flex-col">
        <KBDocViewer
          sourceId={activeSourceId}
          showFindBar={showFindBar && !isEditing}
          onCloseFindBar={() => setShowFindBar(false)}
        />
      </div>
    </div>
  );
}
